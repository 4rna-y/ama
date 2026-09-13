// @ts-check
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  site: 'https://4rnay.net',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [mdx(), sitemap({ filter: (page) => !page.includes('/og/') })],
  image: {
    // OGP と記事画像の生成幅。ファイル数上限に効くので絞る
    responsiveStyles: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
