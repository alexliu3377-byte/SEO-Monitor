export type CollectionSource = {
  id: string; group: string; name: string; mark: string; entry: string
  fields: string[]; process: string; destination: string; href: string
  executor: string; schedule: string; storage: string; note: string; evidence: string[]
}
export const COLLECTION_GROUPS = [
  { id: 'content', title: '内容与选题', description: '软件分享、游戏资讯与视频资料的来源。' },
  { id: 'seo', title: '关键词与 SEO', description: '竞品新词、权重、排名与收录的来源。' },
  { id: 'games', title: '小游戏榜单', description: '平台榜单与第三方热度分开看。' },
  { id: 'apps', title: '应用版本', description: '发现应用、提取版本，再进入人工审核。' },
  { id: 'trends', title: '搜索需求', description: '平台搜索结果和百度下拉的实际用途。' },
]
const cloud = 'GitHub 云端 Runner'
const windows = '这台 Windows 电脑'
const worker = 'trend-collector-worker / '
function source(id: string, group: string, name: string, mark: string, entry: string, fields: string[], process: string, destination: string, href: string, executor: string, schedule: string, storage: string, note: string, evidence: string[]): CollectionSource {
  return { id, group, name, mark, entry, fields, process, destination, href, executor, schedule, storage, note, evidence }
}
function content(id: string, name: string, mark: string, entry: string, fields: string[], process: string, executor: string, schedule: string, note: string, evidence: string[]) {
  return source(id, 'content', name, mark, entry, fields, process, '内容发现 · 内容动态', '/content/charts', executor, schedule, 'content_feed_items；正文与转写另存', note, evidence.map(path => worker + path))
}
// Code review snapshot: 2026/10/28. These are configured schedules, not live health.
export const SYSTEM_MAP: CollectionSource[] = [
  content('bilibili', 'B 站', 'B站', '4 个指定 UP 主的视频列表', ['视频标题', 'BV 链接', '作者 / 封面', '发布时间'], '视频入库 → 字幕优先 → 本地语音转写', windows, 'NS 任务结束后，最早 02:30 MYT', 'UP 主 ID：413703、314849660、313573880、3493141279672411。采集与文字处理分开执行，视频入库不代表转写已完成。', ['src/content-source-worker.ts', '.github/workflows/content.yml', 'src/content-transcription-worker.ts']),
  content('xhh-guide', '小黑盒 · 攻略', '盒', '用户主页 90687989', ['文章标题', '原文链接', '作者 / 封面', '发布时间'], '条目去重 → 正文提取 → 视频文字另行处理', windows, '计划每日 01:30 MYT', '只读取配置的攻略账号。正文与视频文字分开保存，视频受限时仍可查看已取得的正文。', ['src/content-source-worker.ts', 'src/xiaoheihe-content.ts', '.github/workflows/content.yml']),
  content('xhh-ns', '小黑盒 · NS', 'NS', '用户主页 85847280', ['NS 游戏条目', '原文链接', '作者 / 封面', '发布时间'], '条目去重 → 正文提取 → 视频文字另行处理', windows, '计划每日 02:00 MYT', '与攻略是不同账号和任务。任务排队或前序任务未完成时会顺延。', ['src/content-source-worker.ts', '.github/workflows/content.yml']),
  content('xiaohongshu', '小红书', '红', '搜索「游戏资源分享」', ['笔记标题', '笔记链接', '卡片摘要', '可见发布时间'], '搜索卡片入库 → 进入文字处理队列', windows, '手动触发，需要可用登录态', '这是固定搜索词的内容来源，与趋势发现的搜索词队列不同。遇登录或验证停止，不保证每条笔记都有全文。', ['src/content-source-worker.ts', '.github/workflows/content.yml']),
  content('52pojie', '吾爱破解', '52', '精品软件区 · fid=16 列表', ['软件主题标题', '帖子链接', '分类 / 作者', '来源日期'], '列表解析 → 链接规范化 → 同来源去重', cloud, '计划每日 00:05 MYT', '当前 Worker 读取论坛列表，默认最多 3 页，可指定日期范围。旧文档的 RSS 描述不代表当前实现；不采集安装包。', ['src/content-feed-public.ts', '.github/workflows/content-public.yml']),
  content('4399', '4399', '4399', 'a.4399.cn/game-new.html', ['游戏名称', '游戏页面链接', '封面', '可见日期'], '最新游戏列表 → 新游分类 → 去重', cloud, '计划每日 00:35 MYT', '每次最多读取 3 页。来源未给日期时，不能把发现日期当作上线日期。', ['src/content-feed-public.ts', '.github/workflows/content-public.yml']),
  content('ccplay', '虫虫助手', '虫', '资讯 / 活动 / 评测 / 攻略栏目', ['文章标题', '原文链接', '封面 / 摘要', '来源分类与日期'], '按栏目解析 → 保留分类 → 去重', cloud, '计划每日 01:00 MYT', '每个栏目最多 3 页。内容动态里的公开元数据不等于文章全文。', ['src/content-feed-public.ts', '.github/workflows/content-public.yml']),
  source('keywords', 'seo', '已配置竞品网站', '词', '网站管理登记的列表 URL 与选择器', ['清洗后的关键词', '文章链接（配置后）', '来源日期', '应用 / 游戏分类'], '解析列表 → 清洗词名 → 日期与重复检查', '竞品日收 / 热词雷达', '/content/competitor-daily', cloud, '计划每日 00:05 MYT', 'raw_keywords / competitor_kw_stats', '只采启用且已配置列表地址的站点；具体域名在网站管理维护，不是固定的一批站点。', ['scripts/crawl.ts', 'lib/crawler.ts', '.github/workflows/daily-crawl.yml']),
  source('weight', 'seo', '爱站 · 站点指标', '爱', 'aizhan.com 站点信息页', ['PC / 移动权重', '收录总数', '来路 IP 区间'], '字段校验 → 异常零值保护 → 每日快照', '权重监控 / 收录监控', '/content/weight-monitor', cloud, '计划每日 00:30 MYT', 'weight_history / index_snapshots', '爱站提供的指标和估计值，不是网站后台实测流量。', ['lib/crawler.ts', 'scripts/crawl.ts']),
  source('rank', 'seo', '爱站 · 涨跌词', '涨', 'baidurank.aizhan.com/mobile/', ['涨入 / 跌出关键词', '搜索量', '趋势变化'], '按站点采集 → 非空结果入库 → 更新词量', '热词雷达 / 站点情报', '/content/hot-keywords', cloud, '计划每日 01:30 MYT', 'rank_changes / keyword_volume', '只覆盖开启涨跌的站点；空结果可能是限流，不一定是没有涨跌。', ['lib/crawler-aizhan-http.ts', 'scripts/crawl.ts']),
  source('rank-title', 'seo', '爱站 · 排名明细', '名', '移动排名页；PC 按站点开关', ['关键词 / 搜索量', '当前与原排名', '页面标题', '排名 URL'], '按 M / PC 保存 → 与提交任务匹配', '研究中心 / 成效报告', '/content/research', cloud, '计划每日 02:30 MYT', 'site_keyword_ranks / keyword_volume', '仅覆盖开启排名的站点；M 和 PC 分开保存。成效追踪是进一步计算，不是新的外部数据来源。', ['scripts/crawl-rank.ts', 'lib/crawl-rules.ts']),
  source('baidu-index', 'seo', '百度 · 收录搜索', '百', 'site:域名 搜索结果', ['页面 URL', '标题 / 摘要', '百度显示日期', '首次 / 最后发现日'], '日 / 周窗口与月窗口轮转 → URL 去重', '收录页面', '/content/index-pages', cloud, '计划每日 03:30 MYT', 'site_indexed_pages', '未返回页面先进入后续验证，不直接判为脱收。遇安全验证中止；首次发现日不等于文章发布日期。', ['scripts/crawl.ts', 'lib/crawler.ts', '.github/workflows/verify-deindex.yml']),
  source('douyin-games', 'games', '抖音小游戏', '抖', 'game.open-douyin.com 官方公开榜单', ['新游 / 热门 / 畅销榜', '游戏 ID 与名称', '榜内名次', '简介'], '校验榜单完整性 → 保存快照', '内容发现 · 小游戏', '/content/charts', cloud, '计划每日 03:15 MYT', '小游戏榜单缓存', '每榜最多 100 条。榜单名次不等于下载量、搜索量或收入。', [worker + 'src/douyin-minigames.ts', worker + '.github/workflows/douyin-minigames.yml']),
  source('wechat-games', 'games', '微信小游戏', '微', 'xiaoyouxi.qq.com 公开展示页', ['人气 / 畅销 / 畅玩榜', '游戏名称', '名次与公开说明'], '读取展示页 → 保留来源日期缺失状态', '内容发现 · 小游戏', '/content/charts', cloud, '计划每日 03:30 MYT', '游戏发现快照', '来源未提供明确更新日期，时效未确认；不能标成今天最新上线。', [worker + 'src/game-discovery-sources.ts', worker + '.github/workflows/game-discovery.yml']),
  source('momorank', 'games', 'MomoRank', 'M', '微信 / 抖音榜单与热度页面', ['免费可见榜单行', '上升名次', 'IP 热度 / 热搜词', '来源日期'], '读取公开免费资料 → 按榜种保存快照', '内容发现 · 小游戏', '/content/charts', cloud, '计划每日 03:45 MYT', '游戏发现快照', '只取公开免费行，锁定指标留空。上升名次、热度和百度搜索量含义不同。', [worker + 'src/game-discovery-sources.ts', worker + '.github/workflows/game-discovery.yml']),
  ...[
    { id: 'apple', name: 'App Store', mark: 'A', entry: 'Apple 榜单、搜索与 Lookup API', schedule: '发现：每日 03:17；版本检查：04:17 MYT', evidence: ['lib/app-store.ts', '.github/workflows/app-store-discovery.yml'] },
    { id: 'google', name: 'Google Play', mark: 'G', entry: 'Google Play 公开榜单与产品页', schedule: '扩展：周二 / 周五 05:47；版本检查：每日 04:17 MYT', evidence: ['lib/marketplace-import.ts', '.github/workflows/marketplace-discovery.yml'] },
    { id: 'taptap', name: 'TapTap', mark: 'Tap', entry: 'TapTap 公开榜单与产品页', schedule: '扩展：周二 / 周五 05:47；版本检查：每日 04:17 MYT', evidence: ['lib/marketplace-import.ts', '.github/workflows/marketplace-discovery.yml'] },
    { id: 'custom-app', name: '登记的更新网页', mark: '页', entry: '管理员为应用登记的公开 URL', schedule: '计划每日 04:17 MYT；也可手动检查', evidence: ['scripts/app-update-crawl.ts', '.github/workflows/app-update-crawl.yml'] },
  ].map(app => source(app.id, 'apps', app.name, app.mark, app.entry, ['应用名称 / 标识', '版本号', '更新日志', '发布日期 / 包大小'], '提取版本 → 来源与版本去重 → 人工审核', '应用更新中心', '/app-updates', cloud + '；页面支持手动操作', app.schedule, 'app_update_apps / app_update_sources / app_update_releases', '字段依来源实际提供。新版本先待审核，通过后才更新当前版本；不下载或保存安装包。', app.evidence)),
  source('trend-search', 'trends', '小红书 / 抖音搜索', '搜', '趋势发现里维护的搜索词', ['首屏标题与简短文字', '标签 / 互动数字', '可见发布时间', '官方内容链接'], '领取一个到期词 → 最多 12 条首屏结果 → 入库', '趋势发现', '/content/trend-discovery', windows, '当前 collect.yml 只有手动触发', 'trend_collection_queries + 趋势采集结果', '旧文档的每半小时调度与当前工作流不一致，按代码标为手动，不代表定时任务正在运行。', [worker + '.github/workflows/collect.yml', worker + 'src/worker.ts']),
  source('baidu-suggest', 'trends', '百度下拉', '百', 'suggestion.baidu.com/su', ['种子词的下拉建议', '与既有排名的覆盖匹配'], '查询建议 → 去重 → 对照近 7 天排名', '研究中心 · 商业词', '/content/research', '网站服务端 · 按需请求', '点击「查覆盖」时执行', '下拉结果现查现用；种子清单存 commercial_keywords', '下拉出现不代表搜索量上涨，也不是自动选题或自动发布。', ['lib/crawler.ts', 'lib/crawl-rules.ts']),
]
