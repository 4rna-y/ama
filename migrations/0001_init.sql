-- Migration number: 0001	2026-09-13T00:00:00.000Z

CREATE TABLE IF NOT EXISTS post_stats (
  slug  TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0
);

-- Like の重複防止。生 IP は保存せず、ソルト付きハッシュのみを持つ。
-- キーに年月を含めるのでソルトは月次で実質ローテートされる。
CREATE TABLE IF NOT EXISTS like_locks (
  key        TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_like_locks_created ON like_locks (created_at);
