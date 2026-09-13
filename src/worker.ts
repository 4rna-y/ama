/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  LIKE_SALT: string
  /** wrangler.toml の unsafe binding。未設定でも動くよう optional にしている */
  RATE_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> }
}

/** 想定外のキーで D1 を汚さないための検証。content.config.ts の zod と同じ規則 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function readStats(env: Env, slug: string) {
  const row = await env.DB.prepare('SELECT views, likes FROM post_stats WHERE slug = ?')
    .bind(slug)
    .first<{ views: number; likes: number }>()
  return row ?? { views: 0, likes: 0 }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    // 静的アセットに一致するリクエストはそもそもここへ来ない。
    // 来るのは /api/* と、どのアセットにも一致しなかった 404 のみ。
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)

    const [, , action, rawSlug] = url.pathname.split('/')
    const slug = decodeURIComponent(rawSlug ?? '')
    if (!SLUG_RE.test(slug)) return json({ error: 'invalid slug' }, 400)

    // 現在値の取得のみ(カウントしない)
    if (action === 'stats' && req.method === 'GET') {
      return json(await readStats(env, slug))
    }

    // PV 計上
    if (action === 'view' && req.method === 'POST') {
      const row = await env.DB.prepare(
        `INSERT INTO post_stats (slug, views) VALUES (?, 1)
         ON CONFLICT(slug) DO UPDATE SET views = views + 1
         RETURNING views, likes`,
      )
        .bind(slug)
        .first<{ views: number; likes: number }>()
      return json(row ?? { views: 1, likes: 0 })
    }

    // Like
    if (action === 'like' && req.method === 'POST') {
      const ip = req.headers.get('CF-Connecting-IP') ?? '0.0.0.0'

      if (env.RATE_LIMIT) {
        const { success } = await env.RATE_LIMIT.limit({ key: ip })
        if (!success) return json({ error: 'rate limited' }, 429)
      }

      const month = new Date().toISOString().slice(0, 7)
      const key = await sha256(`${slug}:${ip}:${env.LIKE_SALT}:${month}`)

      const lock = await env.DB.prepare(
        `INSERT INTO like_locks (key, created_at) VALUES (?, ?)
         ON CONFLICT(key) DO NOTHING`,
      )
        .bind(key, Date.now())
        .run()

      // 既に押している場合は加算せず現在値を返す
      if (lock.meta.changes === 0) {
        const { likes } = await readStats(env, slug)
        return json({ likes, liked: true })
      }

      const row = await env.DB.prepare(
        `INSERT INTO post_stats (slug, likes) VALUES (?, 1)
         ON CONFLICT(slug) DO UPDATE SET likes = likes + 1
         RETURNING views, likes`,
      )
        .bind(slug)
        .first<{ views: number; likes: number }>()
      return json({ ...(row ?? { views: 0, likes: 1 }), liked: true })
    }

    return json({ error: 'not found' }, 404)
  },

  /** 月次: 2ヶ月より古い like_locks を掃除する */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const cutoff = Date.now() - 62 * 24 * 60 * 60 * 1000
    await env.DB.prepare('DELETE FROM like_locks WHERE created_at < ?').bind(cutoff).run()
  },
}
