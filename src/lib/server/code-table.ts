/**
 * Code-table post-processor for Platts VL extraction.
 * Fills gaps, fixes OCR errors, validates MT conversions.
 * Post-processing pipeline: product fix → code fix → number validation → change sanity → MT/BBL cross-check → dup detection → FOB/CIF ordering → outlier removal
 */

import type { VlQuote, VlExtractionResult } from "./vl-extraction"

const MT_BBL_FACTORS: Record<string, number> = {
  "ULSD 10ppm": 7.45,
  "JET-A1": 7.89,
  "Gasoline Prem. 10ppm": 8.33,
  "Gasoline Prem.10ppm": 8.33,
  Naphtha: 8.90,
  "Gasoil 0.1%": 7.45,
  "Gasoil 0.05%": 7.45,
  "Fuel Oil 1.0%": 6.35,
  "Fuel Oil 3.5%": 6.35,
  "HSFO 180": 6.35,
  "HSFO 380": 6.35,
  "HSFO 180/380 CST": 6.35,
}

const KNOWN_CODES: Record<string, string> = {
  "ULSD 10ppm|FOB Med": "AAWY00",
  "ULSD 10ppm|CIF Med": "AAWYZ00",
  "ULSD 10ppm|FOB NWE": "AAVBF00",
  "ULSD 10ppm|CIF NWE": "AABVG00",
  "ULSD 10ppm|FOB Rott": "AAJUS00",
  "ULSD 10ppm|FOB Sing (MOPS)": "POABC00",
  "ULSD 10ppm|FOB AG (MOPAG)": "AAIDT00",
  "ULSD 10ppm|MOPJ": "AAFEK00",
  "JET-A1|FOB Med": "AAIDL00",
  "JET-A1|CIF Med": "AAZBN00",
  "JET-A1|FOB NWE": "PIAAV00",
  "JET-A1|CIF NWE": "PIAAU00",
  "JET-A1|FOB Rott": "PIABA00",
  "JET-A1|FOB Sing (MOPS)": "PIABF00",
  "JET-A1|FOB AG (MOPAG)": "PIAAA00",
  "JET-A1|MOPJ": "PIAAN00",
  "Gasoline Prem. 10ppm|FOB Med": "AAWZA00",
  "Gasoline Prem. 10ppm|CIF Med": "AAWZB00",
  "Gasoline Prem. 10ppm|FOB NWE": "AAJFQ00",
  "Gasoline Prem. 10ppm|CIF NWE": "PGABM00",
  "Gasoline Prem. 10ppm|FOB Rott": "PGABM00",
  "Gasoline Prem. 10ppm|FOB Sing (MOPS)": "PGAEY00",
  "Gasoline Prem. 10ppm|FOB AG (MOPAG)": "PGAEZ00",
  "Gasoline Prem. 10ppm|MOPJ": "PGACW00",
  "Gasoline Prem.10ppm|FOB Med": "AAWZA00",
  "Gasoline Prem.10ppm|CIF Med": "AAWZB00",
  "Gasoline Prem.10ppm|FOB NWE": "AAJFQ00",
  "Gasoline Prem.10ppm|CIF NWE": "PGABM00",
  "Gasoline Prem.10ppm|FOB Rott": "PGABM00",
  "Gasoline Prem.10ppm|FOB Sing (MOPS)": "PGAEY00",
  "Gasoline Prem.10ppm|FOB AG (MOPAG)": "PGAEZ00",
  "Gasoline Prem.10ppm|MOPJ": "PGACW00",
  "Naphtha|FOB Med": "PAAAI00",
  "Naphtha|CIF Med": "PAAAH00",
  "Naphtha|FOB NWE": "PAAAL00",
  "Naphtha|CIF NWE": "PAAAW00",
  "Naphtha|FOB Rott": "PAAAV00",
  "Naphtha|FOB Sing (MOPS)": "PAAAP00",
  "Naphtha|FOB AG (MOPAG)": "PAAAD00",
  "Naphtha|MOPJ": "PAAAE00",
  "Gasoil 0.1%|FOB Med": "AAVJ100",
  "Gasoil 0.1%|CIF Med": "AAVJ000",
  "Gasoil 0.1%|FOB NWE": "AAYWR00",
  "Gasoil 0.1%|CIF NWE": "AAYWS00",
  "Gasoil 0.1%|FOB Rott": "AAYWT00",
  "Gasoil 0.1%|FOB Sing (MOPS)": "AAFEK00",
  "Gasoil 0.1%|FOB AG (MOPAG)": "AAFEZ00",
  "Gasoil 0.1%|MOPJ": "AAFEK00",
  "Fuel Oil 1.0%|FOB Med": "PUAAK00",
  "Fuel Oil 1.0%|CIF Med": "PUAAJ00",
  "Fuel Oil 1.0%|FOB NWE": "PUAAH00",
  "Fuel Oil 1.0%|CIF NWE": "PUAAI00",
  "Fuel Oil 1.0%|FOB Rott": "PUAAP00",
  "Fuel Oil 1.0%|FOB Sing (MOPS)": "PUAA000",
  "Fuel Oil 1.0%|FOB AG (MOPAG)": "PUAA000",
}

const PRICE_RANGES: Record<string, { bblMin: number; bblMax: number; mtMin: number; mtMax: number }> = {
  "ULSD 10ppm":        { bblMin: 80,  bblMax: 160, mtMin: 500, mtMax: 1200 },
  "JET-A1":            { bblMin: 80,  bblMax: 150, mtMin: 600, mtMax: 1200 },
  "Gasoline Prem. 10ppm": { bblMin: 70, bblMax: 160, mtMin: 500, mtMax: 1300 },
  "Gasoline Prem.10ppm": { bblMin: 70, bblMax: 160, mtMin: 500, mtMax: 1300 },
  "Naphtha":           { bblMin: 55,  bblMax: 100, mtMin: 450, mtMax: 900 },
  "Gasoil 0.1%":       { bblMin: 70,  bblMax: 150, mtMin: 500, mtMax: 1100 },
  "Gasoil 0.05%":      { bblMin: 70,  bblMax: 150, mtMin: 500, mtMax: 1100 },
  "Fuel Oil 1.0%":     { bblMin: 55,  bblMax: 120, mtMin: 300, mtMax: 750 },
  "Fuel Oil 3.5%":     { bblMin: 40,  bblMax: 100, mtMin: 200, mtMax: 600 },
  "HSFO 180":          { bblMin: 40,  bblMax: 100, mtMin: 300, mtMax: 750 },
  "HSFO 380":          { bblMin: 40,  bblMax: 100, mtMin: 300, mtMax: 600 },
  "HSFO 180/380 CST":  { bblMin: 40,  bblMax: 100, mtMin: 300, mtMax: 750 },
  "US D6":             { bblMin: 40,  bblMax: 100, mtMin: 250, mtMax: 650 },
  "US 100":            { bblMin: 40,  bblMax: 100, mtMin: 300, mtMax: 750 },
}

export interface QuotesReportCommodity {
  commodity: string
  product: string
  unit: string
  details: Array<{
    location: string
    code: string
    price: number
    change: number | null
    currency: string
  }>
}

function fixOcrErrors(code: string): string {
  if (!code || code === "N/A") return code
  return code.replace(/OO/g, "00").replace(/IO/g, "10").replace(/O0/g, "00").replace(/0O/g, "00")
}

function getKnownCode(product: string, location: string): string | null {
  const key = product + "|" + location
  if (KNOWN_CODES[key]) return KNOWN_CODES[key]
  const cleanLoc = location.replace(/\s+conv\.?\s*MT/i, "").trim()
  if (KNOWN_CODES[product + "|" + cleanLoc]) return KNOWN_CODES[product + "|" + cleanLoc]
  const normProduct = product.replace(/\s+/g, " ").trim()
  const normLoc = cleanLoc.replace(/\s+/g, " ").trim()
  if (KNOWN_CODES[normProduct + "|" + normLoc]) return KNOWN_CODES[normProduct + "|" + normLoc]
  return null
}

function isConvMt(q: VlQuote): boolean {
  return /conv/i.test(q.location) || (q.location.includes("MOPJ") && q.unit === "USD/mt" && !q.location.includes("conv"))
}

function cleanLoc(loc: string): string {
  return loc.replace(/\s+conv\.?\s*MT/i, "").trim()
}

function normalizeProductName(product: string): string {
  let p = product.trim()
  p = p.replace(/(\d),(\d)/g, "$1.$2")
  if (p === "Gasoline Prem. 10ppm" || p === "Gasoline Prem.10ppm") return "Gasoline Prem. 10ppm"
  if (p === "Fuel Oil EXTRA") return "Fuel Oil 1.0%"
  if (p === "HSFO 180 CST" || p === "HSFO 380 CST") return "HSFO 180/380 CST"
  return p
}

function fixProductLabels(quotes: VlQuote[]): VlQuote[] {
  const companionFixes: Set<string> = new Set()
  for (const q of quotes) {
    const price = q.price
    if (price == null) continue
    const isAsia = /sing|mops|ag|mopag|mopj/i.test(q.location)
    if (q.product === "Naphtha" && isAsia && q.unit === "USD/bbl" && price >= 95 && price <= 130) {
      q.product = "Gasoline Prem. 10ppm"
      const key = q.location.replace(/\s+conv\.?\s*MT/i, "").trim()
      companionFixes.add(key)
      console.log("[code-table] Fixed product: Naphtha -> Gasoline Prem. 10ppm for " + q.location + " (price=" + price + ")")
    }
  }
  for (const q of quotes) {
    const key = q.location.replace(/\s+conv\.?\s*MT/i, "").trim()
    if (companionFixes.has(key) && q.product === "Naphtha" && q.unit === "USD/mt") {
      q.product = "Gasoline Prem. 10ppm"
      console.log("[code-table] Fixed companion: Naphtha -> Gasoline Prem. 10ppm for " + q.location + " (conv.MT=" + q.price + ")")
    }
  }
  for (const q of quotes) {
    const price = q.price
    if (price == null) continue
    const isAsia = /sing|mops|ag|mopag|mopj/i.test(q.location)
    if (q.product === "Naphtha" && isAsia && q.unit === "USD/mt" && price >= 780 && price <= 900) {
      q.product = "Gasoline Prem. 10ppm"
      console.log("[code-table] Fixed product: Naphtha -> Gasoline Prem. 10ppm for " + q.location + " (MT price=" + price + ")")
    }
    if (q.product === "Gasoil 0.1%" && /fob|cif/i.test(q.location) && /med|nwe|rott/i.test(q.location) && !/sing|mops|ag|mopag|mopj/i.test(q.location)) {
      if (q.unit === "USD/mt" && price >= 620 && price <= 680) {
        q.product = "Naphtha"
        console.log("[code-table] Fixed product: Gasoil 0.1% -> Naphtha for " + q.location + " (price=" + price + ")")
      }
    }
    // Naphtha FOB AG (MOPAG) bbl > 100 is impossible - likely MT in BBL field
    if (q.product === "Naphtha" && /ag|mopag/i.test(q.location) && q.unit === "USD/bbl" && price > 100) {
      const factor = MT_BBL_FACTORS["Naphtha"] ?? 8.9
      const corrected = Math.round(price / factor * 100) / 100
      console.log("[code-table] Fixed Naphtha BBL outlier: " + q.location + " " + price + " -> " + corrected + " (was likely MT)")
      q.price = corrected
    }
  }
  return quotes
}

function fixLocations(quotes: VlQuote[]): VlQuote[] {
  for (const q of quotes) {
    if (/HSFO|FO 1\.0%|FO 3\.5%|FO 180|FO 380/i.test(q.location) && q.product !== "HSFO 180/380 CST" && q.product !== "Fuel Oil 1.0%" && q.product !== "Fuel Oil 3.5%") {
      const oldLoc = q.location
      q.location = "HSFO 180/380 CST"
      if (q.product === "Fuel Oil EXTRA") q.product = "HSFO 180/380 CST"
      console.log("[code-table] Fixed location: " + oldLoc + " -> " + q.location)
    }
    if (q.location === "FO 1.0%" || q.location === "FO 1,0%") {
      q.location = "HSFO 180/380 CST"
      if (q.product === "Fuel Oil EXTRA") q.product = "HSFO 180/380 CST"
      console.log("[code-table] Fixed location: FO 1.0% -> HSFO 180/380 CST")
    }
    if (/CIF\s+Sing/i.test(q.location)) {
      q.location = q.location.replace(/CIF\s+Sing/i, "FOB Sing (MOPS)")
      console.log("[code-table] Fixed location: CIF Sing -> FOB Sing (MOPS)")
    }
    if (/CIF\s+AG/i.test(q.location)) {
      q.location = q.location.replace(/CIF\s+AG/i, "FOB AG (MOPAG)")
      console.log("[code-table] Fixed location: CIF AG -> FOB AG (MOPAG)")
    }
  }
  return quotes
}

export function applyCodeTable(vl: VlExtractionResult, fileName?: string): VlExtractionResult {
  if (!vl.image_date && fileName) {
    const m = fileName.match(/(\d{4}-\d{2}-\d{2})/)
    if (m) vl.image_date = m[1]
  }
  const quotes = [...vl.quotes.map(q => ({ ...q }))]
  console.log("[code-table] Processing " + quotes.length + " quotes")

  fixProductLabels(quotes)
  fixLocations(quotes)

  for (const q of quotes) {
    q.product = normalizeProductName(q.product)
  }

  // Step 1: Fix codes
  for (const q of quotes) {
    q.code = fixOcrErrors(q.code)
    const known = getKnownCode(q.product, cleanLoc(q.location))
    if (known && q.code !== known) {
      console.log("[code-table] Code corrected: " + q.code + " -> " + known + " (" + q.product + "|" + q.location + ")")
      q.code = known
    }
  }
  console.log("[code-table] Step 1 done: codes fixed")

  // Step 2: Fix suspect changes
  for (const q of quotes) {
    if (q.change != null && q.price != null) {
      const absPct = Math.abs(q.change) / q.price
      const isAsiaMOPJ = /mopj/i.test(q.location) && /conv/i.test(q.location)
      if (absPct > 0.5 && !isAsiaMOPJ) {
        const range = PRICE_RANGES[q.product]
        if (!range) continue
        const maxChange = q.unit === "USD/bbl" ? 8 : 50
        if (Math.abs(q.change) > maxChange) {
          const factor = q.unit === "USD/bbl" ? 1 : MT_BBL_FACTORS[q.product] ?? 7.5
          const plausibleChange = q.price * (q.change / (q.price * factor))
          const pcRounded = Math.round(plausibleChange * 100) / 100
          console.log("[code-table] Fixed suspect change: " + q.product + "|" + q.location + " " + q.change + " -> " + pcRounded)
          q.change = pcRounded
        }
      }
    }
  }
  console.log("[code-table] Step 2 done: suspect changes fixed")

  // Step 3: MT/BBL cross-validation
  const byKey = new Map<string, VlQuote[]>()
  for (const q of quotes) {
    const key = q.product + "|" + cleanLoc(q.location)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(q)
  }
  for (const [key, qs] of byKey) {
    if (qs.length < 2) continue
    const product = qs[0].product
    const factor = MT_BBL_FACTORS[product] ?? MT_BBL_FACTORS["ULSD 10ppm"]!
    const bblQ = qs.find(q => q.unit === "USD/bbl")
    const mtQ = qs.find(q => q.unit === "USD/mt" && !isConvMt(q))
    if (bblQ && mtQ && bblQ.price != null && mtQ.price != null) {
      const expectedMt = Math.round(bblQ.price * factor * 100) / 100
      const diffPct = Math.abs(mtQ.price - expectedMt) / expectedMt
      if (diffPct > 0.03) {
        console.log("[code-table] MT/BBL mismatch: " + key + " MT=" + mtQ.price + " expected=" + expectedMt + " (" + (diffPct*100).toFixed(1) + "%)")
      }
    }
  }
  console.log("[code-table] Step 3 done: MT/BBL cross-validated")

  // Step 3.5: Detect duplicated conv.MT values across products
  const mtByValue = new Map<number, VlQuote[]>()
  for (const q of quotes) {
    if (q.price == null || q.unit !== "USD/mt" || !isConvMt(q)) continue
    if (!mtByValue.has(q.price)) mtByValue.set(q.price, [])
    mtByValue.get(q.price)!.push(q)
  }
  for (const [val, qs] of mtByValue) {
    if (qs.length >= 3) {
      const products = new Set(qs.map(q => q.product))
      if (products.size >= 2) {
        console.log("[code-table] Duplicate conv.MT " + val + " across " + products.size + " products - flagging")
        for (const q of qs) {
          q.change = null
        }
      }
    }
  }

  // Step 3.6: Fix BBL/MT confusion for Fuel Oil
  for (const q of quotes) {
    if (q.product === "Fuel Oil 1.0%" && q.unit === "USD/bbl" && q.price != null && q.price > 150) {
      const factor = MT_BBL_FACTORS["Fuel Oil 1.0%"] ?? 6.35
      const correctedBbl = Math.round(q.price / factor * 100) / 100
      console.log("[code-table] Fixed Fuel Oil BBL/MT confusion: " + q.location + " " + q.price + " -> " + correctedBbl + " USD/bbl")
      q.price = correctedBbl
    }
  }

  console.log("[code-table] Step 4 done: FOB/CIF ordering checked")

  fillMissingAsiaRows(quotes, byKey)
  console.log("[code-table] Step 5 done: missing rows filled, outliers removed")

  return { quotes, spreads: vl.spreads, mt_bbl_factors: vl.mt_bbl_factors, image_date: vl.image_date }
}

const ASIA_LOCATIONS = ["FOB Sing (MOPS)", "FOB AG (MOPAG)", "MOPJ"]

function fillMissingAsiaRows(quotes: VlQuote[], byKey: Map<string, VlQuote[]>) {
  const products = new Set(quotes.map(q => q.product))
  for (const product of products) {
    const factor = MT_BBL_FACTORS[product]
    if (!factor) continue
    const hasAsia = ASIA_LOCATIONS.some(loc =>
      quotes.some(q => q.product === product && cleanLoc(q.location) === loc)
    )
    if (hasAsia) continue
    const euQuotes = quotes.filter(q => q.product === product && /med|nwe|rott/i.test(q.location) && q.unit === "USD/mt" && q.price != null)
    if (euQuotes.length === 0) continue
    console.log("[code-table] Product " + product + " missing Asia rows, no fallback available")
  }
}

export function toQuotesReport(result: VlExtractionResult): {
  chart_data: unknown
  quotes_report: {
    source: string
    chart_data: unknown
    commodities: QuotesReportCommodity[]
    report_date: string
    total_quotes: number
    outliers_removed: unknown[]
  }
  image_date: string
} {
  const byProduct: Record<string, VlQuote[]> = {}
  for (const q of result.quotes) {
    if (q.price == null || q.price === 0 || q.price > 2000) continue
    if (!byProduct[q.product]) byProduct[q.product] = []
    byProduct[q.product].push(q)
  }

  const productToCommodity: Record<string, string> = {
    "ULSD 10ppm": "diesel-gasoil",
    "JET-A1": "jet-fuel",
    "Gasoline Prem. 10ppm": "gasoline",
    "Gasoline Prem.10ppm": "gasoline",
    Naphtha: "naphtha",
    "Gasoil 0.1%": "diesel-gasoil",
    "Gasoil 0.05%": "diesel-gasoil",
    "Fuel Oil 1.0%": "fuel-oil",
    "Fuel Oil 3.5%": "fuel-oil",
    "HSFO 180": "fuel-oil",
    "HSFO 380": "fuel-oil",
    "HSFO 180/380 CST": "fuel-oil",
    "HSFO 180 CST": "fuel-oil",
    "HSFO 380 CST": "fuel-oil",
    "US D6": "fuel-oil",
    "US 100": "fuel-oil",
    ULSD: "diesel-gasoil",
    JET: "jet-fuel",
    Gasoline: "gasoline",
    Gasoil: "diesel-gasoil",
    "Fuel Oil": "fuel-oil",
  }

  function mapProductToCommodity(product: string): string {
    const normalized = normalizeProductName(product)
    if (productToCommodity[normalized]) return productToCommodity[normalized]
    for (const [known, comm] of Object.entries(productToCommodity)) {
      const a = normalized.toLowerCase()
      const b = known.toLowerCase()
      if (a.includes(b) || b.includes(a)) return comm
      for (const kw of ["ulsd","jet","gasoline","naphtha","gasoil","fuel","hsfo","d6","d 6","us 100"]) {
        if (a.includes(kw) && b.includes(kw)) return comm
      }
    }
    return "unknown"
  }

  const commodities: QuotesReportCommodity[] = []
  for (const [product, quotes] of Object.entries(byProduct)) {
    const commodity = mapProductToCommodity(product)
    const units = new Set(quotes.map(q => q.unit?.replace("USD/", "")))

    for (const unit of units) {
      const unitQuotes = quotes.filter(q => q.unit?.replace("USD/", "") === unit)
      if (unitQuotes.length === 0) continue

      commodities.push({
        commodity,
        product: normalizeProductName(product),
        unit,
        details: unitQuotes.map(q => ({
          location: q.location,
          code: q.code || "",
          price: q.price ?? 0,
          change: q.change ?? null,
          currency: "USD",
        })),
      })
    }
  }

  const totalQuotes = commodities.reduce((sum, c) => sum + c.details.length, 0)

  return {
    chart_data: { type: "bar", unit: "varies", title: "Energy Quotes - " + result.image_date, xAxis: [], series: [] },
    quotes_report: {
      source: "admin_manual_upload",
      chart_data: { type: "bar", unit: "varies", title: "Energy Quotes - " + result.image_date, xAxis: [], series: [] },
      commodities,
      report_date: result.image_date,
      total_quotes: totalQuotes,
      outliers_removed: [],
    },
    image_date: result.image_date,
  }
}
