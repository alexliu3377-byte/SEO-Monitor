import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { BULK_MODELS, callGeminiJSON } from '../lib/gemini'
import {
  APP_SUBCATEGORIES,
  GAME_SUBCATEGORIES,
  KEYWORD_PRIMARY_CATEGORIES,
  inferredAppSubcategory,
  inferredGameSubcategory,
  isKeywordPrimaryCategory,
  isRankingKeyword,
  isValidKeywordSubcategory,
} from '../lib/keyword-classification'

loadEnvConfig(process.cwd())

const getArg = (name: string) => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
const batchSize = Math.min(1000, Math.max(20, Number(getArg('--batch-size')) || 500))
const batchCount = Math.min(1000, Math.max(1, Number(getArg('--batches')) || 1))
const provider = getArg('--provider') === 'gemini' ? 'gemini' : 'codex'
const selectedModel = getArg('--model') || ''
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!supabaseUrl || !serviceKey) throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
const workingDir = mkdtempSync(join(tmpdir(), 'keyword-classification-'))
const schemaPath = join(workingDir, 'output-schema.json')
const outputPath = join(workingDir, 'output.json')

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
        required: ['i', 'c', 's'],
        properties: {
          i: { type: 'integer', minimum: 0 },
          c: { type: 'integer', enum: KEYWORD_PRIMARY_CATEGORIES.map((_, index) => index) },
          s: { type: 'integer', minimum: -1, maximum: Math.max(GAME_SUBCATEGORIES.length, APP_SUBCATEGORIES.length) - 1 },
        },
      },
    },
  },
}, null, 2), 'utf8')

type ResultItem = { i: number; c: number; s: number }

function promptFor(rows: { keyword: string; volume: number }[]) {
  return `你只执行中文关键词内容分类，不修改文件、不调用工具、不搜索网络。根据关键词本身的主要搜索意图逐个分类。

一级分类编号只能是：${KEYWORD_PRIMARY_CATEGORIES.map((value, index) => `${index}=${value}`).join('，')}。
游戏二级分类编号只能是：${GAME_SUBCATEGORIES.map((value, index) => `${index}=${value}`).join('，')}。
应用二级分类编号只能是：${APP_SUBCATEGORIES.map((value, index) => `${index}=${value}`).join('，')}。

判断规则：
1. 游戏：主要寻找游戏、某类游戏或游戏下载，必须填写游戏二级分类。
2. 应用：主要寻找应用、某类软件或软件下载，必须填写应用二级分类。AI、人工智能、ChatGPT、DeepSeek、豆包、千问、Kimi、Claude、Gemini、Copilot、Codex 等归“AI工具”；浏览器、Chrome、Safari、Firefox、Edge、UC、夸克、Opera 等归“浏览器”。
3. 专题：明确是主题聚合、系列汇总或专题落地页。“合集”“大全”只是弱信号，不能仅凭这两个词判断。
4. 资讯：攻略、教程、玩法、怎么过、更新消息、新闻等阅读意图。
5. 排行榜：只有关键词原文包含“排行榜”“榜单”“前10”“前十”“前20”“前二十”“十大”或“10大”之一才可归入。仅有“排行”“排名”“热搜榜”“推荐”“哪个好”等表达不算排行榜，应按意图归入专题或其他分类。
6. -：信息不足、歧义明显或不属于上述方向。不要硬猜。
7. 优先按完整搜索意图分类：“塔防游戏排行榜”是排行榜；“原神攻略”是资讯；“仙侠手游”才是游戏/仙侠手游。
8. 专题、资讯、排行榜、- 的二级分类编号必须是 -1。
9. 输入编号 i 必须逐个返回一次，不得遗漏、重复或新增。
10. 为节省用量，每项只返回 {"i":输入编号,"c":一级分类编号,"s":二级分类编号}，不要解释。

关键词资料：
${JSON.stringify(rows.map((row, index) => [index, row.keyword]))}`
}

async function runBatch(index: number) {
  const modelLabel = selectedModel || (provider === 'gemini' ? 'Gemini 自动分类' : 'Codex 默认模型')
  const { data: batch, error: batchError } = await service.from('keyword_classification_batches')
    .insert({ requested_count: 0, model: modelLabel }).select('id').single()
  if (batchError || !batch) throw new Error(`建立批次记录失败：${batchError?.message ?? '未知错误'}`)

  try {
    const { data: claimed, error: claimError } = await service.rpc('claim_keyword_classification_batch', { p_batch_id: batch.id, p_limit: batchSize })
    if (claimError) throw new Error(`领取待分类词失败：${claimError.message}`)
    const rows = (claimed ?? []) as { keyword: string; volume: number }[]
    if (rows.length === 0) {
      await service.from('keyword_classification_batches').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', batch.id)
      return false
    }
    await service.from('keyword_classification_batches').update({ requested_count: rows.length }).eq('id', batch.id)

    console.log(`[批次 ${index + 1}/${batchCount}] 交给 ${provider === 'gemini' ? 'Gemini' : 'Codex'} 分类 ${rows.length} 个词…`)
    let parsed: { items?: ResultItem[] } | ResultItem[]
    if (provider === 'gemini') {
      const { result, error } = await callGeminiJSON<{ items?: ResultItem[] } | ResultItem[]>(promptFor(rows), {
        temperature: 0.1,
        maxOutputTokens: 8192,
        models: selectedModel ? [selectedModel] : BULK_MODELS,
      })
      if (!result) throw new Error(error || 'Gemini 没有返回分类结果')
      parsed = result
    } else {
      const args = ['exec', '--ephemeral', '--sandbox', 'read-only', '--output-schema', schemaPath, '--output-last-message', outputPath]
      if (selectedModel) args.push('--model', selectedModel)
      args.push('-')
      const child = spawnSync('codex', args, {
        cwd: process.cwd(),
        input: promptFor(rows),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      })
      if (child.error) throw child.error
      if (child.status !== 0) throw new Error(`Codex 退出码 ${child.status}：${String(child.stderr || child.stdout || '').slice(-1500)}`)
      parsed = JSON.parse(readFileSync(outputPath, 'utf8')) as { items?: ResultItem[] }
    }
    const seen = new Set<number>()
    // Gemini commonly returns the requested item list as the JSON root array,
    // while Codex follows the output schema and wraps it in { items }. Accept
    // both shapes so a valid Gemini response is not silently treated as empty.
    const resultItems = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
    const valid = resultItems.flatMap(item => {
      const { i: rowIndex, c: categoryIndex, s: subcategoryIndex } = item
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length || seen.has(rowIndex)) return []
      let category = KEYWORD_PRIMARY_CATEGORIES[categoryIndex]
      if (!isKeywordPrimaryCategory(category)) return []
      if (category === '排行榜' && !isRankingKeyword(rows[rowIndex].keyword)) category = '专题'
      let subcategory = category === '游戏'
        ? GAME_SUBCATEGORIES[subcategoryIndex] ?? ''
        : category === '应用'
          ? APP_SUBCATEGORIES[subcategoryIndex] ?? ''
          : ''
      if (category === '游戏') subcategory = inferredGameSubcategory(rows[rowIndex].keyword) ?? subcategory
      if (category === '应用') subcategory = inferredAppSubcategory(rows[rowIndex].keyword) ?? subcategory
      if (category !== '游戏' && category !== '应用' && subcategoryIndex !== -1) return []
      if (!isValidKeywordSubcategory(category, subcategory)) return []
      seen.add(rowIndex)
      return [{
        keyword: rows[rowIndex].keyword,
        category,
        subcategory,
        confidence: null,
        reason: '',
        model: modelLabel,
        source: provider === 'gemini' ? 'ai' : 'codex',
      }]
    })
    if (valid.length === 0) throw new Error(`AI 没有返回有效结果；本批没有写入`)

    const { data: saved, error: saveError } = await service.rpc('apply_keyword_ai_classifications', { p_items: valid })
    if (saveError) throw new Error(`写入分类失败：${saveError.message}`)
    await service.rpc('release_keyword_classification_batch', { p_batch_id: batch.id })
    const omitted = rows.length - valid.length
    await service.from('keyword_classification_batches').update({ status: 'completed', saved_count: Number(saved) || valid.length, error_message: omitted > 0 ? `遗漏 ${omitted} 个，保留在待分类队列重试` : null, completed_at: new Date().toISOString() }).eq('id', batch.id)
    console.log(`[批次 ${index + 1}/${batchCount}] 已保存 ${Number(saved) || valid.length} 个正式分类${omitted > 0 ? `，遗漏 ${omitted} 个待重试` : ''}。`)
    return true
  } catch (batchFailure) {
    const message = batchFailure instanceof Error ? batchFailure.message : String(batchFailure)
    await service.rpc('release_keyword_classification_batch', { p_batch_id: batch.id })
    await service.from('keyword_classification_batches').update({ status: 'failed', error_message: message.slice(0, 1000), completed_at: new Date().toISOString() }).eq('id', batch.id)
    throw batchFailure
  }
}

async function main() {
  let invalidBatchCount = 0
  try {
    for (let index = 0; index < batchCount; index += 1) {
      let hasMore = true
      try {
        hasMore = await runBatch(index)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('没有返回有效结果')) {
          invalidBatchCount += 1
          console.warn(`[批次 ${index + 1}/${batchCount}] ${message}，已释放并继续下一批重试。`)
          continue
        }
        throw error
      }
      if (!hasMore) { console.log('待分类队列已经清空。'); break }
    }
    if (invalidBatchCount > 0) {
      throw new Error(`${invalidBatchCount} 个批次没有写入有效分类，任务标记失败，请检查模型输出。`)
    }
  } finally {
    rmSync(workingDir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
