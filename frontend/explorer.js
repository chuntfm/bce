// Bandcamp Explorer - Frontend orchestration
// All selection/filtering logic runs client-side.
// The Worker endpoints are thin proxies to Bandcamp.

const API_BASE = '__API_BASE__' // Replaced at build time by GitHub Actions

const WILDNESS_MAP = [18, 12, 9, 6, 4, 3, 2, 1]
const FRESHNESS_MAP = [1024, 512, 256, 128, 64, 32, 16, 8]

const DEFAULTS = {
  buyers: 'random',
  picks: 'random',
  wildness: '5',
  freshness: '5',
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const urlInput = document.getElementById('url-input')
const submitBtn = document.getElementById('submit-btn')
const statusEl = document.getElementById('status')
const resultsHeaderEl = document.getElementById('results-header')
const tagFilterContainer = document.getElementById('tag-filter-container')
const resultsEl = document.getElementById('results')
const wildnessSlider = document.getElementById('wildness')
const freshnessSlider = document.getElementById('freshness')
const wildnessVal = document.getElementById('wildness-val')
const freshnessVal = document.getElementById('freshness-val')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentTralbums = []
let currentTags = null
let showInfo = true
let tagFilterVisible = false

// ---------------------------------------------------------------------------
// URL params: read on load, update after explore
// ---------------------------------------------------------------------------

function readUrlParams() {
  const params = new URLSearchParams(window.location.search)

  if (params.get('url')) {
    urlInput.value = params.get('url')
  }

  const buyers = params.get('buyers')
  if (buyers && ['random', 'recent'].includes(buyers)) {
    setRadio('buyers', buyers)
  }

  const picks = params.get('picks')
  if (picks && ['random', 'recent', 'top'].includes(picks)) {
    setRadio('picks', picks)
  }

  const wildness = params.get('wildness')
  if (wildness && parseInt(wildness) >= 1 && parseInt(wildness) <= 8) {
    wildnessSlider.value = wildness
    wildnessVal.textContent = wildness
  }

  const freshness = params.get('freshness')
  if (freshness && parseInt(freshness) >= 1 && parseInt(freshness) <= 8) {
    freshnessSlider.value = freshness
    freshnessVal.textContent = freshness
  }

  // Auto-explore if URL param is present
  if (params.get('url')) {
    explore()
  }
}

function updateUrlParams() {
  const params = new URLSearchParams()
  params.set('url', urlInput.value.trim())
  params.set('buyers', getRadioValue('buyers'))
  params.set('picks', getRadioValue('picks'))
  params.set('wildness', wildnessSlider.value)
  params.set('freshness', freshnessSlider.value)

  const newUrl = `${window.location.pathname}?${params.toString()}`
  history.replaceState(null, '', newUrl)
}

// ---------------------------------------------------------------------------
// Tooltips (click/tap toggle, works on mobile)
// ---------------------------------------------------------------------------

function initTooltips() {
  document.querySelectorAll('.tip-toggle').forEach((btn) => {
    const bubble = document.createElement('div')
    bubble.className = 'tip-bubble'
    bubble.textContent = btn.getAttribute('data-tip')
    btn.parentElement.appendChild(bubble)

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      document.querySelectorAll('.tip-bubble.visible').forEach((b) => {
        if (b !== bubble) b.classList.remove('visible')
      })
      bubble.classList.toggle('visible')
    })
  })

  document.addEventListener('click', () => {
    document.querySelectorAll('.tip-bubble.visible').forEach((b) => {
      b.classList.remove('visible')
    })
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffleAndTake(arr, n) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, Math.min(n, copy.length))
}

function countBy(arr, key) {
  const counts = {}
  for (const item of arr) {
    const val = item[key]
    counts[val] = (counts[val] || 0) + 1
  }
  return counts
}

function setStatus(msg) {
  statusEl.textContent = msg
}

function clearResults() {
  resultsEl.innerHTML = ''
  resultsHeaderEl.innerHTML = ''
  tagFilterContainer.innerHTML = ''
  currentTralbums = []
  currentTags = null
  tagFilterVisible = false
}

function getRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value
}

function setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`)
  if (el) el.checked = true
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function apiGet(path) {
  const resp = await fetch(`${API_BASE}${path}`)
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }))
    throw new Error(err.error || `Request failed: ${resp.status}`)
  }
  return resp.json()
}

async function apiPost(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }))
    throw new Error(err.error || `Request failed: ${resp.status}`)
  }
  return resp.json()
}

// ---------------------------------------------------------------------------
// Main exploration flow
// ---------------------------------------------------------------------------

async function explore(url) {
  if (!url) url = urlInput.value.trim()
  if (!url) return

  urlInput.value = url
  submitBtn.disabled = true
  clearResults()

  try {
    setStatus('Fetching release info...')
    let release = await apiGet(`/api/release?url=${encodeURIComponent(url)}`)

    if (release.fans.length === 0 && release.tralbum_type === 't' && release.album_url) {
      setStatus('No purchasers found, trying album...')
      release = await apiGet(`/api/release?url=${encodeURIComponent(release.album_url)}`)
    }

    if (release.fans.length === 0) {
      setStatus("Nobody's bought this release yet. Try another one.")
      return
    }

    const wildness = parseInt(wildnessSlider.value)
    const variability = WILDNESS_MAP[wildness - 1]
    const numFans = Math.min(Math.floor(36 / variability), release.fans.length)
    const buyerSelection = getRadioValue('buyers')

    let selectedFans
    if (buyerSelection === 'recent') {
      selectedFans = release.fans.slice(0, numFans)
    } else {
      selectedFans = shuffleAndTake(release.fans, numFans)
    }

    setStatus(`Fetching collections from ${selectedFans.length} fans...`)
    const freshness = FRESHNESS_MAP[parseInt(freshnessSlider.value) - 1]
    const collections = await apiPost('/api/collections', {
      fan_ids: selectedFans.map((f) => f.fan_id),
      freshness,
      query_tralbum_id: release.tralbum_id,
    })

    const pickMode = getRadioValue('picks')
    const tralbums_per_fan = Math.floor(36 / selectedFans.length)
    let selectedTralbums

    if (pickMode === 'top') {
      const allItems = collections.flatMap((c) => c.items)
      const freq = countBy(allItems, 'tralbum_id')
      const top36 = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 36)
        .map((e) => parseInt(e[0]))
      const seen = new Set()
      selectedTralbums = allItems.filter((item) => {
        if (top36.includes(item.tralbum_id) && !seen.has(item.tralbum_id)) {
          seen.add(item.tralbum_id)
          return true
        }
        return false
      })
    } else if (pickMode === 'recent') {
      selectedTralbums = collections.flatMap((c) =>
        c.items.slice(0, tralbums_per_fan)
      )
    } else {
      selectedTralbums = collections.flatMap((c) =>
        shuffleAndTake(c.items, tralbums_per_fan)
      )
    }

    if (selectedTralbums.length === 0) {
      setStatus('No results found. Try different settings.')
      return
    }

    currentTralbums = selectedTralbums

    // Update URL with current settings
    updateUrlParams()

    const queryUrl = release.album_url || url
    let subtitleHtml
    if (pickMode === 'top') {
      subtitleHtml =
        `Purchases commonly found in ${buyerSelection} buyers of ` +
        `<a href="${escapeHtml(queryUrl)}" target="_blank">${escapeHtml(release.title)}</a>`
    } else {
      const pickLabel = pickMode.charAt(0).toUpperCase() + pickMode.slice(1)
      subtitleHtml =
        `${pickLabel} picks from ${buyerSelection} buyers of ` +
        `<a href="${escapeHtml(queryUrl)}" target="_blank">${escapeHtml(release.title)}</a>`
    }

    renderResultsHeader(subtitleHtml)
    renderResults(selectedTralbums)

    setStatus(`${selectedTralbums.length} releases`)
  } catch (err) {
    setStatus(`Error: ${err.message}`)
  } finally {
    submitBtn.disabled = false
  }
}

// ---------------------------------------------------------------------------
// Results header: subtitle on the left, action buttons on the right
// ---------------------------------------------------------------------------

function renderResultsHeader(subtitleHtml) {
  resultsHeaderEl.innerHTML = ''

  const subtitle = document.createElement('span')
  subtitle.className = 'results-subtitle'
  subtitle.innerHTML = subtitleHtml
  resultsHeaderEl.appendChild(subtitle)

  const actions = document.createElement('div')
  actions.className = 'results-actions'

  const toggleBtn = document.createElement('button')
  toggleBtn.textContent = showInfo ? 'Hide info' : 'Show info'
  toggleBtn.addEventListener('click', () => {
    showInfo = !showInfo
    toggleBtn.textContent = showInfo ? 'Hide info' : 'Show info'
    // Re-render to update link visibility

    document.querySelectorAll('.result-info').forEach((el) => {
      el.classList.toggle('hidden', !showInfo)
    })
  })
  actions.appendChild(toggleBtn)

  const tagsBtn = document.createElement('button')
  tagsBtn.textContent = 'Filter by tags'
  tagsBtn.addEventListener('click', () => toggleTags())
  actions.appendChild(tagsBtn)

  const csvBtn = document.createElement('button')
  csvBtn.textContent = 'Download CSV'
  csvBtn.addEventListener('click', downloadCsv)
  actions.appendChild(csvBtn)

  resultsHeaderEl.appendChild(actions)
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderResults(tralbums) {
  resultsEl.innerHTML = ''
  for (const t of tralbums) {
    const type = t.item_type === 'package' ? 'album' : t.item_type
    const card = document.createElement('div')
    card.className = 'result-card'

    const iframe = document.createElement('iframe')
    iframe.src = `https://bandcamp.com/EmbeddedPlayer/${type}=${t.tralbum_id}/size=large/bgcol=333333/linkcol=0f91ff/minimal=true/transparent=true/`
    iframe.title = `${t.item_title} by ${t.band_name}`
    iframe.loading = 'lazy'
    card.appendChild(iframe)

    const info = document.createElement('div')
    info.className = 'result-info' + (showInfo ? '' : ' hidden')
    const link = document.createElement('a')
    link.href = t.item_url
    link.target = '_blank'
    link.className = 'result-link'
    link.innerHTML =
      `<span class="result-title">${escapeHtml(t.item_title)}</span><br>` +
      `${escapeHtml(t.band_name)}`
    info.appendChild(link)
    card.appendChild(info)

    const exploreBtn = document.createElement('button')
    exploreBtn.className = 'explore-btn'
    exploreBtn.textContent = 'Explore this'
    exploreBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      explore(t.item_url)
    })
    card.appendChild(exploreBtn)

    resultsEl.appendChild(card)
  }
}

// ---------------------------------------------------------------------------
// CSV download
// ---------------------------------------------------------------------------

function downloadCsv() {
  if (currentTralbums.length === 0) return

  const headers = ['title', 'artist', 'type', 'url']
  const rows = currentTralbums.map((t) => [
    `"${(t.item_title || '').replace(/"/g, '""')}"`,
    `"${(t.band_name || '').replace(/"/g, '""')}"`,
    t.item_type,
    t.item_url,
  ])

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'bc-explorer-results.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Tag filter (toggle visibility, lazy load on first open)
// ---------------------------------------------------------------------------

async function toggleTags() {
  if (currentTralbums.length === 0) return

  // If visible, hide it
  if (tagFilterVisible) {
    tagFilterContainer.innerHTML = ''
    tagFilterVisible = false
    return
  }

  // If tags not yet loaded, fetch them
  if (currentTags === null) {
    tagFilterContainer.innerHTML = ''
    const loading = document.createElement('span')
    loading.textContent = 'Loading tags...'
    loading.style.fontSize = '0.75rem'
    loading.style.color = 'var(--fg-secondary)'
    tagFilterContainer.appendChild(loading)

    try {
      const urls = currentTralbums.map((t) => t.item_url)
      currentTags = await apiPost('/api/tags', { urls })

      for (const t of currentTralbums) {
        t.tags = currentTags[t.item_url] || []
      }
    } catch (err) {
      tagFilterContainer.textContent = `Failed to load tags: ${err.message}`
      return
    }
  }

  renderTagFilter()
  tagFilterVisible = true
}

function renderTagFilter() {
  const allTags = [
    ...new Set(currentTralbums.flatMap((t) => t.tags || [])),
  ].sort()

  tagFilterContainer.innerHTML = ''

  if (allTags.length === 0) {
    tagFilterContainer.innerHTML =
      '<span style="font-size:0.75rem;color:var(--fg-secondary)">No tags found</span>'
    tagFilterVisible = true
    return
  }

  const selectedTags = new Set()

  const filterEl = document.createElement('div')
  filterEl.className = 'tag-filter'

  const header = document.createElement('div')
  header.className = 'tag-filter-header'
  header.innerHTML = '<span>Tags</span>'

  const clearBtn = document.createElement('button')
  clearBtn.textContent = 'Clear'
  clearBtn.style.fontSize = '0.65rem'
  clearBtn.style.padding = '0.1rem 0.4rem'
  clearBtn.addEventListener('click', () => {
    selectedTags.clear()
    updateChips()
    renderResults(currentTralbums)
  })
  header.appendChild(clearBtn)
  filterEl.appendChild(header)

  const tagList = document.createElement('div')
  tagList.className = 'tag-list'

  for (const tag of allTags) {
    const chip = document.createElement('button')
    chip.className = 'tag-chip'
    chip.textContent = tag
    chip.dataset.tag = tag
    chip.addEventListener('click', () => {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag)
      } else {
        selectedTags.add(tag)
      }
      updateChips()
      applyTagFilter()
    })
    tagList.appendChild(chip)
  }

  filterEl.appendChild(tagList)
  tagFilterContainer.appendChild(filterEl)

  function updateChips() {
    for (const chip of tagList.querySelectorAll('.tag-chip')) {
      chip.classList.toggle('selected', selectedTags.has(chip.dataset.tag))
    }
  }

  function applyTagFilter() {
    if (selectedTags.size === 0) {
      renderResults(currentTralbums)
      return
    }
    const filtered = currentTralbums.filter((t) =>
      (t.tags || []).some((tag) => selectedTags.has(tag))
    )
    renderResults(filtered)
  }
}

// ---------------------------------------------------------------------------
// Slider value display
// ---------------------------------------------------------------------------

wildnessSlider.addEventListener('input', () => {
  wildnessVal.textContent = wildnessSlider.value
})

freshnessSlider.addEventListener('input', () => {
  freshnessVal.textContent = freshnessSlider.value
})

// ---------------------------------------------------------------------------
// Event listeners + init
// ---------------------------------------------------------------------------

submitBtn.addEventListener('click', () => explore())

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') explore()
})

initTooltips()
readUrlParams()
