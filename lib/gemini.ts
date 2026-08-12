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
// 导致失败的原因；直接测过 gemini-2.5-flash/gemini-2.5-pro 系列这个
// 项目的账号也访问不了（同样404），目前真正能用的只有这两个。② 真正的
// 失败原因是当天配额用完了（"You exceeded your current quota"）——因为
// 当天做了大量验证性调用+一次性重跑三期报告，maxOutputTokens 又从1024
// 提到4096，短时间内消耗量比平时大很多；配额耗尽不是靠重试能解决的，
// 得等配额重置或换套餐。
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']

export async function callGeminiJSON<T>(
  prompt: string,
  opts?: { temperature?: number; maxOutputTokens?: number }
): Promise<{ result: T | null; error: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { result: null, error: 'GEMINI_API_KEY not configured' }

  let lastErr = ''
  for (const model of GEMINI_MODELS) {
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
