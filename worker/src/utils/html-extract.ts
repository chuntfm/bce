/**
 * HTMLRewriter-based extraction helpers for parsing Bandcamp pages.
 *
 * HTMLRewriter is a streaming parser -- you attach handlers to CSS selectors
 * and accumulate results via closures. There is no DOM tree.
 */

/** Decode common HTML entities in attribute values and text. */
export function decodeEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

// ---------------------------------------------------------------------------
// Meta tag extraction
// ---------------------------------------------------------------------------

/**
 * Extract <meta> tag content by name or property attribute.
 * Returns a map of requested names/properties to their content values.
 */
export async function extractMetaTags(
  response: Response,
  selectors: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}

  let rewriter = new HTMLRewriter()
  for (const selector of selectors) {
    rewriter = rewriter.on(selector, {
      element(el) {
        const content = el.getAttribute('content')
        if (content) {
          result[selector] = content
        }
      },
    })
  }

  await rewriter.transform(response).arrayBuffer()
  return result
}

// ---------------------------------------------------------------------------
// Release page extraction (meta tags + album link from <h3>)
// ---------------------------------------------------------------------------

export interface ReleasePageData {
  bcPageProperties: string | null
  ogTitle: string | null
  albumHref: string | null
}

/**
 * Extract bc-page-properties, og:title, and the album link (from <h3><a>)
 * from a single release page response.
 */
export async function extractReleasePage(
  response: Response
): Promise<ReleasePageData> {
  let bcPageProperties: string | null = null
  let ogTitle: string | null = null
  let albumHref: string | null = null
  let foundAlbumLink = false

  const rewriter = new HTMLRewriter()
    .on('meta[name="bc-page-properties"]', {
      element(el) {
        bcPageProperties = el.getAttribute('content')
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        ogTitle = el.getAttribute('content')
      },
    })
    .on('h3 a', {
      element(el) {
        if (!foundAlbumLink) {
          albumHref = el.getAttribute('href')
          foundAlbumLink = true
        }
      },
    })

  await rewriter.transform(response).arrayBuffer()
  return { bcPageProperties, ogTitle, albumHref }
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

/**
 * Extract all <a class="tag"> text content from a release page.
 */
export async function extractTags(response: Response): Promise<string[]> {
  const tags: string[] = []
  let currentTag: string | null = null

  const rewriter = new HTMLRewriter().on('a.tag', {
    element() {
      currentTag = ''
    },
    text(chunk) {
      if (currentTag !== null) {
        currentTag += chunk.text
        if (chunk.lastInTextNode) {
          tags.push(currentTag.trim())
          currentTag = null
        }
      }
    },
  })

  await rewriter.transform(response).arrayBuffer()

  // Handle case where lastInTextNode wasn't triggered for the final tag
  if (currentTag !== null && (currentTag as string).trim()) {
    tags.push((currentTag as string).trim())
  }

  return tags.filter((t) => t.length > 0)
}

// ---------------------------------------------------------------------------
// Search results extraction
// ---------------------------------------------------------------------------

export interface SearchResult {
  url: string
  title: string
  subhead: string
  type: string
}

/**
 * Parse Bandcamp search results page.
 *
 * Actual HTML structure (attributes are HTML-encoded):
 *   <li class="searchresult data-search" data-search='{"type":"a","id":...}'>
 *     <a class="artcont" href="...?from=search">...</a>
 *     <div class="result-info">
 *       <div class="heading">
 *         <a href="...">Title Text</a>
 *       </div>
 *       <div class="subhead">by Artist</div>
 *     </div>
 *   </li>
 *
 * Key challenges:
 * - data-search attribute is HTML-entity-encoded
 * - Title text is inside .heading > a, spread across text chunks
 * - lastInTextNode is unreliable; use element end events instead
 */
export async function extractSearchResults(
  response: Response
): Promise<SearchResult[]> {
  const results: SearchResult[] = []

  let inResult = false
  let currentResult: Partial<SearchResult> = {}
  let collectingHeading = false
  let collectingSubhead = false
  let headingText = ''
  let subheadText = ''

  const rewriter = new HTMLRewriter()
    .on('li.searchresult', {
      element(el) {
        // Finalize any previous result
        if (inResult && currentResult.type && currentResult.url && currentResult.title) {
          results.push(currentResult as SearchResult)
        }

        const raw = el.getAttribute('data-search')
        if (raw) {
          inResult = true
          currentResult = {}
          headingText = ''
          subheadText = ''
          collectingHeading = false
          collectingSubhead = false
          try {
            const decoded = decodeEntities(raw)
            const parsed = JSON.parse(decoded)
            currentResult = { type: parsed.type }
          } catch {
            inResult = false
          }
        }
      },
    })
    // Grab the URL from the first <a> inside the search result
    .on('.artcont', {
      element(el) {
        if (inResult && !currentResult.url) {
          const href = el.getAttribute('href')
          if (href) {
            currentResult.url = href.split('?')[0]
          }
        }
      },
    })
    // Collect title text from .heading (including nested <a> text)
    .on('.heading', {
      element() {
        if (inResult) {
          collectingHeading = true
          headingText = ''
        }
      },
    })
    .on('.heading *', {
      text(chunk) {
        if (collectingHeading) {
          headingText += chunk.text
        }
      },
    })
    .on('.subhead', {
      element() {
        // When we hit subhead, heading is done
        if (collectingHeading) {
          currentResult.title = decodeEntities(headingText.trim().replace(/\s+/g, ' '))
          collectingHeading = false
        }
        if (inResult) {
          collectingSubhead = true
          subheadText = ''
        }
      },
      text(chunk) {
        if (collectingSubhead) {
          subheadText += chunk.text
        }
      },
    })
    // Use itemurl div (which follows subhead) as a signal to finalize subhead
    .on('.itemurl', {
      element() {
        if (collectingSubhead) {
          currentResult.subhead = decodeEntities(subheadText.trim().replace(/\s+/g, ' '))
          collectingSubhead = false
        }
      },
    })

  await rewriter.transform(response).arrayBuffer()

  // Finalize last result
  if (inResult) {
    if (collectingHeading) {
      currentResult.title = decodeEntities(headingText.trim().replace(/\s+/g, ' '))
    }
    if (collectingSubhead) {
      currentResult.subhead = decodeEntities(subheadText.trim().replace(/\s+/g, ' '))
    }
    if (currentResult.type && currentResult.url && currentResult.title) {
      results.push(currentResult as SearchResult)
    }
  }

  return results.filter((r) => r.type === 'a' || r.type === 't')
}
