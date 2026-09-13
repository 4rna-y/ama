# ama

[4rnay.net](https://4rnay.net) のサイト本体(テーマ・ビルド設定・Worker)。
記事と画像は別リポジトリ [4rna-y/ama-cont](https://github.com/4rna-y/ama-cont) にある。

設計の全体像と判断理由は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照。

## 構成

- **Astro** (static) — サイト生成
- **Cloudflare Workers Static Assets** — ホスティング
- **D1** — PV / Like のカウンタ
- **satori + resvg** — OGP 画像をビルド時に生成
- **Pagefind** — 静的全文検索
- **Tailwind CSS v4**

## ローカル開発

記事リポジトリを隣にクローンしておく(`../ama-cont`)。`CONTENT_DIR` で上書きもできる。

```bash
pnpm install
pnpm dev                 # Astro dev サーバ。下書きも表示される
```

Worker と D1 まで含めて動かす場合:

```bash
pnpm build
pnpm cf d1 migrations apply ama --local
pnpm preview             # = wrangler dev
```

Cloudflare へのログインはローカル開発には不要。ローカル D1 と workerd だけで完結する。

## デプロイ

`main` への push、または `ama-cont` からの `repository_dispatch` で GitHub Actions が走る。
Cloudflare 側のビルド機能は使わず、Actions でビルドして `wrangler deploy` で直接アップロードする。

## スクリプト

| コマンド | 内容 |
|---|---|
| `pnpm dev` | Astro dev サーバ |
| `pnpm build` | `astro build` + Pagefind インデックス生成 |
| `pnpm preview` | `wrangler dev`(Worker + D1 込み) |
| `pnpm check` | Astro の型チェック |
| `pnpm cf <cmd>` | wrangler |
