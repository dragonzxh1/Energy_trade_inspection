/**
 * Domain check UAT — Phase 06 human test automation
 *
 * Tests:
 *   1. DOMAIN_SPOOFING_RISK — domain visually similar to legitimate_domains entry
 *   2. DOMAIN_WHOIS_RISK    — domain with suspicious WHOIS signals (injected via cache)
 *
 * Run: npx tsx test/domain-uat.ts
 */

import { checkDomain } from '../src/lib/server/domain-check'
import { runTradeRules, type TradeRuleInput } from '../src/lib/server/trade-rules'
import { db } from '../src/lib/server/db'

// Minimal TradeRuleInput — only domain-check fields vary between tests
function makeInput(override: Partial<TradeRuleInput> = {}): TradeRuleInput {
  return {
    sellerName: 'Test Energy Corp',
    sellerDbMatch: null,
    sellerSanctioned: false,
    sellerSanctionSources: [],
    sellerIncorporationDate: null,
    vesselName: 'TEST VESSEL',
    vesselImo: null,
    vesselDbMatch: null,
    vesselSanctioned: false,
    vesselSanctionSources: [],
    vesselAis: null,
    loadingPortLocode: null,
    loadingPortCountry: null,
    loadingPortName: null,
    draftRisk: null,
    tradeDate: null,
    ...override,
  }
}

function pass(msg: string) { console.log(`  ✓ PASS  ${msg}`) }
function fail(msg: string) { console.log(`  ✗ FAIL  ${msg}`); process.exitCode = 1 }

// ── Test 1: DOMAIN_SPOOFING_RISK ─────────────────────────────────────────────
// viterra-energy.com  →  normalized: "viterraenergy"
//                        compared to "viterra.com" → "viterra"
//                        substring containment → score ≈ 0.78 > 0.75 threshold
async function testSpoofingRisk() {
  console.log('\n── Test 1: DOMAIN_SPOOFING_RISK ─────────────────────────────')

  const check = await checkDomain('viterra-energy.com')
  console.log(`  checkDomain result: flagged=${check.flagged}, severity=${check.severity}`)
  console.log(`  spoofingMatches: ${JSON.stringify(check.spoofingMatches)}`)
  console.log(`  evidence: ${JSON.stringify(check.evidence)}`)

  if (!check.flagged) {
    fail('checkDomain did not flag the domain')
    return
  }
  if (check.spoofingMatches.length === 0) {
    fail('no spoofing matches returned')
    return
  }

  pass(`checkDomain flagged domain (${check.severity}), ${check.spoofingMatches.length} spoofing match(es)`)

  // Inject into runTradeRules
  const flags = runTradeRules(makeInput({
    sellerDomainCheck: {
      domain: check.domain,
      flagged: check.flagged,
      severity: check.severity,
      evidence: check.evidence,
      spoofingMatches: check.spoofingMatches,
    },
  }))

  const domainFlag = flags.find(f => f.code === 'DOMAIN_SPOOFING_RISK')
  if (domainFlag) {
    pass(`DOMAIN_SPOOFING_RISK flag present in trade rules output`)
    console.log(`  reason: ${domainFlag.reason}`)
  } else {
    fail('DOMAIN_SPOOFING_RISK not in flags — got: ' + flags.map(f => f.code).join(', '))
  }
}

// ── Test 2: DOMAIN_WHOIS_RISK ─────────────────────────────────────────────────
// Inject a fake domain_whois_cache entry:
//   registered 60 days ago + privacy protected → score = 4+2 = 6 → high → flagged
// Domain must NOT look like any legitimate_domains entry (no spoofing)
const WHOIS_TEST_DOMAIN = 'eti-whois-test-xyz123.com'

async function injectWhoisCache() {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)
  const oneYearFromReg = new Date(Date.now() - 60 * 86_400_000 + 365 * 86_400_000)
    .toISOString()
    .slice(0, 10)

  await db.query(
    `INSERT INTO domain_whois_cache
       (domain, registered_at, expires_at, duration_days,
        registrant_org, registrant_name, registrant_country,
        privacy_protected, queried_at, error, raw_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
     ON CONFLICT (domain) DO UPDATE SET
       registered_at     = EXCLUDED.registered_at,
       expires_at        = EXCLUDED.expires_at,
       duration_days     = EXCLUDED.duration_days,
       registrant_org    = EXCLUDED.registrant_org,
       registrant_name   = EXCLUDED.registrant_name,
       registrant_country= EXCLUDED.registrant_country,
       privacy_protected = EXCLUDED.privacy_protected,
       queried_at        = EXCLUDED.queried_at,
       error             = EXCLUDED.error,
       raw_json          = EXCLUDED.raw_json`,
    [
      WHOIS_TEST_DOMAIN,
      sixtyDaysAgo,      // registered_at
      oneYearFromReg,    // expires_at
      365,               // duration_days — 1-year only (+2)
      null,              // registrant_org — none (+2 for no org)
      null,              // registrant_name
      null,              // registrant_country
      true,              // privacy_protected (+2)
      null,              // error — no error so cache is used
      '{}',             // raw_json
    ]
  )
  // total score: 60 days (+4) + 1-year (+2) + privacy (+2) = 8 → high → flagged
}

async function testWhoisRisk() {
  console.log('\n── Test 2: DOMAIN_WHOIS_RISK ────────────────────────────────')

  // Inject fake WHOIS cache so no real RDAP call needed
  await injectWhoisCache()
  console.log(`  Injected WHOIS cache for ${WHOIS_TEST_DOMAIN}`)

  const check = await checkDomain(WHOIS_TEST_DOMAIN)
  console.log(`  checkDomain result: flagged=${check.flagged}, severity=${check.severity}`)
  console.log(`  whois riskScore=${check.whois?.riskScore}, riskSignals=${JSON.stringify(check.whois?.riskSignals)}`)
  console.log(`  spoofingMatches: ${JSON.stringify(check.spoofingMatches)}`)
  console.log(`  evidence: ${JSON.stringify(check.evidence)}`)

  if (!check.flagged) {
    fail('checkDomain did not flag the domain')
    return
  }
  if (check.spoofingMatches.length > 0) {
    fail('unexpected spoofing matches — test domain should have zero spoofing hits')
    return
  }
  if (check.evidence.length === 0) {
    fail('evidence array is empty — DOMAIN_WHOIS_RISK requires evidence')
    return
  }

  pass(`checkDomain flagged domain (${check.severity}), riskScore=${check.whois?.riskScore}, no spoofing`)

  const flags = runTradeRules(makeInput({
    sellerDomainCheck: {
      domain: check.domain,
      flagged: check.flagged,
      severity: check.severity,
      evidence: check.evidence,
      spoofingMatches: check.spoofingMatches,
    },
  }))

  const domainFlag = flags.find(f => f.code === 'DOMAIN_WHOIS_RISK')
  if (domainFlag) {
    pass(`DOMAIN_WHOIS_RISK flag present in trade rules output`)
    console.log(`  reason: ${domainFlag.reason}`)
  } else {
    fail('DOMAIN_WHOIS_RISK not in flags — got: ' + flags.map(f => f.code).join(', '))
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup() {
  await db.query('DELETE FROM domain_whois_cache WHERE domain = $1', [WHOIS_TEST_DOMAIN])
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Domain check UAT — Phase 06\n')
  try {
    await testSpoofingRisk()
    await testWhoisRisk()
  } finally {
    await cleanup()
    await db.end()
  }

  const code = process.exitCode ?? 0
  console.log(`\n${code === 0 ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`)
  process.exit(code)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
