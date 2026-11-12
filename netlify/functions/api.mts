// سيرفر المزامنة لتطبيق الدرجات: حسابات (إيميل + كلمة سر) وتخزين بيانات كل حساب لوحده في Netlify Blobs
import type { Config, Context } from "@netlify/functions"
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { store, json, fail, sign, verify, userKey } from "../lib/auth.mts"

const DOC_RE = /^(students|app|backups)\/[\w.-]{1,80}$/
const COL_RE = /^(students|backups)$/
const hashPw = (pw: string, salt: string) => scryptSync(pw, salt, 64).toString("hex")

async function auth(req: Request, kind: "signup" | "login") {
  let b: { email?: string; pass?: string }
  try { b = await req.json() } catch { return fail("bad-request") }
  const email = String(b.email || "").trim().toLowerCase(), pass = String(b.pass || "")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("invalid-email")
  if (pass.length < 6) return fail(kind === "signup" ? "weak-password" : "invalid-credential")
  const s = store(), key = userKey(email)
  if (kind === "signup") {
    const salt = randomBytes(16).toString("hex"), uid = randomBytes(12).toString("hex")
    const { modified } = await s.setJSON(key, { uid, email, salt, hash: hashPw(pass, salt), at: Date.now() }, { onlyIfNew: true })
    if (!modified) return fail("email-already-in-use", 409)
    return json({ token: await sign(uid), email })
  }
  const u = (await s.get(key, { type: "json" })) as { uid: string; salt: string; hash: string } | null
  if (!u) return fail("invalid-credential", 401)
  const a = Buffer.from(hashPw(pass, u.salt), "hex"), h = Buffer.from(u.hash, "hex")
  if (a.length !== h.length || !timingSafeEqual(a, h)) return fail("invalid-credential", 401)
  return json({ token: await sign(u.uid), email })
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url), route = context.params.route || ""
  try {
    if (route === "signup" && req.method === "POST") return await auth(req, "signup")
    if (route === "login" && req.method === "POST") return await auth(req, "login")
    if (route === "ping") return json({ ok: true })

    const uid = await verify(req)
    if (!uid) return fail("unauthenticated", 401)
    const p = url.searchParams.get("p") || "", s = store(), base = "u/" + uid + "/"

    if (route === "doc") {
      if (!DOC_RE.test(p)) return fail("bad-path")
      if (req.method === "GET") return json({ data: await s.get(base + p, { type: "json" }) })
      if (req.method === "PUT") {
        const body = await req.text()
        try { JSON.parse(body) } catch { return fail("bad-request") }
        await s.set(base + p, body)
        return json({ ok: true })
      }
      if (req.method === "DELETE") { await s.delete(base + p); return json({ ok: true }) }
    }
    if (route === "batch" && req.method === "POST") {
      // رفع/حذف مستندات كتير في طلب واحد (أسرع بكتير من طلب لكل طالب)
      let b: { set?: Record<string, unknown>; del?: string[] }
      try { b = await req.json() } catch { return fail("bad-request") }
      const sets = Object.entries(b.set || {}), dels = Array.isArray(b.del) ? b.del : []
      if (sets.length + dels.length > 2000) return fail("too-many")
      if (!sets.every(([k]) => DOC_RE.test(k)) || !dels.every((k) => typeof k === "string" && DOC_RE.test(k))) return fail("bad-path")
      const ops: (() => Promise<unknown>)[] = [
        ...sets.map(([k, v]) => () => s.set(base + k, JSON.stringify(v))),
        ...dels.map((k) => () => s.delete(base + k)),
      ]
      for (let i = 0; i < ops.length; i += 50) await Promise.all(ops.slice(i, i + 50).map((f) => f()))
      return json({ ok: true, n: ops.length })
    }
    if (route === "col" && req.method === "GET") {
      if (!COL_RE.test(p)) return fail("bad-path")
      const { blobs } = await s.list({ prefix: base + p + "/" })
      const docs: { id: string; data: unknown }[] = []
      for (let i = 0; i < blobs.length; i += 100) {
        const part = await Promise.all(blobs.slice(i, i + 100).map(async (b) => ({
          id: b.key.slice(base.length + p.length + 1),
          data: await s.get(b.key, { type: "json" }),
        })))
        docs.push(...part.filter((d) => d.data != null))
      }
      return json({ docs })
    }
    return fail("not-found", 404)
  } catch (e) {
    console.error(e)
    return fail("server-error", 500)
  }
}

export const config: Config = {
  path: "/api/:route",
  rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ["ip", "domain"] },
}
