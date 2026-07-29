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
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.0-flash', 'gemini-flash-lite-latest', 'gemini-2.0-flash-lite']

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
