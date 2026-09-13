# 個人ブログ アーキテクチャ設計

最終更新: 2026-09-13

## 0. ゴールと制約

- 月額コスト $0(取得済みドメイン代のみ。ドメイン費用は考慮外)
- 記事(Markdown)と画像は専用リポジトリに push するだけで公開される
- OGP 画像は CI で自動生成する
- **記事ごとの PV(閲覧数)と Like を表示する**
- コメント機能は不要
- 運用の手数を最小化する(記事執筆時に触るのは content リポジトリのみ)
- 全リポジトリ private

## 1. 技術選定(確定)

| レイヤ | 採用 | 却下した候補 |
|---|---|---|
| SSG | **Astro** (static output) | Hugo, Eleventy |
| ホスティング | **Cloudflare Workers (Static Assets)** | Cloudflare Pages |
| PV / Like ストア | **Cloudflare D1** | Workers KV, Durable Objects, Analytics Engine |
| PV / Like API | **同一 Worker の `/api/*` ハンドラ** | 別 Worker, 外部 BaaS |
| CI/CD | **GitHub Actions**(Cloudflare 側のビルドは使わない) | Cloudflare Pages Build, GitLab CI |
| リポジトリ | **2リポジトリ分離 / 両方 private** (`ama-cont` / `ama`) | モノレポ |
| 画像 | **リポジトリ内に直接コミット** → ビルド時に AVIF/WebP 生成 | R2, Cloudflare Images, Git LFS |
| OGP | **satori + @resvg/resvg-js**(ビルド時静的生成 + 差分キャッシュ) | Workers 動的生成, canvaskit |
| 検索 | Pagefind(静的インデックス) | Algolia |
| コメント | **不要(採用しない)** | giscus, Disqus |
| 解析 | Cloudflare Web Analytics (cookieless) | GA4 |
| フィード | @astrojs/rss + @astrojs/sitemap | - |

### 選定理由の要点

- **Workers Static Assets**: 静的アセットへのリクエストは Worker のリクエスト課金にカウントされない。同一プロジェクトに `/api/*` の動的ハンドラを同居させられるため、PV / Like を別サービスに出さずに済む。
- **Cloudflare のビルドを使わない**: OGP 生成・日本語フォント処理・キャッシュ戦略を自前で組みたい。かつ Pages のビルド回数上限(月500回)に縛られない。副次的効果として、**Cloudflare にリポジトリへのアクセス権を渡さずに済む**(private 運用と相性が良い)。
- **Astro**: Content Collections + zod で frontmatter をスキーマ検証でき、メタデータの破損を CI で落とせる。画像最適化が組み込み。OGP をエンドポイントとして書けるため `astro build` の一部として静的生成される。
- **Git LFS 不使用**: GitHub LFS 無料枠はストレージ1GB・帯域1GB/月で、CI が毎回 fetch すると容易に課金に転ぶ。

## 2. 全体フロー

### ビルド / デプロイ時

```
[ama-cont / private] push to main
      │
      └─ dispatch.yml ── repository_dispatch(content-updated) ──┐
                                                                 │
[ama / private] deploy.yml ◄─────────────────────────────────────┘
      1. checkout ama
      2. checkout ama-cont → ./content   (読み取り専用 Deploy Key)
      3. pnpm install (キャッシュあり)
      4. restore OGP キャッシュ(キー: 記事メタのハッシュ)
      5. astro build
           ├ Content Collections で frontmatter 検証(失敗=デプロイ中止)
           ├ sharp: 記事画像 → AVIF/WebP × 3幅
           └ satori+resvg: 未キャッシュ記事の OGP PNG のみ生成
      6. pagefind --site dist(検索インデックス)
      7. wrangler d1 migrations apply ama --remote
      8. wrangler deploy(main) / wrangler versions upload(PR)
```

### リクエスト時

```
GET /posts/hello-world
    └─► 静的アセットとして即応答(Worker 実行なし・課金なし・エッジキャッシュ)
        └─ ブラウザ側 JS
             ├─ POST /api/view/hello-world  ─► Worker ─► D1 upsert ─► {views, likes}
             └─ POST /api/like/hello-world  ─► Worker ─► D1(重複チェック)─► {likes}
```

**HTML には PV / Like を埋め込まない。** 埋め込むと HTML がキャッシュできなくなり、静的配信の利点(無料・高速)を失う。数値はクライアント側から取得して描画する。

## 3. リポジトリ構成

コメントを採用しないため、**public リポジトリは一切不要**(giscus を使う場合のみ必要だった)。

### ama-cont(日常的に触るのはここだけ / private)

```
posts/
  2026/09/hello-world.md
  2026/09/hello-world/
    cover.jpg
    fig-1.png
.github/workflows/dispatch.yml
```

frontmatter スキーマ(zod で検証):

```yaml
---
title: "記事タイトル"
slug: "hello-world"        # URL と D1 の主キーを兼ねる。ファイル名変更でも壊れない
date: 2026-09-13
updated: 2026-09-14        # 任意
tags: [cloudflare, astro]
description: "OGP と meta description に使う要約"
cover: ./cover.jpg         # 任意。省略時は satori のテンプレ OGP
draft: false               # true は本番ビルドから除外、プレビューのみ表示
---
```

### ama(テーマ・ビルド定義・Worker / private)

```
src/
  content.config.ts          # Content Collections 定義(loader で ../content を読む)
  worker.ts                  # /api/* ハンドラ(PV / Like)
  layouts/, components/
    PostStats.astro          # PV / Like のクライアント側描画
  pages/
    index.astro
    posts/[...slug].astro
    tags/[tag].astro
    og/[...slug].png.ts      # OGP 生成エンドポイント
    rss.xml.ts
  styles/
migrations/
  0001_init.sql              # D1 スキーマ
public/
  _headers
  _redirects
assets/fonts/NotoSansJP-Bold.ttf   # OGP 用(ビルド時のみ使用、配信はしない)
astro.config.mjs
wrangler.toml
.github/workflows/deploy.yml
```

## 4. PV / Like の設計

### ストア選定: なぜ D1 か

| 候補 | 無料枠の書き込み上限 | 判定 |
|---|---|---|
| **D1** | **100,000 行/日 書き込み**、5,000,000 行/日 読み取り、5GB | **採用**。PV 1件 = 1行書き込みなので 10万PV/日まで耐える |
| Workers KV | **1,000 書き込み/日**、同一キーへの書き込みは 1回/秒 | **却下**。1日1,000PVで頭打ち。カウンタ用途に全く向かない |
| Durable Objects | 実質上限なし(メモリ内カウンタ + 定期永続化) | 保留。最も堅牢だが実装が重い。10万PV/日を超えたら移行 |
| Analytics Engine | 書き込みは潤沢だが読み出しが SQL API 経由 | 却下。Like のような状態管理ができない |

KV の 1,000 writes/day はカウンタ用途では致命的で、ここが選定の分岐点。

### スキーマ(migrations/0001_init.sql)

```sql
CREATE TABLE IF NOT EXISTS post_stats (
  slug  TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0
);

-- Like の重複防止。生 IP は保存せず、ソルト付きハッシュのみ
CREATE TABLE IF NOT EXISTS like_locks (
  key        TEXT PRIMARY KEY,   -- sha256(slug + ip + LIKE_SALT + 年月)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_like_locks_created ON like_locks(created_at);
```

記事の追加時に行を作る必要はない(upsert で自動生成される)。

### エンドポイント

| メソッド / パス | 動作 | 応答 |
|---|---|---|
| `POST /api/view/:slug` | views を +1 して現在値を返す | `{ views, likes }` |
| `POST /api/like/:slug` | 重複チェックを通れば likes を +1 | `{ likes, liked }` |
| `GET /api/stats?slugs=a,b,c` | 一覧ページ用の一括取得(Cache API で60秒キャッシュ) | `{ [slug]: { views, likes } }` |

### src/worker.ts(骨子)

```ts
interface Env {
  DB: D1Database
  ASSETS: Fetcher
  LIKE_SALT: string
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)

    const [, , action, slug] = url.pathname.split('/')

    if (action === 'view' && req.method === 'POST') {
      const row = await env.DB.prepare(
        `INSERT INTO post_stats (slug, views) VALUES (?, 1)
         ON CONFLICT(slug) DO UPDATE SET views = views + 1
         RETURNING views, likes`
      ).bind(slug).first()
      return Response.json(row)
    }

    if (action === 'like' && req.method === 'POST') {
      const ip = req.headers.get('CF-Connecting-IP') ?? ''
      const month = new Date().toISOString().slice(0, 7)
      const key = await sha256(`${slug}:${ip}:${env.LIKE_SALT}:${month}`)

      const lock = await env.DB.prepare(
        `INSERT INTO like_locks (key, created_at) VALUES (?, ?)
         ON CONFLICT(key) DO NOTHING`
      ).bind(key, Date.now()).run()

      if (lock.meta.changes === 0) {
        const cur = await env.DB.prepare(
          `SELECT likes FROM post_stats WHERE slug = ?`
        ).bind(slug).first<{ likes: number }>()
        return Response.json({ likes: cur?.likes ?? 0, liked: true })
      }

      const row = await env.DB.prepare(
        `INSERT INTO post_stats (slug, likes) VALUES (?, 1)
         ON CONFLICT(slug) DO UPDATE SET likes = likes + 1
         RETURNING likes`
      ).bind(slug).first()
      return Response.json({ ...row, liked: true })
    }

    return new Response('Not Found', { status: 404 })
  },
}
```

`main` を設定していても、**静的アセットに一致するリクエストは Worker を起動せずに配信される**。Worker が動くのは `/api/*` と 404 のみ。

### 不正・水増し対策

| 対象 | 対策 |
|---|---|
| PV のリロード水増し | `sessionStorage` に slug 単位で記録し、30分以内の再訪はカウントしない |
| PV のボット水増し | クライアント JS からのみ計上する(多くのクローラは JS を実行しない)。加えて `navigator.webdriver` が真なら送らない |
| Like の連打 | `localStorage` で UI 上の押下状態を保持 + サーバ側は `like_locks` で「slug × IPハッシュ × 月」単位の一意制約 |
| Like のスクリプト攻撃 | Workers の Rate Limiting バインディングで IP あたり n回/分に制限 |
| プライバシー | 生 IP は保存しない。ソルト付き SHA-256 のみ。ソルトは Secret で保持し、年月を混ぜるので月次で自動ローテートされる |

月次ローテートのため、同じ人が翌月に再度 Like できる。厳密な一意性より、リセットでスパムの蓄積を防ぐ挙動を優先している。`like_locks` は2ヶ月より古い行を Cron Trigger で削除する。

### Cloudflare Web Analytics との使い分け

両方併用する。役割が違う。

- **Web Analytics**: 自分が見る分析(リファラ、国、経路、期間比較)。ページに数値は出せない。
- **D1 カウンタ**: 訪問者に見せる表示用の数値。

JS 非実行のクローラを弾く関係で、両者の PV は一致しない。D1 側のほうが小さく出るのが正常。

## 5. 主要な設定ファイル

### wrangler.toml

```toml
name = "ama"
main = "src/worker.ts"
compatibility_date = "2026-09-01"

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "404-page"

[[d1_databases]]
binding = "DB"
database_name = "ama"
database_id = "<d1-database-id>"
migrations_dir = "migrations"

[triggers]
crons = ["0 4 1 * *"]   # 月次: 古い like_locks を削除
```

`LIKE_SALT` は `wrangler secret put LIKE_SALT` で登録(wrangler.toml には書かない)。

### public/_headers

```
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
/og/*
  Cache-Control: public, max-age=86400
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

`/_astro/` 配下はコンテンツハッシュ付きファイル名なので immutable で問題ない。`/api/*` は Worker が個別に `Cache-Control: no-store` を返す。

### src/pages/og/[...slug].png.ts(骨子)

```ts
import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { readFile } from 'node:fs/promises'

const font = await readFile('./assets/fonts/NotoSansJP-Bold.ttf')

export async function getStaticPaths() {
  const posts = await getCollection('posts', (p) => !p.data.draft)
  return posts.map((p) => ({ params: { slug: p.data.slug }, props: { post: p } }))
}

export const GET: APIRoute = async ({ props }) => {
  const svg = await satori(template(props.post.data), {
    width: 1200, height: 630,
    fonts: [{ name: 'NotoSansJP', data: font, weight: 700, style: 'normal' }],
  })
  const png = new Resvg(svg).render().asPng()
  return new Response(png, { headers: { 'Content-Type': 'image/png' } })
}
```

**日本語フォント**: Noto Sans JP フルセットは数MB あるが、ビルド時にメモリへ読むだけでクライアントには配信されない。ビルドが遅くなったら `subset-font` でタイトル使用文字のみにサブセット化する。

**OGP 差分生成**: `slug + title + description + updated` のハッシュをファイル名に含め、`actions/cache` で `dist/og/` を復元。ハッシュ一致分は再生成をスキップする。

### .github/workflows/deploy.yml(骨子)

```yaml
name: deploy
on:
  repository_dispatch:
    types: [content-updated]
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: 4rna-y/ama-cont
          path: content
          ssh-key: ${{ secrets.CONTENT_DEPLOY_KEY }}   # private repo 読み取り用(無期限)
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: actions/cache@v4
        with:
          path: .cache/og
          key: og-${{ hashFiles('content/posts/**/*.md') }}
          restore-keys: og-
      - run: pnpm build            # astro build && pagefind --site dist
      - name: Apply D1 migrations
        if: github.event_name != 'pull_request'
        run: pnpm wrangler d1 migrations apply ama --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Deploy
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            pnpm wrangler versions upload
          else
            pnpm wrangler deploy
          fi
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### ama-cont/.github/workflows/dispatch.yml

```yaml
name: notify site
on:
  push:
    branches: [main]
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - run: gh api repos/4rna-y/ama/dispatches -f event_type=content-updated
        env:
          GH_TOKEN: ${{ secrets.SITE_DISPATCH_TOKEN }}
```

## 6. シークレットと権限

| 名前 | 置き場所 | 中身 | 失効 |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub: ama | Workers Scripts: Edit **+ D1: Edit** のカスタムトークン | なし |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub: ama | - | - |
| `CONTENT_DEPLOY_KEY` | GitHub: ama | ama-cont に登録した**読み取り専用 Deploy Key** の秘密鍵 | **なし** |
| `SITE_DISPATCH_TOKEN` | GitHub: ama-cont | ama への dispatch 権限のみを持つ Fine-grained PAT | **あり** |
| `LIKE_SALT` | Cloudflare Worker Secret | Like の IP ハッシュ用ソルト(ランダム32バイト) | なし |

Deploy Key は 1 リポジトリにスコープが固定され有効期限もないため、private content の読み取りには PAT より適している。dispatch は REST API 呼び出しなので Deploy Key では代替できず PAT が必要。PAT 失効時は dispatch ワークフローが**失敗**するので、GitHub の失敗通知で検知できる。

D1 のマイグレーションを CI から流すため、API トークンには D1 の編集権限も要る点に注意。

## 7. private リポジトリ運用

両リポジトリとも **private で問題ない**。月額は $0 のまま。giscus を採用しないので、**public リポジトリは1つも不要**になった。

| 論点 | private の場合 | 対応 |
|---|---|---|
| Cloudflare からのリポジトリ参照 | **影響なし**。Actions から wrangler で直接アップロードするため、Cloudflare にリポジトリ権限を渡していない | 対応不要 |
| GitHub Actions 実行時間 | public の無制限が使えず、アカウント共通の無料枠(Free プランで月2,000分)を消費 | 下記試算のとおり十分収まる |
| Actions キャッシュ | public/private を問わずリポジトリあたり 10GB が無料 | 対応不要 |
| Artifacts / Packages ストレージ | Free プランは 500MB。アーティファクトをアップロードしない設計なので消費しない | 対応不要 |
| リポジトリ間のアクセス | 匿名 clone ができず、ama から ama-cont を読むのに認証情報が必要 | 読み取り専用 Deploy Key(無期限) |
| ビルドログ・プレビューURL | 外部から見えない | public 運用より安全(利点) |

### Actions 実行時間の試算

| 項目 | 値 |
|---|---|
| 無料枠(Free プラン / Linux ランナーは 1x 課金) | 2,000 分 / 月 |
| 1 ビルドの想定所要時間(キャッシュ有効時) | 3〜5 分 |
| 実行可能ビルド回数 | **月 400〜660 回**(1日13〜22回) |
| ama-cont 側の dispatch ワークフロー | 1回あたり約10秒。実質ゼロ |

枠を圧迫しうるのは「全画像の再生成」のような一括ビルドなので、`concurrency: cancel-in-progress`、パスフィルタ、画像出力キャッシュで抑える。

### public に切り替えるべきケース

Actions が月2,000分を超えそうな場合のみ。その際は **ama(重いビルドが走る側)だけを public にし、ama-cont は private のまま**にする(分数はワークフローが実行されるリポジトリに課金されるため)。ただし public リポジトリのシークレットに private content の読み取り鍵を置くことになる。fork からの `pull_request` にはシークレットが渡らないので窃取経路はないが、`pull_request_target` は絶対に使わないこと。

## 8. コスト内訳

| 項目 | 無料枠 | 想定使用量 | 費用 |
|---|---|---|---|
| Workers 静的アセット配信 | 無制限(リクエスト課金対象外) | 全ページ・全画像 | $0 |
| Workers リクエスト(`/api/*`) | 100,000 / 日 | PV 1件につき1〜2回 | $0 |
| D1 行書き込み | 100,000 / 日 | PV 1件 = 1行 | $0 |
| D1 行読み取り | 5,000,000 / 日 | 一覧ページの一括取得のみ | $0 |
| D1 ストレージ | 5 GB | 記事数×数十バイト。実質ゼロ | $0 |
| Cloudflare DNS / TLS / Web Analytics | 無制限 | - | $0 |
| GitHub Actions(private) | 2,000 分 / 月 | 月数十ビルド = 100〜200分 | $0 |
| GitHub Actions キャッシュ | 10GB / リポジトリ | 数百MB | $0 |
| GitHub リポジトリ容量 | 実質1GB目安 | 画像込みで数百MB以内に維持 | $0 |
| **合計** | | | **$0 / 月** |

**PV / Like を足しても無料枠の律速は変わらず 1日あたり約10万PV**(Workers リクエストと D1 書き込みが同時に効く)。個人ブログの想定を大きく上回る。

### 課金に転ぶ現実的なシナリオと対策

1. リポジトリが肥大化(画像) → 数百MB を超えたら大容量メディアだけ R2(無料枠10GB・エグレス無料)へ退避
2. Actions 2,000分/月を超過 → キャッシュを効かせる。足りなければ ama のみ public 化
3. 10万PV/日を超過 → PV 計上を Durable Objects のメモリ内カウンタ + 定期永続化に移行(書き込み回数が激減する)
4. Like の API を総当たりで叩かれる → Rate Limiting バインディングで抑止。既に対策済み
5. Cloudflare Images / Polish など有料機能の誤有効化 → 使わない

## 9. 運用上の設計判断

- **URL 安定性**: slug を frontmatter で明示。ファイル移動で URL が変わらない。**slug は D1 の主キーも兼ねる**ため、変更すると PV / Like がリセットされる。変更する場合は D1 側も `UPDATE post_stats SET slug = ?` で追従させ、`_redirects` に 301 を追加する。
- **HTML はキャッシュ可能に保つ**: PV / Like を HTML に埋め込まない。数値はクライアント側 fetch で描画する。
- **下書き**: `draft: true` は本番ビルドから除外し、PR のプレビューデプロイでのみ表示。
- **ビルド失敗の扱い**: frontmatter のスキーマ違反はビルドエラーにしてデプロイを中止する。
- **プレビュー**: PR で `wrangler versions upload` がプレビュー URL を返す。プレビューも本番 D1 を参照するため、**プレビューからの PV 計上は無効化する**(ホスト名で判定)。
- **ロールバック**: Workers のバージョン履歴から即時ロールバック可能。ただし D1 のマイグレーションは巻き戻らないので、破壊的変更は避ける。

## 10. 構築の順序

### 前提

| 役割 | GitHub | ローカル | 可視性 |
|---|---|---|---|
| サイト(テーマ・ビルド定義・Worker) | `4rna-y/ama` | `/home/rg/repos/ama` | private |
| 記事・画像 | `4rna-y/ama-cont` | `/home/rg/repos/ama-cont`(想定) | private |

Worker 名・D1 データベース名ともに `ama`。

### 手順

1. リポジトリ作成
   ```bash
   gh repo create 4rna-y/ama --private
   gh repo create 4rna-y/ama-cont --private
   ```
2. Cloudflare で Workers プロジェクト `ama` を作成 + 独自ドメイン割当(TLS は自動)
3. D1 作成し、返ってきた `database_id` を wrangler.toml に記入
   ```bash
   pnpm wrangler d1 create ama
   ```
4. `ama` を Astro で scaffold、ローカルで最小ページを表示
5. Deploy Key を生成し、`ama-cont` に公開鍵(read-only)/ `ama` の Secrets に秘密鍵を登録
   ```bash
   ssh-keygen -t ed25519 -f /tmp/ama-cont-key -N "" -C "ama-cont read-only"
   gh repo deploy-key add /tmp/ama-cont-key.pub -R 4rna-y/ama-cont -t "ama CI (read-only)"
   gh secret set CONTENT_DEPLOY_KEY -R 4rna-y/ama < /tmp/ama-cont-key
   shred -u /tmp/ama-cont-key /tmp/ama-cont-key.pub
   ```
6. Content Collections を `../content`(CI では `./content`)を読む loader として定義
7. OGP エンドポイント実装 + フォント配置
8. `migrations/0001_init.sql` 作成 → `wrangler d1 migrations apply ama --local` でローカル検証
9. `src/worker.ts` と `PostStats.astro` を実装。`wrangler dev` で PV / Like を動作確認
10. Like 用ソルトを登録
    ```bash
    pnpm wrangler secret put LIKE_SALT   # openssl rand -base64 32 の出力を貼る
    ```
11. Pagefind / RSS / sitemap 組み込み
12. GitHub のシークレット登録
    ```bash
    gh secret set CLOUDFLARE_API_TOKEN  -R 4rna-y/ama
    gh secret set CLOUDFLARE_ACCOUNT_ID -R 4rna-y/ama
    gh secret set SITE_DISPATCH_TOKEN   -R 4rna-y/ama-cont   # Fine-grained PAT
    ```
13. GitHub Actions 2本を配線
14. `ama-cont` に記事1本を push してエンドツーエンド確認
15. Cloudflare Web Analytics のビーコンを追加

## 11. 実装前に最新ドキュメントで再確認する項目

- **D1 無料枠の現行値**(行書き込み 100,000/日、行読み取り 5,000,000/日、ストレージ 5GB)— PV 上限の根拠になる数値なので最重要
- **Workers 無料枠のリクエスト上限**(100,000/日)と、静的アセットがカウント対象外である旨
- Workers Rate Limiting バインディングの提供状況と wrangler.toml 記法(ベータ機能のため変動しうる)
- Workers Static Assets の 1デプロイあたりファイル数上限・1ファイルサイズ上限(画像の多解像度展開が効くため、生成する幅は3〜4種に絞る)
- Workers Static Assets における `_headers` / `_redirects` のサポート状況
- `main` と `assets` を併用したときのルーティング優先順位(静的アセット優先 → Worker フォールバック)
- GitHub Actions の private リポジトリ無料枠(プランにより 2,000 / 3,000 分)

## 12. 実装で検証済みの事項(2026-09-13)

scaffold 時に実機で確認した結果。セクション11の確認項目のうち、以下は解決済み。

| 項目 | 結果 |
|---|---|
| NixOS で workerd が動くか | **動く**。nix-ld が有効で `/lib64/ld-linux-x86-64.so.2` が解決される。依存は libc/libm のみ。patchelf 不要 |
| D1 の upsert + RETURNING | **動く**。`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` で 1 クエリで加算と現在値取得を両立できる |
| Like の重複判定 | **動く**。`lock.meta.changes === 0` で既押しを判定できる |
| Cloudflare 認証なしのローカル開発 | **可能**。`wrangler dev --local` + ローカル D1 で API まで通しで動作 |
| satori の日本語描画 | **問題なし**。Noto Sans JP Bold (OTF/CFF) で正しくレンダリングされる。satori がグリフをパス化するため resvg 側にフォントは不要 |
| OGP 差分キャッシュ | **効く**。初回 575ms → キャッシュヒット 6ms |
| `main` + `assets` のルーティング | **静的アセット優先 → Worker フォールバック**で期待どおり。`/api/*` のみ Worker が起動し、404 は `not_found_handling` が効く |
| `_headers` | dist に配置され Workers Static Assets に反映される |

### 確定した依存バージョン

Astro 7.3.2 / Tailwind 4.3.3 / wrangler 4.131.1 / satori 0.33.4 / @resvg/resvg-js 2.6.2 / sharp 0.35.4 / pagefind 1.5.2

### 積み残しの注意点

- **Rate Limiting バインディングは experimental 扱い**。wrangler が `"unsafe" fields are experimental and may change or break at any time.` と警告する。設定は入れてあるが、記法が変わる可能性がある。ローカルでは remote 扱いのため実効性は本番でしか確認できない
- **フォントを 4.5MB コミットしている**(`assets/fonts/NotoSansJP-Bold.otf`)。1ファイルで増えないので許容範囲だが、気になるなら `subset-font` でビルド時サブセット化に切り替える
- **Cron トリガーはローカルでは発火しない**。`like_locks` の掃除は本番でのみ動作する
- **`database_id` は未設定**(オールゼロのプレースホルダ)。`pnpm cf d1 create ama` の出力で置き換える必要がある
- Pagefind が日本語のステミング非対応である旨を警告する。検索自体は動作する
