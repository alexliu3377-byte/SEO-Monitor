import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, parseEnv } from 'node:util'
import { spawn } from 'node:child_process'

const allowed = new Set([
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'DAILY_LOGIN_SECRET',
])
const blocked = /^(?:TREND_|CONTENT_|GITHUB_|GH_|AIZHAN_|BAIDU_|GEMINI_|OPENAI_|ANTHROPIC_|SUPABASE_|NEXT_PUBLIC_|QIXIN_|CRON_SECRET$|DAILY_LOGIN_SECRET$|TURNSTILE_|NODE_OPTIONS$|__NEXT_)/i

function normalizedUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('测试项目 URL 格式无效；不输出配置值。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || url.pathname !== '/') {
    throw new Error('测试项目 URL 必须是没有路径、凭证和查询参数的 HTTP(S) 地址。')
  }
  return url.origin
}

// This isolates the launched child, not other terminals or Windows tasks.
export function localDevPlan({ root, parentEnv, testProjectUrl, port = '3001' }) {
  if (!testProjectUrl) throw new Error('请先确认独立测试项目，再传入 --test-project-url；检查不会连接数据库。')
  if (!/^\d+$/.test(String(port)) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error('端口必须在 1024–65535 之间。')
  }
  for (const file of ['.env', '.env.development', '.env.development.local']) {
    if (existsSync(path.join(root, file))) {
      throw new Error(`发现额外的 ${file}；先核对环境加载来源，安全入口不会自动改动文件。`)
    }
  }
  const filename = path.join(root, '.env.local')
  if (!existsSync(filename)) throw new Error('缺少 .env.local；请只填独立测试项目配置。')
  const config = parseEnv(readFileSync(filename, 'utf8'))
  if (Object.keys(config).some(key => !allowed.has(key))) {
    throw new Error('.env.local 含安全入口白名单外的变量；仅允许 Supabase 三项及 DAILY_LOGIN_SECRET。')
  }
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!config[key]?.trim() || config[key].includes('$')) throw new Error(`缺少有效的 ${key}（不支持变量展开）。`)
  }
  if (normalizedUrl(config.NEXT_PUBLIC_SUPABASE_URL) !== normalizedUrl(testProjectUrl)) {
    throw new Error('.env.local 与你指定的测试项目地址不匹配，已停止。')
  }
  const env = { ...parentEnv }
  for (const key of Object.keys(env)) {
    if (blocked.test(key) || /(?:SECRET|TOKEN|API_KEY|PASSWORD)$/i.test(key)) delete env[key]
  }
  // Empty values also prevent Next's env loader from supplying integration defaults.
  for (const key of ['TREND_INGEST_URL', 'TREND_INGEST_SECRET', 'GITHUB_PAT', 'GH_TOKEN',
    'GITHUB_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'CRON_SECRET', 'TURNSTILE_SECRET_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY']) env[key] = ''
  Object.assign(env, config, { NODE_ENV: 'development' })
  return {
    env,
    args: [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'test-project-url': { type: 'string' }, port: { type: 'string', default: '3001' }, check: { type: 'boolean' },
    } })
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const plan = localDevPlan({ root, parentEnv: process.env, testProjectUrl: values['test-project-url'], port: values.port })
    if (values.check) {
      console.log('本地配置与指定地址匹配；采集/远端任务凭证已从启动计划隔离。未连接数据库，未启动网站。')
    } else {
      console.log('启动本机开发服务。测试项目身份由你确认；该入口不是数据库只读模式。')
      const child = spawn(process.execPath, plan.args, { cwd: root, env: plan.env, stdio: 'inherit', shell: false })
      child.on('error', () => { console.error('无法启动本地 Next.js。'); process.exitCode = 1 })
      child.on('exit', (code) => { process.exitCode = code ?? 1 })
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : '本地启动检查失败。')
    process.exitCode = 1
  }
}
