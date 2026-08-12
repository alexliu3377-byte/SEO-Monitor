// Shared Gemini REST caller for structured-JSON prompts. Extracted 2026-07-29
// after discovering the two previously-hardcoded model lists (ai-discover,
// analyze-selector) both led with models Google has since retired
// (gemini-2.5-flash-lite and gemini-2.5-flash both 404 "no longer available
// to new users" as of this date) — and the old per-route fallback loop only
// advanced to the next model on a 429, so a 404 on the first model broke the
// whole call silently. This helper advances on ANY failure (wrong model name,
// retired model, rate limit, unparseable output) so one bad model can't wedge
// the whole thing, and centralizes the model list so a future retirement only
// needs fixing in one place.
//
// 2026-08-12：research-report v1 重新跑三期报告时发现大量站点分析失败
// （19/51、25/51、30/51），排查发现两件事——① gemini-2.0-flash/
// gemini-2.0-flash-lite 这两个型号已经彻底下线（404 "no longer
// available"，不是限流），列表里留着它们纯粹浪费一次快速失败的往返，
// 而且会让日志里最后记录的错误显示成这两个已下线型号的404，掩盖了真正
// 导致失败的原因；gemini-2.5-flash/gemini-2.5-pro 系列这个项目的账号
// 也访问不了（同样404 "no longer available to new users"，即使
// ai.dev/rate-limit 面板上显示这两个型号还有配额——面板列出的型号不等于
// 这个key真能调，得实测确认）。② 真正的失败原因是这个key是免费层，
// 每个型号各自独立算配额（不是共享一个总池），gemini-flash-latest
// （面板上叫"Gemini 3.6 Flash"）单独只有20次/天，之前只有它+
// gemini-flash-lite-latest两个型号，所有调用全挤这两个桶，20次/天那个
// 几乎立刻打满。用户在 ai.dev/rate-limit 上贴出完整面板后发现还有
// gemini-3.5-flash（0/20，全新没用）、gemini-3.1-flash-lite（4/500，
// 大量余量）这两个实测真能调的型号，加进来把请求摊到4个配额桶，不再
// 集中打爆一两个。仍然只是缓解——免费层配额加起来的量对51个站点/期的
// 报告规模还是紧张，长期应该考虑升级付费层（面板/开key的地方能操作，
// 只有账号所有者能做，见 project_gemini_model_quota_2026_08 记忆）。
// 四个型号在这个账号上各自独立算配额（不是共享一个总池），Flash Lite档
// 通常配额比正牌Flash档宽松得多（实测 gemini-3.1-flash-lite/
// gemini-flash-lite-latest 都是500次/天，gemini-3.5-flash/
// gemini-flash-latest 只有20次/天）——所以按"这次调用是走量还是走质"分成
// 两组优先顺序，不再所有调用共用同一个顺序：
// BULK_MODELS：Stage1这类单份报告要连续调几十次的场景，配额是硬约束，
//   优先选配额宽松的Lite档，正牌Flash放最后兜底。
// QUALITY_MODELS：Stage2综合报告/站点诊断/selector识别这类低频单次调用，
//   配额不是瓶颈，优先选推理能力更强的正牌Flash档。
export const BULK_MODELS = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-flash-latest']
export const QUALITY_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite']

export async function callGeminiJSON<T>(
  prompt: string,
  opts?: { temperature?: number; maxOutputTokens?: number; models?: string[] }
): Promise<{ result: T | null; error: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { result: null, error: 'GEMINI_API_KEY not configured' }
  const models = opts?.models ?? QUALITY_MODELS

  let lastErr = ''
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: opts?.temperature ?? 0.4,
              maxOutputTokens: opts?.maxOutputTokens ?? 2048,
              responseMimeType: 'application/json',
            },
          }),
        }
      )
      if (r.ok) {
        const data = await r.json()
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        try {
          return { result: JSON.parse(text) as T, error: '' }
        } catch {
          lastErr = `${model} 返回了无法解析的内容: ${text.slice(0, 200)}`
          continue
        }
      }
      lastErr = `${model} -> ${r.status}: ${(await r.text()).slice(0, 300)}`
    } catch (e) {
      lastErr = `${model} -> 请求异常: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return { result: null, error: lastErr || 'Gemini 调用失败' }
}
