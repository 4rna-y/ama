import type { APIRoute } from 'astro'
import { getPosts, formatDate } from '../../lib/posts'
import { renderOg } from '../../lib/og'

export async function getStaticPaths() {
  const posts = await getPosts()
  return [
    {
      params: { slug: 'default' },
      props: { title: '4rnay.net', meta: 'blog', cacheKey: 'default:v1' },
    },
    ...posts.map((post) => ({
      params: { slug: post.data.slug },
      props: {
        title: post.data.title,
        meta: formatDate(post.data.updated ?? post.data.date),
        cacheKey: [
          'v1',
          post.data.slug,
          post.data.title,
          (post.data.updated ?? post.data.date).toISOString(),
        ].join('|'),
      },
    })),
  ]
}

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOg(props as { title: string; meta: string; cacheKey: string })
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  })
}
