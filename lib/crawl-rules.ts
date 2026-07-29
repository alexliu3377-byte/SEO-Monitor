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
      { label: '清理', text: '每日关键词步骤结束后由 group0 执行：raw_keywords 30天，rank_changes 30天，competitor_kw_stats 10天' },
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
      { label: '抓取对象', text: '仅 is_enabled=true 且 has_rank_data=true 的站点；has_rank_data 由用户在网站管理手动开关，cron 不会自动修改该字段' },
      { label: '数据来源', text: '爱站移动端 baidurank.aizhan.com/mobile/…，抓涨入词与跌出词及搜索量' },
      { label: '浏览器验证', text: '爱站 2026-07 起给排名页加了浏览器指纹验证（简单层：302跳转+Set-Cookie；深层：约2分钟自动完成的环境探测挑战，纯 fetch 请求无法通过），抓取改用 Playwright headless Chromium：job 开始时用 createAizhanBrowserSession() 过一次验证（约2分钟，UA 随机选一个但整个 job 内固定不变），验证通过后本 job 内全部站点/页面复用同一浏览器 context 直接抓取，不逐页重新验证；job 若150秒内未通过验证会直接失败（AIZHAN_CHALLENGE_TIMEOUT），由 retry-crawl.yml 补跑；workflow 里对应加了 Install Playwright Chromium 步骤（仅 rank/rank-title 步骤触发）。即使验证通过后，单个页面请求仍可能被临时打回挑战页（2026-07-27 生产环境实测发现，如 greenxf.com 涨入从705条掉到0）：fetchHtml() 会识别挑战页（标题 Embed Iframe/安全检测中）并在同一页面请求内重试最多3次（间隔3秒），而不是当成"该页无数据"直接判定翻页结束' },
      { label: '并行策略', text: '排名段1-5同时并行（各开一个浏览器 page），段内按页顺序，每页间隔300ms；每页请求带 Referer=上一页URL（第1页 Referer=站点首页），模拟真实"点下一页"的跳转链，而不是每次都用固定 Referer（2026-07-27 加入：实测发现翻页 100% 卡在第1-2页、从未翻到第3页，怀疑新反爬专门检查翻页请求的 Referer 链）' },
      { label: '限流保护', text: '涨入完成后随机等3-5秒抓跌出（随机间隔减少爱站检测风险）；涨跌其中一方为0时等5秒重试1次；连续3站均为空触发熔断，暂停5分钟后补抓；涨入/跌出任一方>150但另一方=0时标记 suspect（疑似漏抓），不影响已有数据写入，由 retry-crawl.yml 05:00 MYT 自动重抓；站点间45秒间隔' },
      { label: '去重', text: '同关键词出现在多个排名段时保留搜索量最高的记录' },
      { label: '写入表', text: 'rank_changes（有数据时先删当日旧记录再插入）/ keyword_volume（涨入+跌出词搜索量，永久表，含 latest_trend 字段标记最新趋势；已有记录不被 volume=0 覆盖）' },
      { label: '静默失败风险', text: '爱站IP限流后返回空，两次重试都空则不写数据，标记 empty；单侧>150另侧=0时标记 suspect 供重抓；涨跌均为0无法区分"真无涨跌"与"被限流"，但单侧>150另侧=0基本可确认为漏抓' },
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
      { label: '涨跌排行的已知限制', text: 'Vercel 手动重抓/导出涨跌排行相关接口（/api/rank-changes、/api/export-rankup-history、/api/export-rank-history、/api/cron?step=rank）仍使用轻量 fetch 请求，未接入 Playwright（Vercel serverless 环境跑不了需等待约2分钟的 headless 浏览器）；爱站浏览器指纹验证生效期间这些接口可能抓取失败，这是已知的、可接受的降级——真正的日常抓取（GitHub Actions rank/rank-title 步骤）已改用 Playwright 解决' },
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
      { label: '抓取对象', text: 'sites 表中 has_rank_title=true 的站点；动态读取，每次运行重新查询' },
      { label: '数据来源', text: '爱站 baidurank.aizhan.com，移动端（/mobile/）+ PC端（/baidu/），各抓涨入和跌出，共 4 个组合；含标题（title）和排名页 URL（url）' },
      { label: '浏览器验证', text: '与 rank 步骤相同（详见 rank 小节"浏览器验证"），job 开始时用 createAizhanBrowserSession() 过一次约2分钟的爱站浏览器指纹验证，验证通过后本 job 内全部站点/平台/涨跌组合复用同一浏览器 context' },
      { label: '并行策略', text: '排名段 1-5 同时并行（各开一个浏览器 page），段内按页顺序，每页间隔 300ms；4 个组合顺序执行，组合间隔随机 3-5 秒；站点间间隔 60 秒' },
      { label: '翻页上限', text: '每段最多 15 页；抓取全部词（不过滤 volume=0）' },
      { label: '排名字段', text: '新排名（rank_position）= "第11名" → 11；原排名（prev_rank）= "50名外" → NULL；含页面标题（title）和排名页 URL' },
      { label: '写入表', text: 'site_keyword_ranks（永久保留，含 prev_rank + title + url，按 site_id+keyword+stat_date+platform+type 唯一，每次运行先删当日全部记录再写入）/ keyword_volume（移动端 rankup+rankdown，upsert；rankup 优先级高于 rankdown；含 latest_trend 字段）' },
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
      { label: '竞品追踪对象', text: '仅 has_rank_title=true 的竞品站点（与 rank-title 步骤相同）' },
      { label: '竞品信号来源', text: '① 排名信号（by keyword + by URL）：site_keyword_ranks 表中 stat_date=today + platform=mobile 的当日涨跌词；还通过 site_keyword_ranks.url 与 raw_keywords.source_url 交叉匹配（URL 优先级高，能捕获 keyword 名称不一致的案例）；② 收录信号：site_indexed_pages 表中 first_seen_date=today 的新收录 URL，通过 source_url 反查 raw_keywords 得到关键词' },
      { label: '竞品过滤条件', text: '信号词必须同时存在于 raw_keywords（60天内有提交记录）才会被记录；无提交记录的信号词跳过' },
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
    key: 'ai-discover',
    title: 'AI 规则发现',
    badge: 'Vercel Cron · 每周日 07:30 MYT（cron 23:30 UTC 周六）',
    items: [
      { label: '触发方式', text: 'Vercel Cron（vercel.json："30 23 * * 6"），每周日 07:30 MYT（UTC 周六 23:30）自动 GET /api/rules/ai-discover（含 Bearer CRON_SECRET 鉴权）；也可由 admin/super 手动 POST 同一端点触发' },
      { label: 'Layer 1 SQL', text: '① 查询近90天 competitor_tracking_records 中 effectiveness=有效 且 rule_id IS NULL 的案例（最多300条）；② 查询近90天所有有 rule_id 的记录，计算各规则近30天 vs 历史成功率，找出下降超过20百分点且数据量充足的规则' },
      { label: 'Layer 2 AI', text: 'Gemini（gemini-2.5-flash-lite，fallback to gemini-2.5-flash / gemini-2.0-flash）；仅将 Layer 1 的压缩摘要（按站点+月份分组，最多300条→50行摘要）传给 AI，而非原始数据库；responseMimeType=application/json 返回结构化 JSON' },
      { label: '最低触发阈值', text: '新案例不足10条 且 无下降规则 → 跳过（返回 skipped:true），避免无数据时浪费 API 调用' },
      { label: '写入表', text: 'rule_drafts（status=pending；draft_category=new_rule 表示新规则发现，rule_review 表示旧规则预警；永久保留，由管理员在规则中心审核后 approve/reject）' },
      { label: '不写入', text: '不直接写入 rules 表，所有 AI 建议须经人工审核' },
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
  raw_keywords: '30天（按 discovered_at）',
  rank_changes: '30天（按 stat_date）',
  competitor_kw_stats: '10天（按 stat_date）',
  weight_history: '永久保留',
  index_snapshots: '永久保留',
  keyword_volume: '永久保留',
  site_keyword_ranks: '永久保留',
  competitor_tracking_records: '永久保留',
  site_tracking_records: '永久保留',
  site_tracking_rank_matches: '永久保留',
  activity_log: '7天（按 logged_at）',
  activity_site_log: '7天（随 activity_log 级联删除）',
}
