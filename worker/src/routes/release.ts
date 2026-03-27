import { Hono } from 'hono'
import { extractReleasePage, decodeEntities } from '../utils/html-extract'

const release = new Hono()

release.get('/api/release', async (c) => {
  const url = c.req.query('url')
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  // Validate it looks like a bandcamp URL
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return c.json({ error: 'Invalid URL' }, 400)
  }

  if (!parsed.hostname.includes('bandcamp.com')) {
    return c.json({ error: 'URL must be a bandcamp.com domain' }, 400)
  }

  // Fetch the release page
  const pageResponse = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!pageResponse.ok) {
    return c.json(
      { error: `Failed to fetch release page: ${pageResponse.status}` },
      502
    )
  }

  // Extract meta tags and album link from the page
  const { bcPageProperties, ogTitle, albumHref } =
    await extractReleasePage(pageResponse)

  if (!bcPageProperties) {
    return c.json({ error: 'Not a valid Bandcamp release page' }, 400)
  }

  const decoded = decodeEntities(bcPageProperties)

  let bcInfo: { item_type: string; item_id: number }
  try {
    bcInfo = JSON.parse(decoded)
  } catch {
    return c.json({ error: 'Failed to parse release metadata' }, 500)
  }

  const origin = parsed.origin

  // Build album URL if this is a track page
  const albumUrl =
    bcInfo.item_type === 't' && albumHref
      ? `${origin}${albumHref}`
      : null

  // Fetch collectors (fans who bought this release)
  const collectorsUrl = `${origin}/api/tralbumcollectors/2/thumbs`
  const collectorsResponse = await fetch(collectorsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tralbum_type: bcInfo.item_type,
      tralbum_id: bcInfo.item_id,
      count: 500,
    }),
  })

  if (!collectorsResponse.ok) {
    return c.json(
      { error: `Bandcamp collectors API error: ${collectorsResponse.status}` },
      502
    )
  }

  const collectorsData = (await collectorsResponse.json()) as {
    results: Array<{ fan_id: number; mod_date: string }>
  }

  const fans = collectorsData.results.map((r) => ({
    fan_id: r.fan_id,
    mod_date: r.mod_date,
  }))

  return c.json({
    title: ogTitle,
    tralbum_type: bcInfo.item_type,
    tralbum_id: bcInfo.item_id,
    fans,
    album_url: albumUrl,
  })
})

export default release
