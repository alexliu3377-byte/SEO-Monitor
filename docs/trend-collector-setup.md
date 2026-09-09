# 趋势发现：个人电脑试行

第一阶段使用个人 Windows 电脑和独立的浏览器资料目录，低频读取小红书、抖音搜索结果首屏。小红书读取公开结果卡片，抖音读取搜索页自身返回的公开结果响应，不会逐条打开视频。采集器不会读取或上传账号密码、Cookie、图片、视频和完整评论；来源链接会先移除查询参数和锚点；遇到登录或验证要求会停止。

## 1. 建立数据库

在 Supabase SQL Editor 运行：

`supabase/migrations/20260908_trend_discovery_foundation.sql`

随后运行采集词设置迁移：

`supabase/migrations/20260909_trend_collection_queries.sql`

## 2. 配置网站接收密钥

生成一个至少 32 位的随机字符串，并在 Vercel 项目环境变量中新增：

`TREND_INGEST_SECRET`

保存后重新部署网站。这个密钥只用于采集电脑向网站提交信号，不能放进浏览器前端或提交到 Git。

## 3. 配置采集电脑

复制 `trend-collector.env.example` 为 `.env.trend.local`，填写：

- `TREND_INGEST_URL`：正式网站地址加 `/api/trend-discovery/ingest`
- `TREND_INGEST_SECRET`：与 Vercel 完全相同的随机字符串

`.env.trend.local` 和 `.trend-browser` 都已被 Git 忽略。

每个主题最多读取 12 条首屏结果，查询间隔等本机保护设置位于 `config/trend-collector.json`。

搜索什么词不需要再修改配置文件。项目负责人打开网站的“趋势发现”，点击右上角“设置采集词”，可以分别维护小红书和抖音的搜索入口词。采集器每次运行前会自动读取网站上保存的最新设置；网站暂时无法连接时，才会使用 `config/trend-collector.json` 中的备用词。

## 4. 首次登录

分别运行：

```powershell
npm run trend:setup -- --platform xiaohongshu
npm run trend:setup -- --platform douyin
```

程序会打开两个彼此独立的 Chrome 资料目录。完成登录并确认首页可访问后，回到终端按 Enter。

不要把日常使用的 Chrome 默认资料目录交给采集器。

## 5. 手动试跑

```powershell
npm run trend:collect -- --platform xiaohongshu
npm run trend:collect -- --platform douyin
```

完成后打开网站侧边栏的“趋势发现”。页面会显示节点状态、候选词、趋势分和来源链接。

修改采集词后不需要重新登录或重新部署。保存设置，再运行下一次 `npm run trend:collect` 即会生效。终端出现“已读取网站采集词”即表示读取成功。

第一周先每天手动运行一次并观察结果。确认选择器和数据质量稳定后，再配置 Windows 任务计划每天运行 4 次。

每次成功送回资料后，网站会一并执行保留规则：运行记录和互动快照保留 30 天，公开内容摘要保留最近 90 天；已经人工标记为“已布局”的候选词长期保留。

## 使用边界

- 仅使用专门的内部调研账号。
- 不破解验证码，不绕过访问控制。
- 不提高并发规避平台频率限制。
- 不采集私信、联系人、账号凭据或非公开内容。
- 不重新发布平台图片、视频或完整正文。
- 出现验证或访问频繁提示时停止，人工确认后再继续。
