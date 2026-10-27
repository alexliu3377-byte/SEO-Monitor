# 2026-10-27 审核修复交接

本轮按负责人“处理一下”在开发副本修复。没有提交、Push、部署、生产 SQL、补抓、重跑转写或更改 Windows 任务。线上仍需发布后验证，旧的累计 CPU 不会因代码修改归零。

## 已完成的代码

- 主项目 Next.js/eslint-config-next 固定16.4.3、Undici override7.30.1；更新 sharp、source-map-js、zod 及开发依赖兼容补丁。生产及全部依赖 npm audit 均0。
- 独立 Worker 开发副本仅更新 package-lock.json 中 Undici 补丁，npm audit为0；实际采集目录未更新。
- 反馈未读轮询仅在可见页运行，每5分钟刷新；按用户和角色隔离缓存，支持 Web Locks 跨标签页合并、网络超时、进行中防重复、已读事件失效刷新和卸载清理。正常新消息提醒最多等待5分钟，可见页重新聚焦会检查缓存。未使用付费服务。
- 反馈计数优先使用服务端聚合 RPC，只返回一个数；权限检查仍在 API，RPC 只对 service_role 开放。未迁移时兼容原分页读取逻辑；其它数据库错误不会被误当作0。
- 普通页面缺失月度/分组缓存时返回503和明确提示，不现场重算或写回。可用的旧快照保持原计算时间；月度界面显示过期提示。Worker 和显式管理员刷新入口保持原功能，历史归档保护保留。
- 关键词来源日期解析统一；跨MYT午夜的分钟/小时前按真实时间回退，非法日历日期保持未知。两个写入入口均不再用 yesterday 填充未知日期，保留NULL并标记suspect。未知日期单独跨批次去重，不计入来源日期统计；没有改写既有历史资料，没有新增清理策略。
- 健康检查增加小黑盒攻略/NS、MomoRank IP/热词36小时新鲜度，排除手动小红书每日要求；派生缓存任务结束后也调用只读健康检查，保留08:17独立计划，补充独立调度延迟时的检查入口。健康失败会让对应 Actions 出现失败提示，不等于采集电脑已关机。
- lint/TypeScript排除本机隔离构建目录，防止把生成的构建产物当业务代码检查。

## 验证

- 主项目全量255项通过；随后新增迁移未上线兼容测试单独通过（累计256项测试）。
- Worker75项通过、类型检查通过。
- 采集试验/健康检查9项通过；未执行生产采集。
- ESLint与TypeScript通过。
- 独立源码副本、假Supabase凭证、剥离继承密钥环境下 Next16.4.3 Webpack完整构建成功，生成117个页面。
- 独立内存PostgreSQL验证：3001条以上不截断、四种用户状态/角色、NULL及自己消息排除、不同时间区表示的已读比较、权限拒绝、重复应用。
- Windows沙箱原子rename测试遇到EPERM；普通Windows权限下完整测试通过，未削弱原子写保护。
- React变动复核：请求/事件清理、过期响应丢弃、用户缓存隔离及可访问状态提示。没有使用生产登录做页面写入测试。

## 待生产审核的精确SQL

文件：supabase/migrations/20261027054828_feedback_unread_count.sql。

仅新增/替换 public.get_feedback_unread_count(uuid)，SECURITY INVOKER、STABLE、固定search_path，撤销PUBLIC/anon/authenticated执行权限，仅授予service_role。无表结构更改、无数据回填、无删除。

前置对象：user_profiles(id,role,is_active)、development_requests(id,submitter_role,latest_message_at,latest_message_author_id)、development_request_message_reads(request_id,user_id,last_read_at)。这些是现有代码依赖；尚未取得正式库完整DDL与实际授权证据，不能以本地模拟结构代替。

应用前在明确目标项目只读确认上述列/类型、现有函数是否同名和service_role读取权限。只审查并执行这一文件，不运行schema.sql或全部历史迁移。应用后按不同角色验证结果、检查匿名/登录角色无法直调。应用代码先上线也可使用兼容路径；SQL后上线即可启用聚合。SQL未上线前，主要减负来自客户端轮询，旧服务端列表读取仍存在。

若需要回退，保留兼容代码；在确认没有其它调用方后移除新函数会回到缺失RPC兼容路径。生产回退操作同样需要授权。不能回滚为受漏洞影响的依赖版本来解决无关问题。

## 仍未闭环的事项

- 两个公开页面只读复测：momo_hot_words当前可以解析10条、来源日期10月26日；momo_ip仍未取得来源日期。不能用抓取时间伪造日期，未强制补写缓存。原快照保留。
- 7个空关键词来源、权重失败、收录/标题suspect与小黑盒攻略缺少今天记录，仍需对应来源/Worker日志和配置核查；本轮没有随意修改正式站点选择器或清空记录。
- 私有Worker定时Actions列表未取得；其运行状态不能由本地测试替代。
- 未知日期记录会保留待核查，现有按content_date保留期不会清理NULL记录。未来如需清理或恢复真实日期，单独审查身份、来源证据与保留期，不擅自处理历史数据。
- 当前.env.local仍指向正式Supabase，独立测试项目及完整schema基线尚未建立；不应用不完整历史schema创建测试库。
- Windows计划转写与Runner checkout/npm ci共用目录风险需要维护窗口和回退方案，本轮未切换任务路径。
- 尚未发布，不能声称线上CPU已经下降。发布后按相同生产环境/时间窗比较/api/feedback调用量、Active CPU、错误率与新鲜度，注意新消息提醒5分钟取舍。
