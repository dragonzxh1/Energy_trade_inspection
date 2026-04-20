# How One Trade Nearly Destroyed a Company — What I Learned About Reading Sanctions Lists

In 2023, a Singapore-based energy trading company was fined over $5 million by the U.S. Office of Foreign Assets Control (OFAC) for a single oil trade that "looked perfectly normal."

What went wrong? Their counterparty — a company registered in the UAE — was actually a shell company for an Iranian oil trader. This UAE company had been explicitly listed on OFAC's SDN (Specially Designated Nationals) list.

But the Singapore company insisted: "We checked. The company name wasn't on any list."

**They made a fatal mistake: they only searched by name, not by ownership relationships.**

---

## Sanctions Lists Are More Complex Than You Think

Many people assume checking sanctions lists is like checking a blacklist — search for a name, and if it's not there, you're safe.

In reality, sanctions matching rules are far more complex:

### 1. It's Not Just Name Matching
- Company changed its name? Still sanctioned
- Using aliases or trade names? Still sanctioned
- Subsidiaries and affiliates? May also be sanctioned

### 2. Major Sanctions Lists at a Glance

| List | Publisher | Characteristics |
|------|-----------|------------------|
| SDN List | U.S. OFAC | Most widely used, broadest reach |
| Consolidated Sanctions List | U.S. OFAC | SDN + other restricted entities |
| EU Sanctions List | EU Council | For EU-based operations |
| UN Sanctions List | UN Security Council | Globally applicable |

### 3. The 50% Rule

The U.S. Treasury Department has a clear rule: if a company is sanctioned, any affiliate **owned 50% or more (directly or indirectly)** is also considered sanctioned — even if those affiliates' names don't appear on any list.

That's exactly how the Singapore company got caught: they searched the UAE company's name but never checked the shareholder structure behind it.

---

## A Real Red Flag Checklist

When developing ETI (Energy Trade Inspection), I compiled common red flags for "hidden sanctions":

🔴 **Abnormal Ownership Structure**
- Registered in a tax haven but operating in high-risk jurisdictions
- Opaque shareholder information or multi-layered nesting to hide ownership

🔴 **Abnormal Vessel Behavior**
- Frequent AIS signal interruptions (dark periods)
- Frequent vessel renaming, suspicious IMO numbers
- Routes passing through sanctioned ports (Iran, North Korea, Russia, etc.)

🔴 **Abnormal Transaction Patterns**
- Prices significantly below market rates
- Complex payment flows through multiple offshore accounts
- Missing or contradictory documentation (bills of lading, invoices, certificates of origin)

---

## How to Properly Check Sanctions Lists?

### Step 1: Fuzzy Name Matching

Don't just search exact names. Also search:
- Company aliases and former names
- Keywords (core company terms)
- Spelling variations

### Step 2: Ownership Relationship Tracing

Investigate:
- Shareholder structure (who controls the company?)
- Directors and officers (any sanctioned individuals?)
- Affiliated entities (parent companies, subsidiaries)

### Step 3: Cross-Verification

- Sanctions list screening
- Corporate registry verification
- AIS vessel data (for maritime trades)
- News and media searches

---

## Recommended Tools

The ETI platform I built integrates all these capabilities:
- Real-time OFAC, EU, and UN sanctions list matching
- Automated corporate registry verification (Hong Kong, Singapore, Switzerland, etc.)
- AIS vessel tracking and dark period detection
- One-click authenticity score reports

---

## Conclusion

Sanctions compliance isn't as simple as "checking a list." It requires systematic due diligence — name matching is just the first step. Ownership relationships, vessel behavior, and transaction patterns are all critical signals.

If you work in energy trading, shipping, or compliance, follow me for more practical risk identification insights.

**What "near-miss" situations have you encountered in your trades? Share in the comments.**

---

## Publishing Tips

**Best time to publish**: Tuesday or Wednesday, 9-10 AM (LinkedIn peak hours)

**Hashtags**:
#SanctionsCompliance #EnergyTrading #RiskManagement #OFAC #DueDiligence #InternationalTrade

**Image suggestions**:
- Sanctions screening flowchart
- Red flag infographic
- Professional industry-related image