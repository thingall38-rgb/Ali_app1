// مشترك بين سيرفر المزامنة وسيرفر المساعد الذكي: التخزين والتوكن
import { getStore } from "@netlify/blobs"
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto"

export const store = () => getStore({ name: "ali-grades", consistency: "strong" })
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } })
export const fail = (code: string, status = 400) => json({ code }, status)

const TOKEN_DAYS = 365

async function secret(): Promise<string> {
  const s = store()
  const cur = await s.get("sys/secret", { type: "text" })
  if (cur) return cur
  await s.set("sys/secret", randomBytes(32).toString("hex"), { onlyIfNew: true })
  return (await s.get("sys/secret", { type: "text" })) as string
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url")
export async function sign(uid: string) {
  const exp = Date.now() + TOKEN_DAYS * 864e5
  const body = b64(JSON.stringify({ uid, exp }))
  return body + "." + b64(createHmac("sha256", await secret()).update(body).digest())
}
export async function verify(req: Request): Promise<string | null> {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  const [body, sig] = t.split(".")
  if (!body || !sig) return null
  const good = createHmac("sha256", await secret()).update(body).digest()
  const got = Buffer.from(sig, "base64url")
  if (got.length !== good.length || !timingSafeEqual(got, good)) return null
  try {
    const { uid, exp } = JSON.parse(Buffer.from(body, "base64url").toString())
    return typeof uid === "string" && exp > Date.now() ? uid : null
  } catch { return null }
}
export const userKey = (email: string) => "users/" + createHash("sha256").update(email).digest("hex")
