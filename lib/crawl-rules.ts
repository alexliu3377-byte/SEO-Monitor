// Crawl rules reference — single source of truth for how each step works.
// IMPORTANT: Update this file whenever you change:
//   - Step timing or trigger source (GitHub Actions / Vercel)
//   - Which Supabase tables are written to
//   - Inter-site delays, retry counts, or rate-limit behaviour
//   - Dedup logic or data-retention periods
//   - A new crawl step is added or an existing one is removed
// The crawl-log page imports this to render the [规则] modal.

export interface RuleSection {
  key: string
  title: string
  badge: string
  items: { label: string; text: string }[]
}

export const CRAWL_RULES: RuleSection[] = [
  {
    key: 'keywords',
    title: '关键词抓取',
    badge: 'step=keywords · GitHub Actions · 目标 00:30 MYT（cron 23:30 MYT + 排队约 1h）',
    items: [
      { label: '触发方式', text: 'GitHub Actions daily-crawl.yml (cron 30 15 * * * UTC = 23:30 MYT 前一天)，动态 matrix job 并行（每5个站点1个job，由 setup job 查询当前站点总数自动计算），每组抓约5个站点；实际执行脚本：scripts/crawl.ts（非 /api/cron，两条路径）；GitHub runner 排队约1小时，实际执行约 00:30 MYT。失败/空站由 retry-crawl.yml (cron 30 20 UTC = 04:30 MYT) 自动补抓' },
      { label: '抓取对象', text: '仅 is_enabled=true 且 list_url 已填写的站点；is_enabled 由用户在网站管理"关键词数据"开关控制，关闭后跳过关键词抓取但权重/排名照常运行' },
      { label: '文章链接抓取', text: '各来源可在"文章链接CSS选择器"（url_selectors 字段，||| 分隔多来源）填写指定 CSS 选择器；填写后爬虫用该选择器在每条记录的容器内查找 <a> 元素并写入 raw_keywords.source_url；留空则 source_url 为 null；支持完整URL和相对路径（相对路径自动补全域名）' },
      { label: '频率规则', text: '所有站点均为 daily（每天）' },
      { label: '翻页策略', text: '最多3页；正式 GitHub Actions 抓取每页间隔随机等待10~15秒；单站手动重试跳过等待直接顺序翻页；若某页全部条目日期解析失败（日期CSS选择器很可能配置错误，而不是碰到没见过的日期格式），当页翻页立即停止，不再继续翻到第2、3页——避免选择器坏了时把更多页的旧内容当"昨日新增"批量抓入（2026-07-29 加入；JSON-HTML混合模式同样逻辑，上限从30页降到出问题即停）' },
      { label: '去重', text: '与数据库同日期已有词对比去重，批次内也去重；新词写入 raw_keywords' },
      { label: '版本号清洗', text: '启用版本号清洗时：发现 v/V 前缀版本号（如 v2.3.1）时，从该版本号起连同其后所有内容一并删除（如"使命召唤v2.3.1安卓版"→"使命召唤"，"世界1.20.4中文版v1.20.4"→"世界1.20.4中文版"）；不含 v 前缀的纯数字版本号（如1.20.4）和独立"xxx版"词组保留不处理' },
      { label: '写入表', text: 'raw_keywords（新词）/ competitor_kw_stats（app/game分类计数）' },
      { label: '清理', text: '每日关键词步骤结束后由 group0 执行：仅 competitor_kw_stats 30天（2026-08-05 从10天改成30天：竞品日收的趋势图/工作日周末基线按30天取数，保留期比查询窗口短会导致基线样本不足）。raw_keywords / rank_changes 2026-08-05 起改为永久保留，不再清理（原因见下方"数据保留"表）' },
      { label: '静默失败风险', text: 'HTML fetch 返回空时不报错，只在 activity_log 标记 empty；选择器配置错误会导致持续为空' },
      { label: '日期解析失败', text: '日期CSS选择器未匹配到内容、或匹配到的文本无法识别为日期时，content_date 仍按 yesterday（爬取目标日）填充写库（不存 NULL，避免影响近期榜单/竞品日收/热词雷达等十几处按 content_date 分组统计的下游功能）；但该站点当次解析失败的条数会统计出来，写进 activity_site_log 的 detail（"⚠N条日期解析失败（按昨日填充，请检查日期CSS选择器）"），在抓取日志页面站点明细里可见，用于定位选择器失效的站点' },
    ],
  },
  {
    key: 'weight',
    title: '权重+收录',
    badge: 'step=weight · GitHub Actions · 目标 01:30 MYT（cron 00:30 MYT + 排队约 1h）',
    items: [
      { label: '触发方式', text: 'GitHub Actions daily-crawl.yml (cron 30 16 * * * UTC = 00:30 MYT 当天)，动态 matrix job 并行（每4个站点1个job）；实际执行脚本：scripts/crawl.ts；实际执行约 01:30 MYT。失败站由 retry-crawl.yml (cron 0 21 UTC = 05:00 MYT) 自动补抓' },
      { label: '数据来源', text: '爱站 aizhan.com，抓取 PC/移动权重、收录数、来路IP区间' },
      { label: '限流保护', text: '失败后等30秒重试，最多3次（共3次尝试，每次换新UA）；站点间隔3秒' },
      { label: '写入表', text: 'weight_history（pc/mobile权重+IP区间，按 site_id+record_date upsert）/ index_snapshots（收录数，按 site_id+snapshot_date upsert）' },
      { label: '手动重抓', text: '页面"重抓"按钮 → /api/trigger-crawl → /api/cron?step=weight&site=xxx，IP来自 Vercel，记录为 cron_manual' },
    ],
  },
  {
    key: 'rank',
    title: '排名变动',
    badge: 'step=rank · GitHub Actions · 目标 02:30 MYT（cron 01:30 MYT + 排队约 1h）',
    items: [
      { label: '触发方式', text: 'GitHub Actions daily-crawl.yml (cron 30 17 * * * UTC = 01:30 MYT 当天)，动态 matrix job 并行（每4个站点1个job）；实际执行脚本：scripts/crawl.ts；实际执行约 02:30 MYT。失败/空站由 retry-crawl.yml (cron 30 21 UTC = 05:30 MYT) 自动补抓' },
      { label: '抓取对象', text: '仅 is_enabled=true 且 has_rank_data=true 的站点；has_rank_data 由用户在网站管理手动开关（列表里显示为"涨跌"），cron 不会自动修改该字段' },
      { label: '数据来源', text: '爱站移动端 baidurank.aizhan.com/mobile/…，抓涨入词与跌出词及搜索量' },
      { label: '浏览器验证', text: '爱站的挑战机制自 2026-06 起变过三次，历史记录：① 2026-06-19 起，简单 JS 挑战（响应体内嵌 document.cookie="C3VK=...";window.open(...)，无真实跳转）；② 2026-07 起升级为约2分钟的浏览器指纹深度挑战（_jsc_sbu 环境探测，纯 fetch 无法通过），抓取一度改用 Playwright headless Chromium（createAizhanBrowserSession()，job 开始时过一次约2分钟验证，全 job 复用同一浏览器 context；若150秒内未通过则 AIZHAN_CHALLENGE_TIMEOUT 直接崩溃退出，且这类崩溃发生在任何单站日志写入之前，导致 retry-crawl.yml 的"按失败站点重试"完全查不到失败记录、白跑一次——2026-08-02 实测 07-31/08-01 两个 MYT 日期的 rank+rank-title 全站数据因此双双丢失且未被自动补上）；③ 2026-08 起验证又变简单，退回① 那种量级（一次请求内含 302+Set-Cookie 或内嵌 document.cookie 两种形式之一，均无需执行JS，一次额外往返即可拿到有效 cookie）。当前实现（lib/crawler-aizhan-http.ts，createAizhanHttpSession()）是纯 fetch，同时处理这两种 cookie 下发形式，整个抓取过程复用同一个 session（cookie 会随每次响应的 Set-Cookie / 内嵌值持续刷新，不会中途过期）。lib/crawler-browser.ts 的 Playwright 方案保留未删，若爱站之后重新上强度，换回来只需改 scripts/crawl.ts / scripts/crawl-rank.ts 里这一行 import' },
      { label: '并行策略', text: '排名段1-5最多2个并发（各自启动前随机延迟0-400ms），段内按页顺序，每页间隔300ms；每页请求带 Referer=上一页URL（第1页 Referer=站点首页），模拟真实"点下一页"的跳转链，而不是每次都用固定 Referer（2026-07-27 加入：实测发现翻页 100% 卡在第1-2页、从未翻到第3页，怀疑反爬专门检查翻页请求的 Referer 链；2026-08 切到纯 fetch 后继续保留这个逻辑；同批 2026-08-02 还发现5段完全并行会被爱站按 UND_ERR_SOCKET 拒绝大部分连接，改成2并发+抖动后消失）' },
      { label: '限流保护', text: '涨入完成后随机等3-5秒抓跌出（随机间隔减少爱站检测风险）；涨跌其中一方为0时等5秒重试1次；连续3站均为空触发熔断，暂停5分钟后补抓；涨入/跌出任一方>150但另一方=0时标记 suspect（疑似漏抓），不影响已有数据写入，由 retry-crawl.yml 05:00 MYT 自动重抓；站点间45秒间隔' },
      { label: '去重', text: '同关键词出现在多个排名段时保留搜索量最高的记录' },
      { label: '写入表', text: 'rank_changes（有数据时先删当日旧记录再插入）/ keyword_volume（涨入+跌出词搜索量，永久表，含 latest_trend 字段标记最新趋势；已有记录不被 volume=0 覆盖；2026-07-30 加入：写入前先查旧的 volume 算出差值，存进 prev_volume/volume_change 字段——此前 upsert 只保留最新一条，历史搜索量从未留存过，这两个字段是唯一能看出"搜索量是否上涨"的信号，供分组任务/热词雷达"搜索量上涨"tab 使用）' },
      { label: '静默失败风险', text: '爱站IP限流后返回空，两次重试都空则不写数据，标记 empty；单侧>150另侧=0时标记 suspect 供重抓；涨跌均为0无法区分"真无涨跌"与"被限流"，但单侧>150另侧=0基本可确认为漏抓。另：若整个 job 在拿到会话 cookie 之前就崩溃（比如网络问题），会连累到没有任何单站日志——同 2026-07 Playwright 超时那次一样是 retry-crawl.yml 的盲区，需要看 activity_log 该 job 是否有 activityEnd（长期停在"进行中"就是这种崩溃，不是真的还在跑）' },
      { label: '补抓历史日期', text: 'scripts/crawl.ts --step=rank 支持 --date=YYYY-MM-DD 覆盖"今天"（默认取当前 MYT 日期）；爱站排名页本身按日期区分 URL（当天省略日期段，历史日期带日期段），所以可以补抓过去某一天的涨跌词，仅影响 rank 步骤，不影响同一次运行里的其它 step；daily-crawl.yml 的 workflow_dispatch 对应加了 date 输入框，透传为这个 --date 参数（rank/rank-title 都支持，其它 step 忽略）' },
    ],
  },
  {
    key: 'cron_manual',
    title: '手动重抓',
    badge: '触发方式：页面按钮 → Vercel /api/trigger-crawl',
    items: [
      { label: 'IP来源', text: 'Vercel serverless（与 GitHub Actions IP 不同），仅用于单站补抓，不适合替代 GitHub Actions 跑全量' },
      { label: '触发路径', text: '页面按钮 → POST /api/trigger-crawl { site, step }（需 admin/super 权限）→ GET /api/cron?site=xxx&step=yyy → 单站抓取（走 /api/cron，与 GitHub Actions 的 scripts/crawl.ts 是两条不同执行路径）；trigger-crawl 超时限制 50s，为避免超时：keywords 步骤去掉翻页间隔延迟（正常 10-15s，单站模式跳过），weight 步骤重试间隔缩短为 5s（正常为 30s）' },
      { label: '写入', text: '与定时任务相同的写入逻辑；weight 步骤写入 weight_history + index_snapshots；keywords 步骤写入 raw_keywords + competitor_kw_stats' },
      { label: '日志', text: '记录为 cron_manual，来源 Vercel，detail 显示写入行数' },
      { label: '涨跌排行的已知限制', text: 'Vercel 手动重抓/导出涨跌排行相关接口（/api/rank-changes、/api/export-rankup-history、/api/export-rank-history、/api/cron?step=rank）用的是 lib/crawler.ts 里更早一版的 fetchRankChanges/prefetchRankCookie，只识别 2026-06-19 那版"内嵌 document.cookie"挑战，不处理 HTTP 302+Set-Cookie 形式，也没有 lib/crawler-aizhan-http.ts 的重试/hop 逻辑；爱站挑战机制变化期间这条路径可能比 GitHub Actions 那条（scripts/crawl.ts / crawl-rank.ts，已切到 lib/crawler-aizhan-http.ts）更容易抓空，这是已知的、可接受的降级——日常抓取走的是 GitHub Actions 那条路径' },
    ],
  },
  {
    key: 'index-pages',
    title: '收录页面追踪',
    badge: 'step=index-pages · GitHub Actions · 03:30 MYT（cron 19:30 UTC）',
    items: [
      { label: '触发方式', text: 'GitHub Actions daily-crawl.yml (cron 30 19 * * * UTC = 03:30 MYT)，setup job 仅查询 has_index_pages=true 的站点数决定 job 数，每站一个 job（SPG=1）；retry-crawl.yml (cron 30 22 UTC = 06:30 MYT) 自动补抓；支持页面手动重抓 → /api/trigger-crawl → /api/cron?step=index-pages' },
      { label: '抓取对象', text: '仅 has_index_pages=true 的站点（在收录页面追踪页面逐站开关，默认 false）；setup 阶段已精确过滤，不会为其他类型站点创建多余 job' },
      { label: '抓取方式', text: '百度 site:domain 搜索，时间窗口分批策略：周(7天)+日(1天) 每天为全部站点运行；月(31天) 窗口按 3 天轮转批次（MYT 天数 mod 3 = 批次号，每站按其在站点数组的下标 idx%3 决定当天是否跑月度窗口），每天约 1/3 站点跑月度，3 天内覆盖所有站点；gpc=stf={now-Nd},{now}|stftype=1 + tfflag=1 + ct=2097152/si=domain/fenlei=256；pn=0/10/20... 翻页，无页数上限；停止条件：空页、被拦截（captcha 则中止当站）、或整页URL相同；翻页间隔 5-8 秒随机' },
      { label: 'Cookie 来源', text: 'app_settings.baidu_index_cookie 手动 Cookie 池（JSON 数组，从已登录/长期使用的浏览器复制账号 cookie，"分组任务"页面右上角"管理 Cookie 池"维护，所有登录用户都可查看和维护，非仅管理员），每次抓取随机取一个使用；翻页过程中沿用 fetchBaiduIndexPages() 原有逻辑：每页 Referer 指向上一页、Cookie 随每页 Set-Cookie 滚动更新。2026-07-27 曾短暂尝试用 Playwright headless Chromium 自动访问百度现拿匿名 cookie 替代手动池，但真实 GitHub Actions A/B 对比显示效果明显更差（匿名新 cookie 首次请求就100%被拦截，而手动池里"资历更老"的账号 cookie 能连续拿到3-5页真实数据）——判断是 Baidu 反爬会评估 cookie 的"资历"（关联的浏览历史/账号信息越老越可信），不是单纯看请求是否来自真实浏览器，因此改回手动池为唯一来源，不再自动获取' },
      { label: '诊断日志', text: 'fetchBaiduIndexPages() 每页请求都会打印结果（成功=raw/new数量、captcha拦截、no_content、http_error、或与上一页URL完全重复而停止），并在开始时打印 cookie 指纹（字段数/长度/字段名，不含真实值）；scripts/crawl.ts 打印 job 精确启动时间，用于跨 job 日志比对是否扎堆请求' },
      { label: '去重', text: '按 (site_id, url) 唯一索引 upsert；新页面写入 first_seen_date=today（DB trigger 保护，UPDATE 时不覆盖）；已知页面更新 last_seen_date=today 并重置 missed_count=0、verify_needed=false、disappeared_date=null；抓完后对 30天窗口内未出现的页面执行宽限计数：连续 2 次未出现（missed_count≥2）才标记 verify_needed=true 进入验证队列，不直接写 disappeared_date（30天可观测窗口外的历史页面不参与判定）' },
      { label: '脱收验证', text: '脱收不在本步骤确认——verify_needed=true 的页面由每周六 verify-deindex.yml 逐 URL 搜索百度（site:domain/path）确认；搜得到则清除标记（误报），搜不到才写 disappeared_date=today；百度拦截（captcha）时跳过本 URL，下周再试' },
      { label: '写入表', text: 'site_indexed_pages（url, title, snippet, baidu_date_str, first_seen_date, last_seen_date, disappeared_date, missed_count, verify_needed）；500条/批写入' },
      { label: '风险', text: '百度对 GitHub Actions IP 有反爬限制，若返回 "百度安全验证" 页则自动停止该站抓取；empty 状态表示疑似被拦截' },
    ],
  },
  {
    key: 'rank-title',
    title: '排名抓取（全站点）',
    badge: 'step=rank-title · daily-crawl.yml · GitHub Actions · 02:30 MYT（cron 18:30 UTC）；retry 06:00 MYT',
    items: [
      { label: '触发方式', text: 'GitHub Actions daily-crawl.yml (cron 30 18 * * * UTC = 02:30 MYT)，动态 matrix job 并行（每2个站点1个job）；retry-crawl.yml (cron 0 22 UTC = 06:00 MYT) 智能重试：setup job 查询 activity_site_log 统计今日失败/空站数，仅为失败站创建 job（每站1个），scripts/crawl-rank.ts 以 --retry-failed 模式运行只处理当日失败站点；脚本：scripts/crawl-rank.ts；支持手动 workflow_dispatch 选 step=rank-title' },
      { label: '抓取对象', text: 'sites 表中 has_rank_title=true 的站点（网站管理列表里显示为"排名"）；动态读取，每次运行重新查询' },
      { label: '数据来源', text: '爱站 baidurank.aizhan.com，移动端（/mobile/）+ PC端（/baidu/），各抓涨入和跌出，共 4 个组合；含标题（title）和排名页 URL（url）' },
      { label: '浏览器验证', text: '与 rank 步骤相同（详见 rank 小节"浏览器验证"完整历史），job 开始时用 createAizhanHttpSession() 拿一次会话 cookie（纯 fetch，一次额外往返，非 2026-07 那版约2分钟的 Playwright 验证），本 job 内全部站点/平台/涨跌组合复用同一 session；支持 --date=YYYY-MM-DD 补抓历史日期，用法同 rank 步骤' },
      { label: '并行策略', text: '排名段 1-5 同时并行（各开一个浏览器 page），段内按页顺序，每页间隔 300ms；4 个组合顺序执行，组合间隔随机 3-5 秒；站点间间隔 60 秒' },
      { label: '翻页上限', text: '每段最多 15 页；抓取全部词（不过滤 volume=0）' },
      { label: '排名字段', text: '新排名（rank_position）= "第11名" → 11；原排名（prev_rank）= "50名外" → NULL；含页面标题（title）和排名页 URL' },
      { label: '写入表', text: 'site_keyword_ranks（永久保留，含 prev_rank + title + url，按 site_id+keyword+stat_date+platform+type 唯一，每次运行先删当日全部记录再写入）/ keyword_volume（移动端 rankup+rankdown，upsert；rankup 优先级高于 rankdown；含 latest_trend 字段；同上一步一样写入前先算 prev_volume/volume_change）' },
      { label: '数据保留', text: 'site_keyword_ranks 永久保留，不自动删除' },
      { label: '限流风险', text: '爱站返回空时标记为"无数据（疑似限流或无词）"，不写入；站点间 60s 间隔降低限流概率' },
    ],
  },
  {
    key: 'verify-deindex',
    title: '脱收验证',
    badge: 'verify-deindex.yml · GitHub Actions · 每周六 07:30 MYT（cron 23:30 UTC 周五）',
    items: [
      { label: '触发方式', text: '每周六 07:30 MYT（cron 30 23 * * 5 UTC）自动运行；也可 workflow_dispatch 手动触发；脚本：scripts/verify-deindex.ts' },
      { label: '处理对象', text: 'site_indexed_pages 中 verify_needed=true AND disappeared_date IS NULL 的所有 URL（由日常 index-pages 抓取在连续 2 次未见后标记）' },
      { label: '验证方式', text: '对每条 URL 执行 site:<url> 百度搜索；搜得到 → 清除 verify_needed（误报，仍在收录）；搜不到 → 写入 disappeared_date=today（确认脱收）；百度拦截/网络错误 → 跳过本 URL，下周再试' },
      { label: '限流保护', text: 'URL 之间固定间隔 4 秒；百度返回 captcha/no_content/http_error 时标记为跳过，不误判为脱收' },
      { label: '写入表', text: 'site_indexed_pages（disappeared_date 或 verify_needed/missed_count 清零）' },
    ],
  },
  {
    key: 'tracking',
    title: '成效追踪（竞品 + 自己站点）',
    badge: 'step=tracking · GitHub Actions · 06:45 MYT（cron 22:45 UTC，index-pages retry 完成后）',
    items: [
      { label: '触发方式', text: 'GitHub Actions daily-crawl.yml (cron 45 22 * * * UTC = 06:45 MYT)，在所有主抓取和重试（含 index-pages retry 06:30 MYT）完成后运行；脚本：scripts/crawl.ts --step=tracking；不设 retry，因为记录是持久化的，漏一天次日补跑即可' },
      { label: '竞品追踪对象', text: '仅 has_rank_title=true 的竞品站点（与 rank-title 步骤相同；网站管理列表里显示为"排名"）' },
      { label: '竞品信号来源', text: '① 排名信号（by keyword + by URL）：site_keyword_ranks 表中 stat_date=today + platform=mobile 的当日涨跌词；还通过 site_keyword_ranks.url 与 raw_keywords.source_url 交叉匹配（URL 优先级高，能捕获 keyword 名称不一致的案例）；② 收录信号：site_indexed_pages 表中 first_seen_date=today 的新收录 URL，通过 source_url 反查 raw_keywords 得到关键词' },
      { label: '竞品过滤条件', text: '信号词必须同时存在于 raw_keywords（60天内有提交记录）才会被记录；无提交记录的信号词跳过' },
      { label: '信号词匹配查询方式', text: '信号词/信号URL 与 raw_keywords 交叉匹配、以及后续 keyword_volume/site_indexed_pages 查询，改用 Postgres RPC 函数（match_raw_keywords_by_keyword / match_raw_keywords_by_url / match_keyword_volume / match_site_indexed_pages，见 migration add_competitor_tracking_match_rpcs），一次调用传入全部信号词/URL数组，不再用 .in() 分批查询（2026-07-29：此前固定 .slice(0,500) 截断信号词列表导致 competitor_tracking_records 自建表以来一直是空的、规则中心8条规则成功/失败次数全部为0；改成分批 .in() 后中文关键词经URL编码体积膨胀，即使150个一批在连续多批请求下仍会不稳定报 HeadersOverflowError；改为 RPC 后参数走请求体不受URL长度限制，问题彻底解决）' },
      { label: '竞品成效判断', text: '有效：rank_type=rankup 或 source_url 对应页面今日新收录；追踪中：rankdown 信号；无效：discovery_date < today-60 且 effectiveness 仍为"追踪中"（由本步骤自动更新）' },
      { label: '竞品规则匹配', text: '规则 #1（跌后更新观察）：rankdown 词 + 近 7 天内有提交记录 → 标记 rule_id；规则 #2（批量下拉词更新）：同日期相同 4 字前缀 ≥3 个词有信号 → 标记 rule_id' },
      { label: '竞品写入表', text: 'competitor_tracking_records（按 site_id+keyword+discovery_date 唯一，upsert；同时将 >60 天的"追踪中"记录更新为"无效"；永久保留）' },
      { label: '自己站点追踪对象', text: '全部分组中 status=submitted + page_url 已填写 + claimed_date >= 90天内 的 member_claimed_keywords 记录' },
      { label: '自己站点信号来源', text: '① 收录信号：site_indexed_pages 表 by URL（page_url）→ is_indexed / index_first_seen / index_disappeared；② 排名信号：site_keyword_ranks 表 by URL（platform=mobile，取最新 stat_date + 最佳 rank_position）→ rank_keyword / rank_position / prev_rank；匹配前双方 URL 都去掉开头的 www./m. 子域名再比较（2026-07-29 加入：组员提交 page_url 时常漏填"m."，而收录/排名数据抓的多是移动端 m. 子域名，字符串精确匹配会漏判为"未收录"）' },
      { label: '匹配查询分批大小', text: '按 URL 变体（协议×子域名×末尾斜杠组合）查询 site_indexed_pages / site_keyword_ranks 时，.in() 每批固定 150 个变体（2026-07-29 修复：此前固定 500 个，实测会导致请求 URL 超过约 16KB 的 HTTP header 上限而报 HeadersOverflowError，且代码此前没检查该错误，导致自己站点排名/收录匹配连续多日静默返回 0 条，effectiveness 全部误判为"追踪中"）' },
      { label: '自己站点成效判断', text: '获取排名：rank_position 不为空；获取收录：已收录（is_indexed=true）但 rank_position 为空；追踪中：未收录且提交未满 90 天；无效：提交已超过 90 天且仍未获取收录/排名' },
      { label: '自己站点写入表', text: 'site_tracking_records（按 claim_id+record_date 唯一，每日 upsert 一行，积累历史曲线；永久保留）；site_tracking_rank_matches（按 claim_id+record_date+keyword 唯一，2026-07-29 加入：同一 page_url 在 site_keyword_ranks 里命中多个不同排名词时，全部匹配都写入本表供成效追踪页面展示，不像 site_tracking_records 只保留最佳一条；永久保留）' },
    ],
  },
  {
    key: 'research-report',
    title: '研究报告（周/月/年）',
    badge: 'research-report.yml · GitHub Actions · 周一/每月1号/每年1月1号 08:00 MYT',
    items: [
      { label: '触发方式', text: 'GitHub Actions research-report.yml，同一个workflow三条cron：周报（cron 0 0 * * 1 UTC=每周一08:00 MYT）、月报（cron 0 0 1 * * UTC=每月1号08:00 MYT，覆盖上个月）、年报（cron 0 0 1 1 * UTC=每年1月1号08:00 MYT，覆盖上一年；1月1号这天月报年报都会跑）；用 github.event.schedule 判断这次是哪种周期。也可 workflow_dispatch 手动指定 periodType(week/month/year)+periodStart/periodEnd' },
      { label: '三段式job（setup→并行stage1→finalize）', text: '2026-08-07 从"单进程顺序跑完全部站点"改成分片并行——起因是推算年报单进程顺序跑50个站点要7+小时，超过 GitHub Actions 单 job 6小时硬上限。setup job 查询启用站点数，每10个站点分一片（sites-per-group=10）算出分片数；stage1 job 用 matrix 并行跑每个分片（各自跑 `scripts/research-report.ts --mode=stage1 --report-id= --shard= --shard-total=`，`fail-fast: false` 一个分片失败不连累其它分片）；finalize job（`if: always()`，即使某些分片失败也会跑）汇总所有分片结果做 Stage2 综合。三段之间用 GitHub Actions 原生 `needs:` 依赖排序，不依赖任何自定义的"是否还在跑"时间判断（这类判断只有真的超时那天才会触发，没法提前测出问题）' },
      { label: 'Stage 1（逐站点，分片内串行）', text: '每个分片内部对分到的 is_enabled=true 站点，用 lib/site-research-summary.ts 的 fetchSiteResearchSummary() 拉这段周期的权重/收录/涨跌/新增关键词/排名成效全量明细（不压缩，月报/年报同样是完整重新读原始数据，不是把周报文字汇总），用 lib/site-research-prompt.ts 的 buildSiteAnalysisPrompt() 建 prompt（要求AI判断权重上涨是否连续多天而非单日跳动），单次 callGeminiJSON 调用；这段时间完全没有任何抓取数据的站点直接跳过，不占AI调用；每次调用间隔4秒；单站点数据拉取失败或AI调用失败都不中断这个分片，记录失败原因后跳到下一个站点；每个站点跑完立刻 upsert 进 research_report_sites（每站点一行，按 report_id+site_id 唯一——分片并行写不会互相覆盖，这是跟旧版单进程共享一个 JSONB 数组列最大的区别）' },
      { label: '数据库索引（2026-08-07 修复）', text: 'rank_changes 原本没有覆盖 (site_id, stat_date, id) 的索引，查询计划器会退化成按主键id顺序全表扫描再过滤，真实数据验证过跑月报时单站点查询能耗时14秒并触发 statement timeout；已加 idx_rank_changes_site_date_id 索引，同一查询降到90毫秒。同时发现 raw_keywords 之前没走分页查询，活跃站点一年数据量能上万行，会被 Supabase/PostgREST 默认3000行硬顶静默截断（不报错，历史更早的关键词悄悄漏掉）——已改用 fetchAllRows 分页' },
      { label: '自己站点成效 vs 竞品成效（2026-08-07 拆开，不再混在一起）', text: '"成效"曾经只有竞品一段，用户反馈要跟自己站点的成效分开看。自己站点成效换回之前用过的机制：lib/tracking-summary.ts 的 fetchGroupEffectivenessSummary()，按 task_groups 逐个组读 site_tracking_records（组员提交内容+URL的排名/收录追踪），取 获取排名/获取收录/追踪中/无效 四分类计数 + 得分最高15条。竞品成效：lib/competitor-effectiveness.ts 的 fetchCompetitorEffectivenessSummary() 读 competitor_tracking_records（has_rank_title=true 的站点每天自动被 scripts/crawl.ts 的 runTracking() 追踪），取 有效/追踪中/无效 三分类计数 + 得分最高15条——已排除自己的站点（见下方"自己站点排除"）。两份都不单独占AI调用，原始数据直接留到 Stage 2 一起喂，在 finalize job 里算' },
      { label: '自己站点排除', text: '同一个 has_rank_title 开关不区分"自己的站点"和竞品——如果自己的站点也开了排名追踪（比如手机之家的 sjwyx.com），会被当成竞品统计进 competitor_tracking_records。lib/tracking-summary.ts 的 fetchOwnSiteDomains() 读 task_groups.site_domains（分组任务页面已有的"自己站点"字段，不是新建的标记机制）作为排除依据，竞品成效计算 + 研究中心"竞品成效"tab 的站点列表都会排除这些域名' },
      { label: '大环境输入', text: '查这段周期 environment_daily（大盘每日）+ environment_segments_daily（体量档位/内容侧重两个维度的分段数据）全部行，存进 research_reports.environment_input 做历史快照（不依赖以后这两张表的算法是否变化）' },
      { label: 'Stage 2（一次综合，finalize job）', text: '汇总 research_report_sites 里这份报告的全部站点结果（不分片，一次性查全部）+ 大环境数据（格式化文本）+ 自己站点成效原始数据 + 竞品成效原始数据一次性喂给 Gemini，maxOutputTokens=8192，要求返回 {environment, ownEffectiveness, competitorEffectiveness, conclusion} 四段 JSON，自己站点和竞品必须分开写；Stage2 本身崩溃会把报告标记 status=failed（不会像单个分片崩溃那样只是不影响别的分片，因为它是最后一段，没有后续步骤能兜底）' },
      { label: '写入表', text: 'research_reports（按 period_type+period_start+period_end 唯一 upsert；own_effectiveness/competitor_effectiveness/environment_input/report_sections 均为 jsonb；旧版遗留的 site_analyses 列不再写入但保留不删，读接口对拆分片之前生成的老报告仍会读这一列做兼容）/ research_report_sites（每站点一行，按 report_id+site_id 唯一，2026-08-07 新增，随 research_reports 级联删除）' },
      { label: '不写入', text: '不写 rules 表——"AI分析后可转成规则"的流程已随规则中心重构下线，报告是纯叙事性文字，不产出结构化规则' },
    ],
  },
  {
    key: 'competitor-tracking-ui',
    title: '竞品成效展示（研究中心）',
    badge: '纯展示，不新增抓取逻辑',
    items: [
      { label: '数据来源', text: '/api/research/competitor-sites 和 [id]/tracking 两个只读接口，直接查 competitor_tracking_records（写入逻辑见上方"成效追踪"小节，这里不重复实现）——研究中心"竞品成效"tab 是这张表第一次有UI展示；站点列表排除自己的站点（同上方 fetchOwnSiteDomains 逻辑）' },
      { label: '管理竞品站点', text: '研究中心"管理竞品站点"按钮列出全部站点（排除自己的站点，`?all=true` 查询参数），checkbox 预选中已经 has_rank_title=true 的站点；不是"新建站点"入口——域名/CSS选择器这些抓取配置已经在网站管理里配过了，这里只批量勾选/取消勾选，保存时对每个变化的站点调 PUT /api/sites 更新 has_rank_title' },
    ],
  },
  {
    key: 'environment-snapshot',
    title: '环境快照',
    badge: 'environment-snapshot.yml · GitHub Actions · 每日 07:15 MYT（cron 23:15 UTC）',
    items: [
      { label: '触发方式', text: 'GitHub Actions environment-snapshot.yml（cron 15 23 * * * UTC = 07:15 MYT），在所有日常抓取和重试完成后运行；也可 workflow_dispatch 手动指定日期；调用 GET /api/environment/daily-snapshot（含 Bearer CRON_SECRET）' },
      { label: '计算来源', text: '① rank_changes：统计目标日期全站涨/跌排名词总数及有数据站点数；② index_snapshots：对比目标日期与前一日各站收录数，计算平均变化百分比；③ 日期本身：计算星期几、是否中国大陆法定节假日、是否学生放假期间（暑假7-8月、寒假1月20日-2月底）' },
      { label: '写入表', text: 'environment_daily（按 date 唯一 upsert；字段：date, weekday, is_holiday, is_school_holiday, total_rankup, total_rankdown, sites_with_rank_data, avg_index_change_pct, sites_with_index_data, crawl_anomaly；永久保留）' },
      { label: 'crawl_anomaly 判定', text: '当日 total_rankup + total_rankdown = 0 时标记为 true，表示排名数据疑似未抓取到；用于在评分时排除异常日期的数据' },
      { label: '用途', text: '未来评分修正：若某日 avg_index_change_pct < -5% 或 crawl_anomaly=true，该日相关词的排名跌幅不计入规则失败评分（env_excluded）；积累半年后可分析规则在不同环境（节假日 / 暑假 / 算法波动日）下的差异表现' },
      { label: '节假日维护', text: '中国大陆法定节假日硬编码在 /api/environment/daily-snapshot/route.ts 的 PUBLIC_HOLIDAYS Set 中，每年国务院通知发布后手动追加 2026-2027 年份' },
    ],
  },
  {
    key: 'search',
    title: '站点情报查询',
    badge: '类型：search · 触发方式：页面搜索',
    items: [
      { label: '数据来源', text: '已追踪站点：Supabase 历史数据（weight_history / index_snapshots / rank_changes / raw_keywords）；未追踪站点：爱站实时接口' },
      { label: '不写入', text: '搜索操作不修改任何数据库表' },
      { label: '日志', text: '记录为 search，domain=查询域名，summary 显示是否已追踪及数据最新日期' },
    ],
  },
]

// Data retention periods (for reference in the rules modal)
export const RETENTION = {
  raw_keywords: '永久保留（2026-08-05 起，此前30天）',
  rank_changes: '永久保留（2026-08-05 起，此前30天）',
  competitor_kw_stats: '30天（按 stat_date）',
  weight_history: '永久保留',
  index_snapshots: '永久保留',
  keyword_volume: '永久保留',
  site_keyword_ranks: '永久保留',
  competitor_tracking_records: '永久保留',
  site_tracking_records: '永久保留',
  site_tracking_rank_matches: '永久保留',
  research_reports: '永久保留',
  research_report_sites: '永久保留（随 research_reports 级联删除）',
  activity_log: '7天（按 logged_at）',
  activity_site_log: '7天（随 activity_log 级联删除）',
}
