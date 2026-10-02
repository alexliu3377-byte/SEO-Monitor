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
  '旅行酒店', '出行导航', '健康软件', '游戏辅助', '便捷生活',
] as const

export type KeywordClassificationStatus = 'pending' | 'processing' | 'confirmed'

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
