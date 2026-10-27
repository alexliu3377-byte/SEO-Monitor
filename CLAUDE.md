# 奇心内容发布系统 — 开发规则

通用边界见 [AGENTS.md](AGENTS.md)。审核与发布统一使用 [docs/REVIEW_AND_RELEASE.md](docs/REVIEW_AND_RELEASE.md)，不得把历史 `supabase/schema.sql` 当完整初始化脚本执行。界面规范只约束现有奇心后台，不恢复已删除的页面设计系统。

## 抓取规则同步（重要）

每次修改以下任何一项时，必须同步更新 `lib/crawl-rules.ts`：

- 步骤触发时间或触发来源（GitHub Actions / Vercel）
- 写入的 Supabase 表或字段
- 站点间隔时间、重试次数、限流行为
- 去重逻辑或数据保留期
- 新增或删除抓取步骤

`lib/crawl-rules.ts` 是抓取日志页面 [规则] 弹窗的内容来源，也是唯一的规则文档，不更新会导致页面显示与实际逻辑不符。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
