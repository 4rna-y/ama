import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'
import { existsSync } from 'node:fs'

/**
 * 記事は別リポジトリ (4rna-y/ama-cont) にある。
 *   CI      : ./content        (actions/checkout で展開)
 *   ローカル : ../ama-cont      (隣にクローンしてある想定)
 * CONTENT_DIR で明示的に上書きもできる。
 */
const CONTENT_DIR =
  process.env.CONTENT_DIR ?? (existsSync('./content') ? './content' : '../ama-cont')

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: `${CONTENT_DIR}/posts` }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1),
      slug: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug は英小文字・数字・ハイフンのみ'),
      date: z.coerce.date(),
      updated: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
      description: z.string().min(1).max(200),
      cover: image().optional(),
      draft: z.boolean().default(false),
    }),
})

export const collections = { posts }
