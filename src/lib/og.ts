import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'

const FONT = await readFile('./assets/fonts/NotoSansJP-Bold.otf')
const CACHE_DIR = '.cache/og'

/** satori は JSX を取るが、ここでは素のオブジェクトで組む(JSX 設定を持ち込まないため) */
type Node = { type: string; props: Record<string, unknown> }
const h = (type: string, props: Record<string, unknown>, ...children: unknown[]): Node => ({
  type,
  props: { ...props, children: children.length === 1 ? children[0] : children },
})

export interface OgInput {
  title: string
  meta: string
  /** キャッシュ判定に使う。内容が変わったときだけ再生成する */
  cacheKey: string
}

const template = (input: OgInput) =>
  h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        backgroundColor: '#0a0a0a',
        color: '#fafafa',
        fontFamily: 'NotoSansJP',
      },
    },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column' } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            fontSize: 60,
            lineHeight: 1.3,
            letterSpacing: '-0.02em',
            maxWidth: 1040,
          },
        },
        input.title,
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 28,
          color: '#a3a3a3',
        },
      },
      h('div', { style: { display: 'flex' } }, '4rnay.net'),
      h('div', { style: { display: 'flex' } }, input.meta),
    ),
  )

export async function renderOg(input: OgInput): Promise<Buffer> {
  const hash = createHash('sha256').update(input.cacheKey).digest('hex').slice(0, 16)
  const cacheFile = `${CACHE_DIR}/${hash}.png`

  // 記事メタが変わっていなければ再生成しない(actions/cache と組み合わせて効く)
  if (existsSync(cacheFile)) return readFile(cacheFile)

  const svg = await satori(template(input) as never, {
    width: 1200,
    height: 630,
    fonts: [{ name: 'NotoSansJP', data: FONT, weight: 700, style: 'normal' }],
  })
  const png = new Resvg(svg).render().asPng()

  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cacheFile, png)
  return png
}
