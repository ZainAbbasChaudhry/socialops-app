#!/usr/bin/env node
/**
 * Refreshes the local MeriteShop product catalog snapshot from the
 * public Shopify storefront feed (https://meriteshop.com/products.json).
 * Public storefront data only - never touches customers, orders,
 * inventory counts, or any admin/private Shopify API.
 *
 * Safe by design: writes to a temp file first and only replaces the real
 * snapshot on a fully successful fetch+parse - a failed sync (network
 * down, site change, etc.) always leaves the last good snapshot in
 * place and reports the error honestly, never silently wiping data
 * before a demo.
 */
const fs = require("node:fs")
const path = require("node:path")

const STORE_BASE = "https://meriteshop.com"
const OUTPUT_PATH = path.join(__dirname, "..", "data", "meriteshop-products.json")
const TEMP_PATH = `${OUTPUT_PATH}.tmp`

function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
}

/** Best-effort category from Shopify's own product_type field first (it's
 * genuinely set on some products); when empty, a category derived only
 * from the product's own title text - never an invented taxonomy. */
function deriveCategory(product) {
  if (product.product_type && product.product_type.trim()) return product.product_type.trim()
  const title = product.title.toLowerCase()
  if (/solar|xlpo|pv\b/.test(title)) return "Solar / PV Cable"
  if (/coax/.test(title)) return "Coaxial Cable"
  if (/utp|cat\s?6|telecom|twisted pair/.test(title)) return "Data / Telecom Cable"
  if (/aluminium|aluminum/.test(title)) return "Aluminium Cable"
  if (/earthing/.test(title)) return "Earthing Cable"
  if (/4 core/.test(title)) return "4 Core Cable"
  if (/3 core/.test(title)) return "3 Core Cable"
  if (/twin core/.test(title)) return "Twin Core Flexible Cable"
  if (/2 core/.test(title)) return "2 Core Cable"
  if (/single core/.test(title)) return "Single Core Cable"
  return null
}

/** Maps Shopify's option1/option2/option3 (positional) to their actual
 * option names (e.g. "Size" or "Qty" for length, "Color") using the
 * product's own `options` array - never assumes a fixed order. */
function buildVariant(product, variant) {
  const optionValues = {}
  ;(product.options || []).forEach((opt, i) => {
    const raw = variant[`option${i + 1}`]
    if (raw == null) return
    const name = (opt.name || "").toLowerCase()
    if (/size|qty|length|meter/.test(name)) optionValues.size = raw
    else if (/colou?r/.test(name)) optionValues.color = raw
    else optionValues[opt.name || `option${i + 1}`] = raw
  })

  return {
    size: optionValues.size ?? null,
    color: optionValues.color ?? null,
    variantTitle: variant.title,
    price: Number(variant.price),
    compareAtPrice: variant.compare_at_price ? Number(variant.compare_at_price) : null,
    currency: "PKR",
    available: Boolean(variant.available),
    sku: variant.sku || null,
  }
}

function normalizeProduct(product) {
  return {
    id: product.id,
    name: product.title,
    handle: product.handle,
    category: deriveCategory(product),
    tags: product.tags || [],
    descriptionText: stripHtml(product.body_html).slice(0, 1200),
    variants: (product.variants || []).map((v) => buildVariant(product, v)),
    url: `${STORE_BASE}/products/${product.handle}`,
    imageUrl: product.images && product.images[0] ? product.images[0].src : null,
    updatedAt: product.updated_at || null,
  }
}

async function fetchAllProducts() {
  const all = []
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(`${STORE_BASE}/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EasyLifeDemoSync/1.0)" },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`products.json request failed: HTTP ${res.status} (page ${page})`)
    const body = await res.json()
    const products = body?.products || []
    if (products.length === 0) break
    all.push(...products)
    if (products.length < 250) break
  }
  return all
}

async function main() {
  console.log(`[sync:meriteshop] Fetching public catalog from ${STORE_BASE}/products.json ...`)

  let rawProducts
  try {
    rawProducts = await fetchAllProducts()
  } catch (error) {
    console.error(`[sync:meriteshop] FAILED - could not fetch the live catalog: ${error instanceof Error ? error.message : error}`)
    console.error(`[sync:meriteshop] The last good snapshot at ${OUTPUT_PATH} was left untouched.`)
    process.exitCode = 1
    return
  }

  if (rawProducts.length === 0) {
    console.error("[sync:meriteshop] FAILED - the catalog feed returned zero products (unexpected). Leaving the last good snapshot untouched.")
    process.exitCode = 1
    return
  }

  const products = rawProducts.map(normalizeProduct)
  const snapshot = {
    source: `${STORE_BASE}/products.json`,
    syncedAt: new Date().toISOString(),
    count: products.length,
    products,
  }

  try {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
    fs.writeFileSync(TEMP_PATH, JSON.stringify(snapshot, null, 2))
    fs.renameSync(TEMP_PATH, OUTPUT_PATH) // atomic swap - never leaves a half-written snapshot
  } catch (error) {
    console.error(`[sync:meriteshop] FAILED to write snapshot: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
    return
  }

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))]
  console.log(`[sync:meriteshop] OK - synced ${products.length} products.`)
  console.log(`[sync:meriteshop] Categories seen: ${categories.join(", ")}`)
  console.log(`[sync:meriteshop] Snapshot written to ${OUTPUT_PATH}`)
  console.log(`[sync:meriteshop] Synced at: ${snapshot.syncedAt}`)
}

main()
