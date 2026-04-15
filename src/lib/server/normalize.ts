/**
 * Canonical entity name normalization.
 *
 * Used at BOTH write time and query time — one function, consistent behavior everywhere.
 *
 * stripGeneric=true  → use when writing to the normalized_name column (stored form)
 * stripGeneric=false → use when normalizing a user's search query (preserves intent)
 *
 * The suffix list here MUST stay in sync with migration 027_renormalize_entity_names.sql.
 * If you add suffixes here, add them to the SQL migration too.
 */

// Legal entity type abbreviations — real-world only, no fabricated entries.
// Sync with migration 027.
const LEGAL_SUFFIXES =
  /\b(sa|sarl|sas|srl|spa|sl|sc|se|sk|ltd|limited|inc|incorporated|corp|corporation|co|company|bv|nv|gmbh|ag|kg|ug|kgaa|pte|fze|fzco|fzc|llc|llp|lp|lllp|plc|as|asa|ab|oy|oyj|aps|sdn|bhd|pvt|jsc|ojsc|ooo|zao|pjsc|kft|nyrt|bt|ev|ek|hb|kb|nb|mb)\b\.?/gi

// Generic industry/descriptor words — stripped from stored form only, not queries.
// Sync with migration 027.
const GENERIC_WORDS =
  /\b(energy|trading|marine|maritime|shipping|petroleum|oil|gas|lng|lpg|commodities|cargo|logistics|services|solutions|resources|group|holdings|holding|international|management|investment|investments|capital|finance|financial|partners|partnership|ventures|venture|enterprise|enterprises)\b/gi

export function normalizeEntityName(text: string, stripGeneric = false): string {
  let s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics: torbjörn → torbjorn
    .replace(LEGAL_SUFFIXES, ' ')

  if (stripGeneric) {
    s = s.replace(GENERIC_WORDS, ' ')
  }

  return s
    .replace(/[^a-z0-9\s]/g, ' ') // strip remaining non-alphanumeric
    .replace(/\s+/g, ' ')
    .trim()
}
