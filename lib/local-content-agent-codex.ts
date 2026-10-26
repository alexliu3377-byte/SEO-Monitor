import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AGENT_DECISION_SCHEMA, type AgentModel } from './local-content-agent'

export function safeAgentEnvironment(environment: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const allowed = /^(path|pathext|systemroot|windir|comspec|systemdrive|temp|tmp|appdata|localappdata|userprofile|home|codex_home|programfiles(?:\(x86\))?|processor_architecture|number_of_processors|lang|lc_all|tz)$/i
  return { ...Object.fromEntries(Object.entries(environment).filter(([key, value]) => allowed.test(key) && typeof value === 'string')), NODE_ENV: 'production' }
}
export function codexAgentArguments(schema: string, output: string) {
  return ['--no-daemon', '-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only',
    '--skip-git-repo-check', '--color', 'never', '--json',
    '-c', 'forced_login_method="chatgpt"', '-c', 'web_search="disabled"', '-c', 'model_provider="openai"',
    '-c', 'project_doc_max_bytes=0', '-c', 'history.persistence="none"',
    ...['shell_tool', 'unified_exec', 'apps', 'hooks', 'multi_agent', 'remote_plugin', 'memories', 'goals', 'shell_snapshot'].flatMap(flag => ['--disable', flag]),
    '--output-schema', schema, '--output-last-message', output, '-']
}
function execute(executable: string, args: string[], cwd: string, input = '', timeout = 150000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: safeAgentEnvironment(process.env), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', exceeded = false
    const timer = setTimeout(() => { exceeded = true; child.kill() }, timeout)
    function collect(chunk: Buffer, stream: 'stdout' | 'stderr') {
      if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8')
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 2 * 1024 * 1024) { exceeded = true; child.kill() }
    }
    child.stdout.on('data', chunk => collect(chunk, 'stdout'))
    child.stderr.on('data', chunk => collect(chunk, 'stderr'))
    child.stdin.on('error', () => {})
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 Codex，请安装受支持版本或设置 QIXIN_CODEX_EXECUTABLE 为 codex.exe 的完整路径')) })
    child.on('close', code => {
      clearTimeout(timer)
      if (exceeded) return reject(new Error('Codex 超时或输出超过上限；本次停止，不自动重试'))
      if (code !== 0) return reject(new Error(`Codex 执行失败（退出码 ${code}）；请检查登录、套餐额度、网络或本机安全设置。本次不切换到收费 API。`))
      resolve(stdout + (args.includes('status') ? stderr : ''))
    })
    child.stdin.end(input)
  })
}
export async function checkLocalAgentCodex(executable = process.env.QIXIN_CODEX_EXECUTABLE || 'codex') {
  const cwd = tmpdir()
  const help = await execute(executable, ['exec', '--help'], cwd, '', 15000)
  if (!help.includes('--ignore-user-config')) throw new Error('Codex 版本不支持隔离用户配置，请先升级 Codex')
  const auth = await execute(executable, ['-c', 'forced_login_method="chatgpt"', 'login', 'status'], cwd, '', 15000)
  if (!/logged in using chatgpt/i.test(auth)) throw new Error('仅支持本机 ChatGPT 登录；请先 codex login，不会使用 API Key 兜底')
  return { executable, authentication: 'chatgpt' as const }
}
export function createLocalCodexModel(executable: string): AgentModel {
  const startedAt = Date.now()
  return async (prompt, turn) => {
    if (Date.now() - startedAt > 300000) throw new Error('Agent 总运行时间超过 5 分钟，本次停止')
    const workspace = await mkdtemp(path.join(tmpdir(), 'qixin-content-agent-'))
    const schemaFile = path.join(workspace, 'schema.json'), outputFile = path.join(workspace, 'result.json')
    try {
      await writeFile(schemaFile, JSON.stringify(AGENT_DECISION_SCHEMA), { encoding: 'utf8', mode: 0o600 })
      const events = await execute(executable, codexAgentArguments(schemaFile, outputFile), workspace, prompt, Math.min(150000, 300000 - (Date.now() - startedAt)))
      for (const line of events.split(/\r?\n/).filter(Boolean)) {
        let event
        try { event = JSON.parse(line) } catch { throw new Error(`Codex 第 ${turn} 轮没有返回可验证事件`) }
        if (event.type === 'turn.failed' || event.type === 'error') throw new Error(`Codex 第 ${turn} 轮失败；本次停止，不自动重试`)
        if (['command_execution', 'mcp_tool_call', 'web_search', 'file_change'].includes(event.item?.type)) throw new Error('检测到非本 Agent 的原生工具动作，本次结果不予采用')
      }
      return JSON.parse(await readFile(outputFile, 'utf8'))
    } finally {
      // Only known generated files; never recursively delete a computed directory.
      await unlink(schemaFile).catch(() => {})
      await unlink(outputFile).catch(() => {})
      await rmdir(workspace).catch(() => {})
    }
  }
}
