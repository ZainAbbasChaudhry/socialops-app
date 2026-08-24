const fs = require("node:fs")
const path = require("node:path")

/**
 * Structured product/price lookup - takes precedence over generic RAG for
 * price/product questions, per the "do not hardcode prices in the system
 * prompt" requirement. Reads data/meriteshop-products.json fresh on every
 * call (cheap - 51 products) so a mid-demo re-sync is picked up on the
 * very next question without restarting the bridge.
 */

const CATALOG_PATH = path.join(__dirname, "..", "..", "data", "meriteshop-products.json")

const CORE_TYPE_PATTERNS = [
  { label: "Single Core", re: /\bsingle\s*core\b/i },
  { label: "Twin Core", re: /\btwin\s*core\b/i },
  { label: "2 Core", re: /\b(2|two|double)\s*core\b/i },
  { label: "3 Core", re: /\b(3|three)\s*core\b/i },
  { label: "4 Core", re: /\b(4|four)\s*core\b/i },
  { label: "Flexible", re: /\bflexible\b/i },
  { label: "Solar", re: /\bsolar\b|\bpv\b|\bxlpo\b/i },
  { label: "Aluminium", re: /\balumin(i)?um\b/i },
  { label: "Coaxial", re: /\bcoax(ial)?\b|\brg-?\d/i },
  { label: "Data/Telecom", re: /\butp\b|\bcat\s?6\b|\btelecom\b|\btwisted pair\b/i },
  { label: "Earthing", re: /\bearth(ing)?\b/i },
]

/** Matches "2.5mm", "2.5 mm", "2.5sqmm", "2.5 sq mm", "2.5mm2", "2.5mm²",
 * or a bare "2.5" immediately followed by a core/cable word - covers the
 * size-notation variants customers actually type. */
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*mm|mm\s*2|mm²|mm)\b/gi

let cache = null
let cacheMtimeMs = 0

function loadCatalog() {
  let stat
  try {
    stat = fs.statSync(CATALOG_PATH)
  } catch {
    return { products: [], syncedAt: null }
  }
  // Re-read only when the file actually changed (cheap stat, avoids
  // re-parsing 51 products on every single message).
  if (cache && stat.mtimeMs === cacheMtimeMs) return cache
  try {
    const data = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"))
    cache = { products: data.products || [], syncedAt: data.syncedAt || null }
    cacheMtimeMs = stat.mtimeMs
  } catch {
    return cache || { products: [], syncedAt: null }
  }
  return cache
}

function extractSizes(query) {
  const sizes = new Set()
  let m
  SIZE_RE.lastIndex = 0
  while ((m = SIZE_RE.exec(query))) sizes.add(m[1])
  return [...sizes]
}

function extractCoreTypes(query) {
  return CORE_TYPE_PATTERNS.filter((p) => p.re.test(query)).map((p) => p.label)
}

/** Product name contains this size as a real token (not a substring of a
 * bigger or decimal number) - "2.5" must not match inside "12.5", and "1"
 * must not match inside "1.5" (a bare digit followed by ".<digit>" is part
 * of a larger decimal, not a standalone size). */
function nameHasSize(name, size) {
  const re = new RegExp(`(?<![\\d.])${size.replace(".", "\\.")}(?!\\.?\\d)`, "i")
  return re.test(name)
}

/** Deliberately checks the product NAME only, not `category` - MeriteShop's
 * own Shopify product_type field is inconsistently applied (e.g. at least
 * one genuinely "Standard/Std" - non-flexible - product is filed under
 * product_type "Flexible Panel Wiring Cables"), so it's not reliable for
 * this specific Standard-vs-Flexible/core-count disambiguation. The title
 * itself is the consistent, human-authored source of truth for that. */
function nameMatchesCoreType(product, label) {
  return CORE_TYPE_PATTERNS.find((p) => p.label === label)?.re.test(product.name) ?? false
}

/**
 * Returns { matches: Product[], sizesFound, coreTypesFound } - the caller
 * decides what to do with the match count: 0 -> fall back to general RAG,
 * 1 -> answer directly from the catalog, >1 -> ask a clarifying question
 * naming the distinguishing types, never guess.
 */
function searchProducts(query) {
  const { products } = loadCatalog()
  const sizes = extractSizes(query)
  const coreTypes = extractCoreTypes(query)

  if (sizes.length === 0 && coreTypes.length === 0) {
    return { matches: [], sizesFound: sizes, coreTypesFound: coreTypes }
  }

  let candidates = products
  if (sizes.length > 0) {
    candidates = candidates.filter((p) => sizes.some((s) => nameHasSize(p.name, s)))
  }
  if (coreTypes.length > 0) {
    candidates = candidates.filter((p) => coreTypes.some((label) => nameMatchesCoreType(p, label)))
  }

  return { matches: candidates, sizesFound: sizes, coreTypesFound: coreTypes }
}

function isAvailabilityOrPriceQuery(query) {
  return /\bprice\b|\bkitn[ae]\b|\brate\b|\bavailable\b|\bstock\b|\bcost\b|\bkya\s+hai\b/i.test(query) || extractSizes(query).length > 0
}

function formatVariantsForContext(product) {
  return product.variants
    .map((v) => {
      const parts = [v.size, v.color].filter(Boolean).join(" / ")
      const price = `PKR ${v.price.toLocaleString("en-PK")}`
      const compareAt = v.compareAtPrice ? ` (compare-at PKR ${v.compareAtPrice.toLocaleString("en-PK")})` : ""
      const avail = v.available ? "in stock" : "currently unavailable"
      return `  - ${parts || "Standard"}: ${price}${compareAt} - ${avail}`
    })
    .join("\n")
}

/** Renders one or more matched products into a compact, LLM-ready block -
 * every number in it comes straight from the synced catalog JSON, never
 * from the model. */
function formatMatchesForContext(matches) {
  return matches
    .map((p) => `Product: ${p.name}\nCategory: ${p.category || "Uncategorized"}\nURL: ${p.url}\nVariants (current catalog prices):\n${formatVariantsForContext(p)}`)
    .join("\n\n")
}

module.exports = { loadCatalog, searchProducts, isAvailabilityOrPriceQuery, formatMatchesForContext }
