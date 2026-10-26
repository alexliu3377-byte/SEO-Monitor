# Crawlee 三晨只读试跑与 GitHub 原生通知

试验目标：在实际 GitHub 托管 Runner 上验证小范围去重／重试和资料校验的可观察性，不替换现有采集器。不调用模型、不配置收费邮件服务；仍会消耗 GitHub Actions 分钟和短期报告存储，不能保证平台用量永远免费。

## 时间和范围

- 工作流：Collection readonly check；每日计划 08:17 MYT，GitHub 排队可能延迟，不是准点承诺。
- Crawlee 自动对照只运行 2026-10-27、28、29 三个早晨。此后仍保留只读健康检查；需要再比较可手动 Run workflow。
- 每次只读取牛酷网游戏列表和超好玩游戏列表各一页，同一份 HTML 同时跑旧规则／试验规则。没有第二次请求模拟旧程序，也不是完整多页采集对比。
- 并发 1；瞬时错误最多重试一次；403、429、重定向和超大响应直接失败，不尝试绕过登录／验证码。不访问详情页，不下载视频。
- 依赖在 tools/crawlee-trial 独立安装，正式网站 package.json／lockfile 不变。不会把此试跑搬进 Vercel Functions。
- 只保留摘要 JSON／Markdown，Actions artifacts 保存 7 天；无完整页面快照、Cookie、用户资料或视频文件。

## 明天怎么看

到仓库 Actions → Collection readonly check → 最新执行记录。展开两个 Job 的 Summary：

1. Crawlee 对照：来源状态、实际请求次数、耗时、旧规则候选／未知日期、试验详情／未知日期、排除分类入口数量，以及昨日资料数。
2. Daily collection health：keywords、weight、rank、rank-title、index-pages 今日批次的完成与完整性，以及 B 站当天有没有新的 last_seen_at。

旧规则未知日期不会在报告里伪填昨日。牛酷网分类入口过滤、超好玩“分钟前发布”等日期修正都是我们自己写的试验规则，不是 Crawlee 自动修好了业务逻辑。试验通过也不表示旧入库资料已被修正；以后切换或补写需要另做确认。

昨日是实际抓取时刻对应的 MYT 昨日；跨午夜的分钟前／小时前按真实时差计算。零条昨日资料不自动判漏抓；但无有效详情、无法解析日期、未来日期、请求失败会让试验失败。

## 邮件设置（需要本人开启）

打开 [GitHub 个人通知设置](https://github.com/settings/notifications)，在 Actions 开启 Email，需要的话选“仅失败通知”；确认绑定邮箱已验证，检查垃圾邮件。

GitHub 原生邮件依赖个人设置。定时工作流通知发给创建工作流／最后改 cron／重新启用它的用户，不等于所有仓库成员都会收到。[GitHub 官方说明](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)

独立健康检查故意在“流程结束但资料不完整”时返回失败，避免原流程绿色掩盖问题。暂未对持续异常静音：同一问题没解决，之后每天仍可能收到一次工作流失败通知；不是每个词一封。报告不输出业务资料标题、成员或密钥。

它在云端执行，所以采集电脑断电后仍能发现当天缺失结果；但只能说“逾期／未见新记录”，不能证明是断电，也不是实时心跳。如果 GitHub 自身没调度到，通知同样会迟到。现阶段不检查所有本地任务、不验证转写文本准确率，不自动恢复电脑、不重新跑失败采集、不重试旧转写失败条目。

## 本地验证

在 tools/crawlee-trial 运行 npm ci --ignore-scripts，再运行 npm test。测试只访问本地 HTTP 服务，覆盖重复入队、503 重试、403／429 不重试、重定向不跟随、响应大小限制、跨午夜日期、分类入口、未知／未来日期及业务完整性状态。

npm run trial 才会实际请求两个公开列表。health.mjs 使用现有 Supabase 配置，仅发两次有上限的 GET，不调用写接口或 RPC。所有报告在该目录 output/，已被 Git 忽略。
