# 抖音小游戏官方榜单

位置：内容发现 → 游戏 → 平台资讯 → 抖音小游戏。

仅使用抖音小游戏官网公开榜单，不经过 DataEye 或第三方榜单。三个榜单各采集最多前 100 款，来源请求最多两次，每次每榜 50 款，中间等待 8 秒。403、429、异常结构或部分榜单缺失直接停止，不使用代理切换或验证码绕过。

## 上线顺序

1. 在正确的 Supabase 项目执行 `supabase/migrations/20261021_douyin_minigame_rankings.sql`（仅本次迁移，不批量推送其他迁移）。
2. 发布后台；确认 `TREND_INGEST_SECRET` 与采集仓库一致。
3. 更新独立采集仓库并手动运行 `Collect Douyin minigame rankings`。沿用该仓库的 `TREND_INGEST_URL` / `TREND_INGEST_SECRET`，无需新账号或登录。
4. 验证后台出现三类榜单、时间与分页后，保留每日一次的 03:15 MYT 定时任务。GitHub schedule 可能排队，03:15 是计划触发时间，不保证准点。

本仓库本地只读验证：`npm.cmd run content:minigames`。
明确写入：`npm.cmd run content:minigames -- --write`。
本地默认读取 `.env.trend.local`，可用 `TREND_ENV_FILE` 指定已有环境文件；不要复制或公开密钥。

## 数据边界

- 官网公开请求是页面内部接口，不等于具有稳定性承诺的开放 API；需持续监控布局和返回结构变化。
- 保存游戏 ID、名称、简介、榜单、排名与采集时间；不虚构上线时间、搜索量、下载量或 APK 链接。
- 数据库按采集日期保存，使用事务同时发布三个榜单；重复任务幂等，较旧任务不能覆盖同一天较新结果。
- 浏览器只读最近一次成功快照、当前榜单当前 20 条；翻页和重试不会访问抖音。原始榜单的来源链接位于资料标题旁，不放在来源按钮上。
- 微信及 MomoRank 的独立展示缓存见 `docs/game-discovery-sources.md`；微信仅接公开官网展示快照，时效未确认，不与抖音榜单混淆。
