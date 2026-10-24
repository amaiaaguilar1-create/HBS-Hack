// Optional LLM for the human lane. Uses ANTHROPIC_API_KEY or GEMINI_API_KEY if set;
// returns null otherwise (or on error/timeout) so the caller falls back to scripted replies.
const TIMEOUT_MS = 4000;

export const provider = () => (process.env.ANTHROPIC_API_KEY ? 'claude' : process.env.GEMINI_API_KEY ? 'gemini' : null);

function parseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

// messages: [{ role: 'user' | 'assistant', text }]
export async function llmJSON(system, messages) {
  const which = provider();
  if (!which) return null;
  try {
    if (which === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
          max_tokens: 400,
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.text })),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await r.json();
      return parseJSON(data?.content?.[0]?.text);
    }
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await r.json();
    return parseJSON(data?.candidates?.[0]?.content?.parts?.[0]?.text);
  } catch (e) {
    console.warn('LLM unavailable, using scripted reply:', e.name === 'TimeoutError' ? 'timeout' : e.message);
    return null;
  }
}
