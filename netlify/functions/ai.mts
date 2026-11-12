// سيرفر المساعد الذكي: بيوصل المنصة بسيرفر OmniRoute (بوابة ذكاء اصطناعي متوافقة مع OpenAI)
// الإعدادات في Netlify ← Site configuration ← Environment variables:
//   OMNIROUTE_URL       رابط السيرفر لحد /v1  مثال: https://my-omniroute.up.railway.app/v1
//   OMNIROUTE_API_KEY   مفتاح API من لوحة OmniRoute
//   OMNIROUTE_MODEL     (اختياري) الموديل، الافتراضي auto
//   AI_ALLOWED_EMAILS   (مهم) الإيميلات المسموح لها تستخدم المساعد، مفصولة بفاصلة
import type { Config } from "@netlify/functions"
import { store, json, fail, verify, userKey } from "../lib/auth.mts"

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
type Msg = { role: "user" | "assistant"; content: string | Part[] }

const MAX_MSGS = 16
const MAX_CHARS = 30000
const MAX_IMAGE = 2_000_000 // حجم الصورة بعد base64
const env = (k: string) => (globalThis as any).Netlify?.env?.get(k) ?? process.env[k] ?? ""

const SUBJECTS: Record<string, string> = {
  physics: "الفيزياء",
  chemistry: "الكيمياء",
  general: "الفيزياء والكيمياء",
}

function systemPrompt(subject: string) {
  const sub = SUBJECTS[subject] || SUBJECTS.general
  return `أنت "مساعد م. علي فرج"، مساعد تعليمي لمدرس ${sub} للثانوية العامة في مصر (المنهج المصري الحالي).
- اكتب بالعربي المصري البسيط والواضح، والمصطلحات العلمية بالعربي ومعاها الإنجليزي بين قوسين أول مرة.
- التزم بمنهج الثانوية العامة المصري ومستواه، ونبّه لو السؤال خارج المنهج.
- في حل المسائل: اكتب المعطيات، ثم القانون، ثم التعويض بالوحدات، ثم الناتج النهائي بوحدته، خطوة بخطوة.
- اكتب المعادلات كنص عادي مقروء (مثال: v = d / t ، a = 9.8 m/s²) ومتستخدمش LaTeX.
- في أسئلة الاختيار من متعدد: 4 اختيارات (أ، ب، ج، د) والإجابة الصحيحة وتعليل قصير لكل سؤال.
- استخدم عناوين قصيرة (##) ونقاط (-) وخط عريض (**) عشان الرد يتقري بسهولة على الموبايل.
- لو مش متأكد من معلومة قول كده بصراحة، ومتألفش أرقام أو قوانين.`
}

function cleanMessages(raw: unknown): Msg[] | null {
  if (!Array.isArray(raw) || !raw.length) return null
  const msgs: Msg[] = []
  let chars = 0
  for (const m of raw.slice(-MAX_MSGS)) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null
    if (!role) return null
    const text = String(m.text ?? "").slice(0, 8000)
    chars += text.length
    const img = typeof m.image === "string" ? m.image : ""
    if (img && (role !== "user" || img.length > MAX_IMAGE || !/^data:image\/(png|jpe?g|webp);base64,/.test(img))) return null
    msgs.push(img
      ? { role, content: [{ type: "text", text: text || "اشرح المسألة اللي في الصورة وحلها خطوة بخطوة." }, { type: "image_url", image_url: { url: img } }] }
      : { role, content: text })
  }
  if (chars > MAX_CHARS || msgs[msgs.length - 1].role !== "user") return null
  // الصور القديمة مش لازم تتبعت تاني: بنسيب آخر صورة بس عشان الطلب يفضل صغير
  let seenImage = false
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = msgs[i].content
    if (Array.isArray(c)) {
      if (seenImage) msgs[i].content = (c[0] as { text: string }).text
      seenImage = true
    }
  }
  return msgs
}

async function allowed(uid: string): Promise<boolean> {
  const list = env("AI_ALLOWED_EMAILS").split(",").map((e: string) => e.trim().toLowerCase()).filter(Boolean)
  if (!list.length) return true
  const s = store()
  for (const email of list) {
    const u = (await s.get(userKey(email), { type: "json" })) as { uid?: string } | null
    if (u?.uid === uid) return true
  }
  return false
}

export default async (req: Request) => {
  if (req.method === "GET") {
    return json({ ok: true, configured: !!(env("OMNIROUTE_URL") && env("OMNIROUTE_API_KEY")) })
  }
  if (req.method !== "POST") return fail("not-found", 404)

  const uid = await verify(req)
  if (!uid) return fail("unauthenticated", 401)
  if (!(await allowed(uid))) return fail("not-allowed", 403)

  const base = env("OMNIROUTE_URL").replace(/\/+$/, ""), key = env("OMNIROUTE_API_KEY")
  if (!base || !key) return fail("not-configured", 503)

  let b: { messages?: unknown; subject?: string }
  try { b = await req.json() } catch { return fail("bad-request") }
  const messages = cleanMessages(b.messages)
  if (!messages) return fail("bad-request")

  let upstream: Response
  try {
    upstream = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({
        model: env("OMNIROUTE_MODEL") || "auto",
        stream: true,
        temperature: 0.4,
        max_tokens: 3000,
        messages: [{ role: "system", content: systemPrompt(String(b.subject || "")) }, ...messages],
      }),
      signal: AbortSignal.timeout(25000), // لحد ما يبدأ الرد
    })
  } catch (e) {
    console.error("omniroute unreachable", e)
    return fail("upstream-unreachable", 502)
  }
  if (!upstream.ok || !upstream.body) {
    console.error("omniroute error", upstream.status, (await upstream.text().catch(() => "")).slice(0, 500))
    return fail(upstream.status === 401 || upstream.status === 403 ? "upstream-auth" : "upstream-error", 502)
  }

  // بنحول رد OmniRoute (SSE) لنص عادي بيوصل للموبايل حتة حتة
  const reader = upstream.body.getReader()
  const dec = new TextDecoder(), enc = new TextEncoder()
  let buf = ""
  const out = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { ctrl.close(); return }
        buf += dec.decode(value, { stream: true })
        let piece = "", i: number
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (data === "[DONE]") continue
          try {
            const j = JSON.parse(data)
            piece += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? ""
          } catch { /* سطر ناقص أو مش JSON */ }
        }
        if (piece) { ctrl.enqueue(enc.encode(piece)); return }
      }
    },
    cancel() { reader.cancel().catch(() => {}) },
  })
  return new Response(out, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  })
}

export const config: Config = {
  path: "/ai",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
