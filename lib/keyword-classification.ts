export const KEYWORD_PRIMARY_CATEGORIES = ['游戏', '应用', '专题', '资讯', '排行榜', '-'] as const
export type KeywordPrimaryCategory = typeof KEYWORD_PRIMARY_CATEGORIES[number]

export const GAME_SUBCATEGORIES = [
  '角色扮演', '仙侠手游', '休闲手游', '射击手游', '回合手游', '卡牌放置',
  '传奇手游', '解谜手游', '三国手游', '动作冒险', '经营模拟', '塔防手游',
  '竞速手游', '体育手游', '节奏手游', '手游盒子',
] as const

export const APP_SUBCATEGORIES = [
  '社交聊天', '美食菜谱', '音乐软件', '影视软件', '办公工具', '桌面美化',
  '手机购物', '拍摄滤镜', '手机阅读', '教育软件', '母婴育儿', '手机工具',
  '旅行酒店', '出行导航', '健康软件', '游戏辅助', '便捷生活', 'AI工具', '浏览器',
] as const

export type KeywordClassificationStatus = 'pending' | 'processing' | 'confirmed'

export const RANKING_KEYWORD_MARKERS = [
  '排行榜', '榜单', '前10', '前十', '前20', '前二十', '十大', '10大',
] as const

export function isRankingKeyword(keyword: string): boolean {
  const compactKeyword = keyword.replace(/\s+/g, '')
  return RANKING_KEYWORD_MARKERS.some(marker => compactKeyword.includes(marker))
}

const BROWSER_KEYWORD_PATTERN = /(浏览器|browser|chrome|safari|firefox|火狐|microsoft\s*edge|微软\s*edge|edge浏览器|uc浏览器|夸克浏览器|欧朋浏览器|(^|[^a-z])opera([^a-z]|$))/i
const AI_TOOL_KEYWORD_PATTERN = /(人工智能|ai工具|ai助手|ai软件|ai写作|ai绘画|ai聊天|chatgpt|deepseek|豆包|文心一言|通义千问|千问|kimi|claude|gemini|copilot|codex|讯飞星火|天工ai|秘塔ai|智谱清言|(^|[^a-z])ai([^a-z]|$))/i

export function inferredAppSubcategory(text: string): 'AI工具' | '浏览器' | null {
  if (BROWSER_KEYWORD_PATTERN.test(text)) return '浏览器'
  if (AI_TOOL_KEYWORD_PATTERN.test(text)) return 'AI工具'
  return null
}

export function isKeywordPrimaryCategory(value: unknown): value is KeywordPrimaryCategory {
  return typeof value === 'string' && (KEYWORD_PRIMARY_CATEGORIES as readonly string[]).includes(value)
}

export function subcategoriesFor(category: KeywordPrimaryCategory | ''): readonly string[] {
  if (category === '游戏') return GAME_SUBCATEGORIES
  if (category === '应用') return APP_SUBCATEGORIES
  return []
}

export function isValidKeywordSubcategory(category: KeywordPrimaryCategory, value: unknown): boolean {
  if (category !== '游戏' && category !== '应用') return value == null || value === ''
  return typeof value === 'string' && subcategoriesFor(category).includes(value)
}
