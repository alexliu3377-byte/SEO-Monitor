# 当前 Windows 电脑开发隔离

只在 `C:\Users\OptiPlex 5060\cms\seo-monitor` 开发。Runner、旧 SEOCollector、浏览器资料、转写环境和计划任务维持原位。不要在 `_work` 修改代码或执行 npm ci。

Worker 已另建开发检出：`C:\Users\OptiPlex 5060\cms\trend-collector-worker`，来自本机 Git 仓库，基线 519f686，origin 指向原 GitHub Worker 仓库；未联网更新、安装依赖或复制任何未跟踪环境文件。它不会自动执行采集，也不改变任务实际运行路径。

## 启动入口

`npm.cmd run dev:safe` 使用 Node 24，默认监听 127.0.0.1:3001，只修改子进程环境。它要求明确输入已确认的独立测试项目 URL，并与 `.env.local` 比较，剥离继承的采集、GitHub、模型等凭证。不修改系统变量、采集配置或其他终端。

安全开发入口显式使用 Next 官方支持的 `--webpack`。2026-10-27 在当前电脑的隔离副本中，默认 Turbopack 构建遇到 CSS 子进程通信失败，普通权限重试也复现；Webpack 编译成功。这是本机兼容措施，不改生产 `build` 命令，也不声称其他环境的 Turbopack 一定失败。本机隔离构建可使用 `npm.cmd run build -- --webpack`，仍须避免加载生产凭证。

同日全量验证：主项目 246 项测试通过，Worker 75 项测试与类型检查通过。Webpack 完整构建（含生成的路由类型检查及 117 个页面生成）通过；期间发现并修复分组工作台、成效报告把组件自定义 props 当作页面 props 的问题，业务组件现与路由入口分离。构建使用隔离源码副本和假凭证，不能替代真实登录、生产 RLS 或采集新鲜度验证。沙箱中 Agent 文件替换曾返回 EPERM，普通 Windows 权限重跑通过；不为沙箱限制移除原子写入保护。

`.env.local` 仅允许 NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、可选 DAILY_LOGIN_SECRET。前三项必须来自同一个测试项目。存在 `.env`、`.env.development` 或 `.env.development.local` 时入口会拒绝启动，避免未审查的 Next 环境文件覆盖。不要为通过检查随意删除原配置。

先在 Supabase 项目管理中确认这是独立测试项目，然后运行（替换示例 URL）：

```powershell
npm.cmd run dev:safe -- --test-project-url https://你的测试项目.supabase.co --check
npm.cmd run dev:safe -- --test-project-url https://你的测试项目.supabase.co
```

`--check` 不发网络请求、不连接数据库、不启动 Next。地址匹配只是配置一致性检查，不自动证明该项目是测试库，也不验证密钥属于该项目。错误地指定生产地址仍可能写生产数据。启动前必须由负责人确认项目身份；不能给现有生产 URL 随便贴“测试”标签。

入口不是只读数据库代理，也不隔离其他手动脚本。原 `npm run dev`、build/start、采集命令仍保留原行为。当前任务未启动网站，未验证现有 `.env.local` 的测试/生产归属。不要在开发终端直接运行采集命令。

## 共机运行与后续维护

- 编译、转写和多个浏览器错峰，先观察实测内存再增加并发。不要结束未知 Node/Python/PowerShell 进程。
- B 站 Windows 任务直接引用 Runner `_work`，与 checkout/npm ci 有潜在重叠。解决需要维护窗口：记录任务和工作流状态、创建独立稳定 Worker 运行副本、固定版本及依赖、核对配置/profile/Node 路径、离线验证、仅切换指定任务引用、验证后保留回退。不要删除现有检出来“迁移”。
- 负责人于 2026-10-27 确认旧电脑没有本地采集任务；由 GitHub Actions 调度，需要浏览器的任务在当前常开电脑 Runner 上执行。远端仓库开关和数据新鲜度仍需核对。旧 05:30 B 站任务已禁用，不自动恢复；现有每 30 分钟补处理保留。
- 当前磁盘空间充足。旧 Runner 2.337.0 安装 ZIP（98.7 MB）已于 2026-10-27 移入回收站，可恢复，尚未释放回收站占用；Runner 旧版本程序、注册备份、旧 node_modules、模型和浏览器资料保留。

## 数据库基线

参阅 [共享审核规范](REVIEW_AND_RELEASE.md)。仓库尚无已验证的完整数据库基线，不能用 schema.sql 或全部历史迁移盲建测试库。本轮没有连接数据库、导出结构或执行迁移。
