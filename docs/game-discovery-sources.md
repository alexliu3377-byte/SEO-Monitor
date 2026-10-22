# 游戏发现：微信与 MomoRank 公开资料

## 导航

- 内容发现 → 游戏 → 搜索趋势：第三列显示 MomoRank 热搜词（替换原空位）。
- 内容发现 → 游戏 → 平台资讯：保留原来源，增加抖音小游戏、微信小游戏、MomoRank。
- MomoRank 资料类型：上升榜、人气榜、畅销榜、畅玩榜、热搜访问、IP 热度。热搜词不在这里重复展示。
- 微信资料类型：人气榜、畅销榜、畅玩榜。未虚构最新上线榜。

## 数据边界与时效

微信直接读取 `xiaoyouxi.qq.com/rankdetail/2.html`、`3.html`、`4.html` 的公开官网展示，每榜最多 100 条。2026/10/21 实测三页修改时间均为 2026/07/15；其页面内数据请求不带凭证返回 401。因此仅视作时效未确认的官网展示快照，不称“今日排名”或“实时资料”。资料日期保持 null，网页修改时间独立保存，不冒充榜单日期。仅提取游戏 ID、名称、简介和分类；明确丢弃原页无关的朋友姓名、头像、账号、启动凭证、下载数据等。

MomoRank 只读公开网页前十条，不登录、不使用付费接口/导出、不解析隐藏的付费 hydration JSON，不移除付费模糊效果。仅重建 Next.js 公开内容的标准流式 DOM 槽位（S:n）。来源资料日期是必填字段，不能用采集时间补上。原站 IP 热度保留为来源综合指数，上升值保留为榜单名次变化；均不解释为百度搜索量。

后台每天采集，页面只查询该来源当前类型当前 20 条，打开、筛选、翻页、重试均不直接访问外站。SQL 事务按类型原子替换；无效、空结果、较旧来源日期或较旧任务不会覆盖成功缓存。显示总数为本地实际保存条数，不把原站未解锁数量计入可翻页数量。

## 上线顺序

1. 在正确项目执行本次两份迁移：`20261021_douyin_minigame_rankings.sql`、`20261021_game_discovery_sources.sql`。不要批量推送其他历史迁移。
2. 发布后台，再更新独立采集仓库。两个仓库复用既有 `TREND_INGEST_URL` / `TREND_INGEST_SECRET`，不需要新登录或购买会员。
3. 手动触发 `Collect Douyin minigame rankings` 和 `Collect game discovery sources` 的微信/MomoRank 来源，确认接受条数与页面。
4. 定时预设 MYT：03:15 抖音、03:30 微信、03:45 MomoRank，每天一次。不会改动既有 SEO、吾爱、4399、虫虫助手或电脑任务。GitHub 可能排队，预设时间不是准点完成承诺。

## 本地只读测试与手动写入

```
npm.cmd run content:discovery -- --source momorank
npm.cmd run content:discovery -- --source wechat
```

单类型可加 `--dataset momo_hot_words` 等白名单标识。明确入库时再加 `--write`。主项目默认读 `.env.trend.local`，采集仓库默认读 `.env.local`，可用 `TREND_ENV_FILE` 指向原有环境文件。密钥不放到浏览器，不输出到日志。

每种网页最多请求一次，页面之间等待 8 秒；来源返回 401/403/429 立即停止该来源后续访问。后台入库认证/服务失败也停止，不继续浪费外站请求。其他解析失败保留该类型旧资料，其余类型可以独立完成。

## 验证

- `npm.cmd test`、TypeScript、ESLint。
- `node scripts/verify-game-discovery-browser.mjs`：真实 ChartsClient，仅本地 GET 夹具；检查导航、独立加载、日期、分页、错误和 375px 布局。
- `node scripts/verify-game-discovery-sql.mjs`：本地 PGlite，检查事务、公开范围、日期防回退、服务权限和 SQL 分页。可用 `PGLITE_MODULE_PATH` 指向已安装模块。
