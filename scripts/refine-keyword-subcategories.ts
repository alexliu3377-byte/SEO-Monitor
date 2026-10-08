import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import {
  APP_SUBCATEGORIES,
  GAME_SUBCATEGORIES,
  inferredAppSubcategory,
  inferredGameSubcategory,
  isValidKeywordSubcategory,
  type KeywordPrimaryCategory,
} from '../lib/keyword-classification'

loadEnvConfig(process.cwd())

const getArg = (name: string) => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
const rulesOnly = process.argv.includes('--rules-only')
const dryRun = process.argv.includes('--dry-run')
const includeManual = process.argv.includes('--include-manual')
const skipRules = process.argv.includes('--skip-rules')
const batchSize = Math.min(300, Math.max(20, Number(getArg('--batch-size')) || 200))
const batchCount = Math.min(100, Math.max(1, Number(getArg('--batches')) || 1))
const selectedModel = getArg('--model') || ''
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!supabaseUrl || !serviceKey) throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
const workingDir = mkdtempSync(join(tmpdir(), 'keyword-subcategory-refinement-'))
const schemaPath = join(workingDir, 'output-schema.json')
const outputPath = join(workingDir, 'output.json')
const modelLabel = selectedModel ? `Codex 二级精修 · ${selectedModel}` : 'Codex 二级精修'

const LEGACY_GAME_DEFAULTS: Record<string, string> = {
  仙侠手游: '仙侠', 休闲手游: '休闲', 射击手游: '射击', 回合手游: '回合',
  卡牌放置: '卡牌', 传奇手游: '传奇', 解谜手游: '解谜', 三国手游: '三国',
  动作冒险: '动作', 经营模拟: '模拟', 塔防手游: '塔防', 竞速手游: '竞速',
  体育手游: '体育', 节奏手游: '音乐节奏', 手游盒子: '游戏盒子',
}

const LEGACY_APP_DEFAULTS: Record<string, string> = {
  社交聊天: '社交', 美食菜谱: '美食', 音乐软件: '音乐', 影视软件: '影视',
  办公工具: '办公', 手机购物: '购物', 拍摄滤镜: '摄影', 手机阅读: '阅读',
  教育软件: '教育', 母婴育儿: '母婴', 手机工具: '实用工具', 旅行酒店: '旅行',
  出行导航: '出行', 健康软件: '健康', 便捷生活: '生活',
}

const GAME_REFINEMENT_CATEGORIES = ['角色扮演', '休闲', '动作', '冒险', '经营', '模拟']
const APP_REFINEMENT_CATEGORIES = ['影视', '阅读', '健康', '生活', '实用工具']
const RULE_SOURCE_CATEGORIES = [
  ...Object.keys(LEGACY_GAME_DEFAULTS), ...Object.keys(LEGACY_APP_DEFAULTS),
  ...GAME_REFINEMENT_CATEGORIES, ...APP_REFINEMENT_CATEGORIES,
]

type KeywordRow = {
  keyword: string
  volume: number
  content_category: KeywordPrimaryCategory
  content_subcategory: string | null
  classification_source: string | null
}

function refinedByRule(row: KeywordRow): string {
  const current = row.content_subcategory ?? ''
  if (row.content_category === '游戏') {
    if (row.classification_source === 'manual') return LEGACY_GAME_DEFAULTS[current] ?? current
    const inferred = inferredGameSubcategory(row.keyword)
    if (current in LEGACY_GAME_DEFAULTS) return inferred ?? LEGACY_GAME_DEFAULTS[current]
    if (inferred && ['武侠', 'MOBA', '沙盒', '益智', '养成'].includes(inferred)) return inferred
  }
  if (row.content_category === '应用') {
    if (row.classification_source === 'manual') return LEGACY_APP_DEFAULTS[current] ?? current
    const inferred = inferredAppSubcategory(row.keyword)
    if (current in LEGACY_APP_DEFAULTS) return inferred ?? LEGACY_APP_DEFAULTS[current]
    if (inferred && ['直播', '短视频', '运动健身', '招聘求职', '天气', '新闻'].includes(inferred)) return inferred
  }
  return current
}

async function loadRuleCandidates() {
  const rows: KeywordRow[] = []
  for (let from = 0; ; from += 1000) {
    let query = service.from('keyword_volume')
      .select('keyword, volume, content_category, content_subcategory, classification_source')
      .eq('classification_status', 'confirmed')
      .in('content_category', ['游戏', '应用'])
      .in('content_subcategory', RULE_SOURCE_CATEGORIES)
      .order('keyword', { ascending: true })
      .range(from, from + 999)
    query = includeManual
      ? query.eq('classification_source', 'manual')
      : query.or('classification_source.is.null,classification_source.neq.manual')
    const { data, error } = await query
    if (error) throw new Error(`读取规则迁移资料失败：${error.message}`)
    rows.push(...((data ?? []) as KeywordRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function updateGroups(groups: Map<string, string[]>, fields: Record<string, unknown>) {
  let updated = 0
  for (const [subcategory, keywords] of groups) {
    for (let index = 0; index < keywords.length; index += 200) {
      const chunk = keywords.slice(index, index + 200)
      const { error } = await service.from('keyword_volume')
        .update({ content_subcategory: subcategory, ...fields })
        .in('keyword', chunk)
      if (error) throw new Error(`保存“${subcategory}”失败：${error.message}`)
      updated += chunk.length
    }
  }
  return updated
}

async function applyRuleRefinement() {
  const rows = await loadRuleCandidates()
  const groups = new Map<string, string[]>()
  for (const row of rows) {
    const next = refinedByRule(row)
    if (!next || next === row.content_subcategory || !isValidKeywordSubcategory(row.content_category, next)) continue
    const keywords = groups.get(next) ?? []
    keywords.push(row.keyword)
    groups.set(next, keywords)
  }
  const planned = Array.from(groups.values()).reduce((sum, keywords) => sum + keywords.length, 0)
  if (dryRun) {
    console.log(`规则迁移预览：扫描 ${rows.length} 个词，计划更新 ${planned} 个词。`)
    console.log(JSON.stringify(Object.fromEntries(Array.from(groups, ([name, keywords]) => [name, keywords.length]))))
    return
  }
  const updated = await updateGroups(groups, {})
  console.log(`规则迁移完成：扫描 ${rows.length} 个词，更新 ${updated} 个词。`)
}

writeFileSync(schemaPath, JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 's'],
        properties: {
          i: { type: 'integer', minimum: 0 },
          s: { type: 'integer', minimum: 0, maximum: Math.max(GAME_SUBCATEGORIES.length, APP_SUBCATEGORIES.length) - 1 },
        },
      },
    },
  },
}, null, 2), 'utf8')

function promptFor(rows: KeywordRow[]) {
  return `你只执行中文关键词的二级分类精修，不改变一级分类。每个输入词必须返回一次。
游戏二级分类：${GAME_SUBCATEGORIES.map((value, index) => `${index}=${value}`).join('，')}。
应用二级分类：${APP_SUBCATEGORIES.map((value, index) => `${index}=${value}`).join('，')}。
规则：
1. 根据关键词本身、一级分类和当前二级分类，选择更准确的二级分类。
2. 一级分类为游戏时只能使用游戏编号；一级分类为应用时只能使用应用编号。
3. 品牌词可凭常识判断，例如 Keep=运动健身、BOSS直聘=招聘求职、抖音=短视频。
4. 信息不足时保留当前二级分类，不要硬猜。
5. 只返回 {"items":[{"i":输入编号,"s":二级分类编号}]}，不要解释。
资料：
${JSON.stringify(rows.map((row, index) => [index, row.keyword, row.content_category, row.content_subcategory]))}`
}

async function loadCodexCandidates() {
  const { data, error } = await service.from('keyword_volume')
    .select('keyword, volume, content_category, content_subcategory, classification_source')
    .eq('classification_status', 'confirmed')
    .in('content_category', ['游戏', '应用'])
    .in('content_subcategory', [...GAME_REFINEMENT_CATEGORIES, ...APP_REFINEMENT_CATEGORIES])
    .or('classification_source.is.null,classification_source.neq.manual')
    .or('classification_model.is.null,classification_model.not.like.Codex 二级精修%')
    .order('volume', { ascending: false })
    .order('keyword', { ascending: true })
    .limit(batchSize)
  if (error) throw new Error(`读取 Codex 精修资料失败：${error.message}`)
  return (data ?? []) as KeywordRow[]
}

async function runCodexBatch(batchNumber: number) {
  const rows = await loadCodexCandidates()
  if (rows.length === 0) return false
  const args = ['exec', '--ephemeral', '--sandbox', 'read-only', '--output-schema', schemaPath, '--output-last-message', outputPath]
  if (selectedModel) args.push('--model', selectedModel)
  args.push('-')
  console.log(`[Codex ${batchNumber + 1}/${batchCount}] 精修 ${rows.length} 个高搜索量词…`)
  const child = spawnSync('codex', args, {
    cwd: process.cwd(), input: promptFor(rows), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true, maxBuffer: 10 * 1024 * 1024,
  })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`Codex 退出码 ${child.status}：${String(child.stderr || child.stdout || '').slice(-1500)}`)
  const parsed = JSON.parse(readFileSync(outputPath, 'utf8')) as { items?: { i: number; s: number }[] }
  const seen = new Set<number>()
  const groups = new Map<string, string[]>()
  for (const item of parsed.items ?? []) {
    if (!Number.isInteger(item.i) || item.i < 0 || item.i >= rows.length || seen.has(item.i)) continue
    const row = rows[item.i]
    const subcategory = row.content_category === '游戏' ? GAME_SUBCATEGORIES[item.s] : APP_SUBCATEGORIES[item.s]
    if (!subcategory || !isValidKeywordSubcategory(row.content_category, subcategory)) continue
    seen.add(item.i)
    const keywords = groups.get(subcategory) ?? []
    keywords.push(row.keyword)
    groups.set(subcategory, keywords)
  }
  if (seen.size !== rows.length) throw new Error(`Codex 返回 ${seen.size}/${rows.length} 个有效结果，本批不写入。`)
  const updated = await updateGroups(groups, {
    classification_source: 'codex', classification_model: modelLabel,
    classification_confidence: null, classification_reason: '', classified_at: new Date().toISOString(),
  })
  console.log(`[Codex ${batchNumber + 1}/${batchCount}] 已保存 ${updated} 个词。`)
  return true
}

async function main() {
  try {
    if (!skipRules) await applyRuleRefinement()
    if (rulesOnly) return
    for (let index = 0; index < batchCount; index += 1) {
      if (!await runCodexBatch(index)) break
    }
  } finally {
    rmSync(workingDir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
