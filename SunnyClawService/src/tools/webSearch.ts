import * as cheerio from 'cheerio'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

const SNIPPET_SELECTORS = [
  '.c-abstract',
  '.c-span-last',
  '[class*="abstract"]',
  '.content-right_8Zs40',
  '.c-color-text',
  'span'
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readSnippet($container: cheerio.Cheerio<any>): string {
  for (const sel of SNIPPET_SELECTORS) {
    const text = $container.find(sel).first().text().trim()
    if (text.length >= 15) return text
  }
  const fallback = $container.text().replace(/\s+/g, ' ').trim()
  return fallback.length > 30 ? fallback.slice(0, 300) : ''
}

function extractAladdinCard($: cheerio.CheerioAPI): string | null {
  const cardSelectors = [
    '#content_left .c-border',
    '.op_weather4_twoicon',
    '[class*="weather"]',
    '.c-container[data-click]',
    '#content_left .result-op'
  ]
  for (const sel of cardSelectors) {
    const text = $(sel).first().text().replace(/\s+/g, ' ').trim()
    if (text.length >= 20 && text.length <= 800) {
      return `【百度直达摘要】\n${text}`
    }
  }
  return null
}

export async function webSearch(query: string): Promise<string> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  })

  if (!response.ok) {
    return `搜索失败: HTTP ${response.status}`
  }

  const html = await response.text()
  const $ = cheerio.load(html)
  const results: SearchResult[] = []
  const parts: string[] = []

  const aladdin = extractAladdinCard($)
  if (aladdin) parts.push(aladdin)

  const seenTitles = new Set<string>()

  $('#content_left .c-container, #content_left .result, .result.c-container').each((_, el) => {
    if (results.length >= 5) return false

    const $container = $(el)
    const $link = $container.find('h3 a, a.c-title, .t a').first()
    const title = $link.text().trim()
    let href = $link.attr('href') || ''

    if (!title || seenTitles.has(title)) return
    seenTitles.add(title)

    if (href.startsWith('/')) {
      href = 'https://www.baidu.com' + href
    }

    const snippet = readSnippet($container) || '（无摘要）'
    results.push({ title, url: href, snippet })
  })

  if (results.length === 0) {
    $('h3 a').each((_, el) => {
      if (results.length >= 5) return false
      const $el = $(el)
      const title = $el.text().trim()
      if (!title || seenTitles.has(title)) return
      seenTitles.add(title)
      let href = $el.attr('href') || ''
      if (href.startsWith('/')) href = 'https://www.baidu.com' + href
      const $container = $el.closest('.c-container, .result, div')
      const snippet = readSnippet($container) || '（无摘要）'
      results.push({ title, url: href, snippet })
    })
  }

  if (results.length === 0) {
    return '未找到相关搜索结果。'
  }

  parts.push(
    results
      .map((r, i) => `结果 ${i + 1}：${r.title}\n摘要：${r.snippet}\n来源：${r.url}`)
      .join('\n\n')
  )

  return parts.join('\n\n')
}
