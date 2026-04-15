# Energy Trade Inspection — Task Prioritization

**Last revised:** 2026-04-08 (rev 2)
**Direction basis:** ETI is a Trade Verification Engine, not a data platform.
The system must answer "does this trade make sense?" — not "what data exists about this entity?"

---

## Priority Framework

| Tier | Label | Criterion |
|------|-------|-----------|
| P0 | **Core Direction** | Directly fixes the product's entry point or core verification loop |
| P1 | **Engine Depth** | Makes the verification engine more powerful or explainable |
| P2 | **Signal Enrichment** | Adds new data signals to existing rules |
| P3 | **Deferred** | UI polish, accessibility, features that don't strengthen the engine |

---

## P0 — Core Direction (Do These First)

### TASK-01: Homepage — Trade Check First
- **What:** Restructure the homepage hero to lead with "Check a Trade" as the primary CTA. The current hero leads with a search box ("search for an entity"), which positions ETI as a database. The new hero should ask: "Does this trade make sense?" with a minimal inline form — seller name + vessel — that submits directly to `/trade`.
- **Why:** The product's value hypothesis cannot be validated if users never reach the trade check. Right now trade check is a hidden feature behind login; it should be the product's front door.
- **Acceptance:** Landing on `/` presents a trade check form as the primary action. Entity search becomes secondary (still accessible, but not the hero).
- **Does not include:** Removing search entirely; it stays as a secondary path.
- **Priority:** P0

### TASK-02: Screen → Trade Judgment Loop
- **What:** When document screening extracts entities from a contract, if the document contains identifiable trade parameters (seller + vessel or IMO + port or commodity), automatically pipe them into the trade rules engine and output a **trade-level judgment** — not just entity-level risk cards. The result should answer "does this contract describe a legitimate trade?" with flags drawn from both entity screening and trade rules.
- **Why:** Currently `/screen` does entity screening (each entity individually). But the real question is about the **trade described in the document**. The loop is: contract → extract entities → extract trade → run trade check → unified judgment.
- **Acceptance:** After screening a contract that contains seller + vessel + port, the result page shows a "Trade Assessment" section above the entity list, with the same flag structure as `/api/trade`.
- **Priority:** P0

---

## P1 — Engine Depth

### TASK-03: Trade Rules — Three New Flags
- **What:** Add three new deterministic rules to `trade-rules.ts`:
  1. **NEWLY_INCORPORATED_SELLER** (HIGH): Seller incorporated < 24 months ago AND trade value signals (commodity = crude/LNG/bunkers). Shell pattern: newly incorporated companies in free zones trading high-value commodities.
  2. **VESSEL_FLAG_ROUTE_MISMATCH** (MEDIUM): Vessel flag state is known evasion flag (KM Comoros, PW Palau, TG Togo, SL Sierra Leone, MD Moldova) AND declared loading port is not in a region consistent with that flag's typical trade patterns.
  3. **MULTIPLE_OPERATOR_CHANGES** (MEDIUM): Vessel has had more than 2 operator/owner changes in the past 18 months (from PSC/registry history). Frequent flipping is a sanctions evasion signal.
- **Why:** The current 6 rules cover the most obvious cases. These three target the next tier of evasion patterns common in Iran/Russia/Venezuela trade.
- **Priority:** P1

### TASK-04: Trade Narrative — Coherent Risk Story
- **What:** Rewrite `generateSummary()` in `trade-rules.ts` to produce a coherent risk narrative rather than a list of flags. The output should read like an analyst's assessment: "This trade has [N] signals that together suggest [specific pattern]. The most critical: [flag]. Additionally: [supporting signals]. Recommendation: [action]."
- **Why:** Currently the summary is close to "N flags detected. Severity: HIGH." That's a score, not a judgment. Users (compliance officers) need to understand the story to act on it.
- **Acceptance:** `summary` field reads as a 2–4 sentence analyst note that a non-technical user could act on. It names the pattern (e.g., "possible sanctions evasion via flag-of-convenience vessel") rather than just listing signals.
- **Priority:** P1

### TASK-05: PSC History as Trade Rule Signal
- **What:** PSC deficiency data is currently only visible on the vessel detail page. Add it as an explicit trade flag: if vessel has detention history (detentions > 0) or deficiency rate > 30%, fire `VESSEL_COMPLIANCE_RISK` flag in trade check.
- **Why:** A vessel with multiple detentions is a direct trade risk signal — it may be unseaworthy or operating outside compliance. This data already exists in the DB; it's just not wired into the rules engine.
- **Acceptance:** `POST /api/trade` with a vessel that has PSC detentions returns a `VESSEL_COMPLIANCE_RISK` flag with the detention count and deficiency rate as evidence.
- **Priority:** P1

---

## P2 — Signal Enrichment

### TASK-06: Watchlist — Trade Pattern Monitoring
- **What:** Extend watchlist from "watch an entity" to "watch a trade pattern." Users can save a seller + vessel combination (or seller + port) and get alerted when either party's risk profile changes (new sanctions, new PSC detention, AIS dark period near saved trade date).
- **Why:** Compliance officers don't just care about entities in isolation; they care about whether a previously approved counterparty has changed. This is where retention and recurring value come from.
- **Priority:** P2

### TASK-07: Company Age Lookup
- **What:** For seller entities matched in Companies House or ACRA, extract the incorporation date and store it in `metadata_json`. Surface it in trade check output and use it in TASK-03's NEWLY_INCORPORATED_SELLER rule. For entities outside UK/SG coverage, fall back to GLEIF API (free, name-based fuzzy search) to retrieve incorporation date from LEI record.
- **Why:** Data dependency for TASK-03. Also useful independently — incorporation date is a key due diligence data point.
- **Data sources (in priority order):** Companies House (UK) → ACRA (Singapore) → GLEIF API (global fallback, free)
- **Priority:** P2

### TASK-08: GLEIF Ownership Chain Detection
- **What:** For seller companies in a trade check, query the GLEIF API to retrieve their Level 1 (direct parent) and Level 2 (ultimate parent) ownership relationships. If the ultimate parent jurisdiction is a known offshore/shell jurisdiction (BVI, Cayman Islands, Marshall Islands, Seychelles, Belize, Panama, Samoa, Vanuatu), fire a new `OFFSHORE_HOLDING_STRUCTURE` flag (HIGH severity).
- **Why:** The highest-risk evasion pattern is not an offshore company trading directly — it's a seemingly legitimate UK/SG/AE company that is wholly owned by a BVI/Cayman holding entity. This is the multi-hop ownership chain that simple jurisdiction checks miss. GLEIF Level 2 data solves this and is free.
- **Implementation notes:**
  - GLEIF REST API: `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]={name}` (free, no API key)
  - Level 2 relationship endpoint: `GET /api/v1/lei-records/{lei}/ultimate-parent`
  - **Do not use OpenCorporates as a data source** — bulk data is paywalled (£2,250–£12,000/yr). GLEIF covers the same ownership graph for free.
  - OC-to-LEI mapping CSV (GLEIF, bi-weekly): use only if entity already has an OC company ID stored; otherwise go direct via name search.
- **New flag:** `OFFSHORE_HOLDING_STRUCTURE` (HIGH) — "Ultimate beneficial owner is registered in [jurisdiction], a known shell company jurisdiction."
- **Acceptance:** `POST /api/trade` for a seller company ultimately owned by a BVI holding entity returns `OFFSHORE_HOLDING_STRUCTURE` flag with the ownership chain as evidence.
- **Priority:** P2

---

## P3 — Deferred (Do Not Prioritize)

These are valid improvements but do not strengthen the verification engine. Do them only after P0 and P1 are complete.

### TODO-D1: Color contrast accessibility (axe-core CI integration)
- **Original priority:** P2 → **Revised:** P3
- Reason: UI compliance work. Valuable eventually, not now.

### TODO-D2: Mobile score bar prototype
- **Original priority:** P2 → **Revised:** P3
- Reason: Entity detail UI polish. Target users are desktop compliance officers.

### TODO-PDF: PDF report enhancement
- **Status:** Deferred
- Reason: The core value is the judgment, not the document. Polish the output logic before polishing the export.

### TODO-ENTITY-UI: More entity detail page tabs / data display
- **Status:** Deferred indefinitely
- Reason: More data tabs make ETI look more like a database product. This directly contradicts the direction.

---

## Stopped Work

The following categories of work should not be initiated:

| Category | Reason |
|----------|--------|
| Entity browse/filter UI improvements | Reinforces database product positioning |
| Mobile optimization for entity detail pages | Wrong audience focus |
| Additional data aggregation without rule wiring | Data for its own sake |
| Passive display of more data fields | Contradicts decision-output direction |

---

## Execution Order

```
TASK-01 (Homepage)
    ↓
TASK-02 (Screen → Trade Loop)
    ↓
TASK-03 (New Rules)  +  TASK-04 (Narrative)  ← run in parallel
    ↓
TASK-05 (PSC as Rule Signal)
    ↓
TASK-07 (Company Age)  +  TASK-08 (GLEIF Ownership Chain)  ← run in parallel
    ↓
TASK-06 (Watchlist)
```

> **Data source decision (locked):** GLEIF API is the ownership chain layer. OpenCorporates is not a free bulk data source — do not treat it as one.

---

## Direction Check (re-evaluate before each P1+ task)

Before starting any task, ask:
> Does this make ETI better at answering "does this trade make sense?"

If no → defer to P3 or drop.
