import { Hono } from 'hono'

interface CollectionRequest {
  fan_ids: number[]
  freshness: number
  query_tralbum_id: number
}

interface TrablumItem {
  item_type: string
  tralbum_id: number
  item_url: string
  item_title: string
  band_name: string
}

const DESIRED_KEYS = [
  'item_type',
  'tralbum_id',
  'item_url',
  'item_title',
  'band_name',
  'num_streamable_tracks',
  'is_subscriber_only',
] as const

const MAX_FANS = 36

const collections = new Hono()

collections.post('/api/collections', async (c) => {
  const body = await c.req.json<CollectionRequest>()

  if (!body.fan_ids || !Array.isArray(body.fan_ids)) {
    return c.json({ error: 'fan_ids must be an array' }, 400)
  }

  if (body.fan_ids.length > MAX_FANS) {
    return c.json({ error: `fan_ids limited to ${MAX_FANS}` }, 400)
  }

  if (!body.freshness || !body.query_tralbum_id) {
    return c.json({ error: 'Missing freshness or query_tralbum_id' }, 400)
  }

  // Fetch collections for all fans in parallel
  const results = await Promise.all(
    body.fan_ids.map(async (fanId) => {
      const response = await fetch(
        'https://bandcamp.com/api/fancollection/1/collection_items',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fan_id: fanId,
            older_than_token: '2145916799::t',
            count: body.freshness,
          }),
        }
      )

      if (!response.ok) {
        return { fan_id: fanId, items: [] }
      }

      const data = (await response.json()) as {
        items: Array<Record<string, unknown>>
      }

      // Pick only the keys we need
      const items: TrablumItem[] = data.items
        .map((item) => {
          const picked: Record<string, unknown> = {}
          for (const key of DESIRED_KEYS) {
            picked[key] = item[key]
          }
          return picked
        })
        // Filter out: the query release, non-streamable, subscriber-only
        .filter(
          (item) =>
            item.tralbum_id !== body.query_tralbum_id &&
            (item.num_streamable_tracks as number) > 0 &&
            item.is_subscriber_only !== true
        )
        .map((item) => ({
          item_type: item.item_type as string,
          tralbum_id: item.tralbum_id as number,
          item_url: item.item_url as string,
          item_title: item.item_title as string,
          band_name: item.band_name as string,
        }))

      return { fan_id: fanId, items }
    })
  )

  return c.json(results)
})

export default collections
