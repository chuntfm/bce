import { Hono } from 'hono'
import { cors } from 'hono/cors'
import release from './routes/release'
import collections from './routes/collections'
import tags from './routes/tags'

const app = new Hono()

// Allowed origins: chunt.org, chuntfm.github.io, localhost
function isAllowedOrigin(origin: string): boolean {
  return (
    origin === 'https://chunt.org' ||
    origin.endsWith('.chunt.org') ||
    origin === 'https://chuntfm.github.io' ||
    origin.startsWith('https://chuntfm.github.io/') ||
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1')
  )
}

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return 'https://chunt.org'
      if (isAllowedOrigin(origin)) return origin
      return 'https://chunt.org'
    },
  })
)

// Soft origin restriction: reject requests from other websites
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin') || ''
  const referer = c.req.header('Referer') || ''
  const source = origin || referer

  // Allow: no origin (curl/direct), or allowed origins
  if (source === '') {
    await next()
    return
  }

  if (!isAllowedOrigin(source)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await next()
})

// Mount routes
app.route('/', release)
app.route('/', collections)
app.route('/', tags)

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'bc-explorer' }))

export default app
