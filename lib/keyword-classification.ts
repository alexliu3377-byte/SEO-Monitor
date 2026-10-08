export const KEYWORD_PRIMARY_CATEGORIES = ['游戏', '应用', '专题', '资讯', '排行榜', '-'] as const
export type KeywordPrimaryCategory = typeof KEYWORD_PRIMARY_CATEGORIES[number]

export const GAME_SUBCATEGORIES = [
  '角色扮演', '仙侠', '休闲', '射击', '回合', '卡牌', '放置', '传奇', '解谜',
  '三国', '武侠', '动作', '冒险', '经营', '模拟', '塔防', '竞速', '体育',
  '音乐节奏', '策略', '生存', '棋牌', 'MOBA', '沙盒', '益智', '养成', '游戏盒子',
] as const
export type GameSubcategory = typeof GAME_SUBCATEGORIES[number]

export const APP_SUBCATEGORIES = [
  '社交', '聊天', '美食', '菜谱', '音乐', '影视', '办公', '桌面美化', '购物',
  '摄影', '滤镜', '阅读', '小说', '漫画', '教育', '母婴', '育儿', '系统工具',
  '文件管理', '安全清理', '输入法', '下载工具', '扫描识别', '计算工具',
  '日历闹钟', '录音工具', '翻译工具', '实用工具', '旅行', '酒店', '出行',
  '导航', '健康', '运动健身', '招聘求职', '天气', '新闻', '直播', '短视频',
  '游戏辅助', '生活', 'AI工具', '浏览器',
] as const
export type AppSubcategory = typeof APP_SUBCATEGORIES[number]

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

export function inferredGameSubcategory(text: string): GameSubcategory | null {
  const compact = text.replace(/\s+/g, '')
  const rules: [RegExp, GameSubcategory][] = [
    [/(游戏盒子|手游盒子)/i, '游戏盒子'],
    [/(武侠|江湖|门派)/i, '武侠'],
    [/(角色扮演|\brpg\b)/i, '角色扮演'],
    [/(仙侠|修仙)/i, '仙侠'],
    [/(传奇|复古服|合击版)/i, '传奇'],
    [/(三国)/i, '三国'],
    [/(塔防)/i, '塔防'],
    [/(射击|枪战|fps)/i, '射击'],
    [/(回合制|回合)/i, '回合'],
    [/(放置|挂机)/i, '放置'],
    [/(卡牌|抽卡)/i, '卡牌'],
    [/(解谜|推理|密室|找茬)/i, '解谜'],
    [/(竞速|赛车|飙车)/i, '竞速'],
    [/(足球|篮球|台球|体育)/i, '体育'],
    [/(音游|节奏游戏|音乐游戏)/i, '音乐节奏'],
    [/(moba|5v5|多人在线战术竞技|王者荣耀|英雄联盟手游)/i, 'MOBA'],
    [/(沙盒|像素沙盒)/i, '沙盒'],
    [/(益智|脑力|烧脑)/i, '益智'],
    [/(养成|育成)/i, '养成'],
    [/(策略|slg|战争游戏)/i, '策略'],
    [/(生存|末日|求生)/i, '生存'],
    [/(棋牌|麻将|斗地主|象棋|围棋)/i, '棋牌'],
    [/(经营|开店|餐厅|农场|庄园)/i, '经营'],
    [/(模拟器|模拟游戏|模拟经营)/i, '模拟'],
    [/(冒险|探险|探索)/i, '冒险'],
    [/(动作|格斗|横版闯关)/i, '动作'],
    [/(休闲|消除|小游戏)/i, '休闲'],
  ]
  return rules.find(([pattern]) => pattern.test(compact))?.[1] ?? null
}

export function inferredAppSubcategory(text: string): AppSubcategory | null {
  if (BROWSER_KEYWORD_PATTERN.test(text)) return '浏览器'
  if (AI_TOOL_KEYWORD_PATTERN.test(text)) return 'AI工具'
  const compact = text.replace(/\s+/g, '')
  const rules: [RegExp, AppSubcategory][] = [
    [/(漫画|动漫阅读)/i, '漫画'],
    [/(小说|网文)/i, '小说'],
    [/(阅读器|电子书|读书软件)/i, '阅读'],
    [/(地图|导航|路线规划)/i, '导航'],
    [/(打车|公交|地铁|出行|共享单车)/i, '出行'],
    [/(酒店|住宿|民宿)/i, '酒店'],
    [/(旅行|旅游|景点|行程)/i, '旅行'],
    [/(输入法|键盘皮肤)/i, '输入法'],
    [/(文件管理|文件夹|解压|压缩文件)/i, '文件管理'],
    [/(杀毒|安全软件|清理垃圾|手机清理|清理大师|加速清理)/i, '安全清理'],
    [/(下载器|下载工具|磁力下载|种子下载)/i, '下载工具'],
    [/(扫描识别|文字识别|ocr|扫码工具|二维码扫描)/i, '扫描识别'],
    [/(计算器|单位换算|汇率换算)/i, '计算工具'],
    [/(日历|万年历|闹钟|倒计时)/i, '日历闹钟'],
    [/(录音|录音机|语音记录)/i, '录音工具'],
    [/(翻译|词典|字典)/i, '翻译工具'],
    [/(系统工具|系统管理|手机系统)/i, '系统工具'],
    [/(测速|网速|网络加速|wifi|wi-fi|流量管理|网络检测|网络诊断|vpn|代理工具|ip工具)/i, '实用工具'],
    [/(滤镜|修图|p图)/i, '滤镜'],
    [/(相机|摄影|拍照)/i, '摄影'],
    [/(直播|主播|电视直播)/i, '直播'],
    [/(短视频|抖音|快手)/i, '短视频'],
    [/(运动健身|健身|跑步|瑜伽|计步|减肥运动)/i, '运动健身'],
    [/(招聘|求职|找工作|人才网)/i, '招聘求职'],
    [/(天气|气象|天气预报)/i, '天气'],
    [/(新闻|资讯|头条)/i, '新闻'],
    [/(菜谱|食谱|做菜)/i, '菜谱'],
    [/(美食|外卖|餐厅推荐)/i, '美食'],
    [/(聊天|即时通讯|交友聊天)/i, '聊天'],
    [/(社交|社区|交友)/i, '社交'],
    [/(办公|文档|表格|幻灯片|会议软件)/i, '办公'],
    [/(音乐|听歌|歌曲|铃声)/i, '音乐'],
    [/(影视|视频|追剧|电影|短剧)/i, '影视'],
    [/(购物|商城|电商|买东西)/i, '购物'],
    [/(桌面|壁纸|主题美化|桌面美化)/i, '桌面美化'],
    [/(教育|学习|题库|考试|课程)/i, '教育'],
    [/(育儿|早教|宝宝)/i, '育儿'],
    [/(母婴|孕期|备孕)/i, '母婴'],
    [/(健康|医疗|问诊|健身)/i, '健康'],
    [/(游戏辅助|游戏加速器|手游助手)/i, '游戏辅助'],
  ]
  return rules.find(([pattern]) => pattern.test(compact))?.[1] ?? null
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
