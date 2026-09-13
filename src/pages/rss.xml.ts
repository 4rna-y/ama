import rss from '@astrojs/rss'
import type { APIRoute } from 'astro'
import { getPosts } from '../lib/posts'

export const GET: APIRoute = async (context) => {
  const posts = await getPosts()
  return rss({
    title: '4rnay.net',
    description: 'Cloudflare 上でほぼ0円で動かしている個人ブログ。',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/posts/${post.data.slug}`,
      categories: post.data.tags,
    })),
    customData: '<language>ja</language>',
  })
}
