import { getCollection, type CollectionEntry } from 'astro:content'

export type Post = CollectionEntry<'posts'>

/** 本番では draft を除外。dev / preview では表示する。 */
export const includeDrafts = import.meta.env.DEV || process.env.INCLUDE_DRAFTS === '1'

export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => includeDrafts || !data.draft)
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
}

export async function getTags(): Promise<Map<string, Post[]>> {
  const map = new Map<string, Post[]>()
  for (const post of await getPosts()) {
    for (const tag of post.data.tags) {
      const list = map.get(tag) ?? []
      list.push(post)
      map.set(tag, list)
    }
  }
  return map
}

export const formatDate = (d: Date) =>
  new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }).format(d)
