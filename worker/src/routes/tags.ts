import { Hono } from 'hono'
import { extractTags } from '../utils/html-extract'

const MAX_URLS = 36

const tags = new Hono()

tags.post('/api/tags', async (c) => {
  const body = await c.req.json<{ urls: string[] }>()

  if (!body.urls || !Array.isArray(body.urls)) {
    return c.json({ error: 'urls must be an array' }, 400)
  }

  if (body.urls.length > MAX_URLS) {
    return c.json({ error: `urls limited to ${MAX_URLS}` }, 400)
  }

  // Fetch all pages in parallel and extract tags
  const entries = await Promise.all(
    body.urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
        if (!response.ok) {
          return [url, [] as string[]] as const
        }
        const pageTags = await extractTags(response)
        return [url, pageTags] as const
      } catch {
        return [url, [] as string[]] as const
      }
    })
  )

  const result: Record<string, string[]> = {}
  for (const [url, pageTags] of entries) {
    result[url] = pageTags
  }

  return c.json(result)
})

export default tags
