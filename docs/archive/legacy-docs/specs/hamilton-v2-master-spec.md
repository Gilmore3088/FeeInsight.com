# Hamilton V2 — Intelligence Platform Master Spec

**Status:** Approved for implementation
**Date:** 2026-04-08
**Owner:** James Gilmore

---

## Vision

The product is the data — the largest collection of bank and credit union fees in the country. Hamilton is the gateway that turns all the national noise into actionable, accessible, and informative intelligence.

Hamilton is not a chatbot. Hamilton is a lead consultant who happens to have the best fee dataset in the country, enriched with 13 external data sources (FRED, Beige Book, CFPB, Call Reports, BLS, Census, NY Fed, OFR, SOD, FDIC, NCUA, Fed speeches, Fed in Print), and the ability to connect external events to internal data in ways no human analyst can.

Hamilton is the key value generator that secures recurring revenue.

---

## Three Audiences

**Admin (you):** Full intelligence feed. Everything first. Morning brief, signal detection, operational flags. Hamilton is your chief of staff.

**B2B Subscribers ($2,500/mo):** Curated insights relevant to their peer group. Monthly pulse, quarterly reports, on-demand competitive briefs, chat access. Hamilton is their senior analyst.

**Consumers:** Plain-language understanding of their bank's financial position, fee structure, and how it compares. Hamilton helps them understand what fees mean and why they're charged. Hamilton is their financial advocate.

---

## Architecture — Three Layers

### Layer 1: Intelligence Ingestion (mostly built)

13 ingestion pipelines exist. What's missing:
- **Signal/change detection** on top of raw ingestion (what changed, what's newsworthy)
- **Event classification** (regulatory action, rate change, merger, enforcement, legislative)
- **Connection engine** (link external events to internal fee data — which institutions, categories, districts are affected)

### Layer 2: Reasoning Engine (needs upgrade)

Current: Independent section generation with narrow context, over-constrained output.

V2:
- **Global thesis generation** per time period (quarterly thesis emerges from data)
- **Cross-source synthesis** (fees + revenue + economic + regulatory + complaints in every analysis)
- **Insight hierarchy** (core thesis > supporting insights > evidence)
- **Tension model** (frame as competing forces, not observations)
- **Revenue prioritization** (revenue implications > competitive dynamics > pricing observations)
- **Think-then-compress** (reason in 5-8 sentences, output 2-3 most important)
- **Unified voice layer** shared by chat and reports

### Layer 3: Delivery (partially built)

| Output | Status | Audience | Cadence |
|--------|--------|----------|---------|
| Intelligence feed | NEW | Admin | Continuous |
| Morning brief | NEW | Admin | Daily |
| Chat (unified) | UPGRADE (consolidate 4 agents) | All | On-demand |
| Monthly pulse | EXISTS (needs V2 reasoning) | B2B | Monthly |
| Quarterly report | EXISTS (needs V2 reasoning + external signals) | B2B premium | Quarterly |
| Competitive briefs | EXISTS (needs enrichment) | B2B | On-demand |
| Consumer briefings | NEW (per-institution, plain language) | Public | On-demand |

---

## Prompt Architecture

### Current: 8 prompts + 16 tool descriptions

| # | Prompt | Location | Status |
|---|--------|----------|--------|
| 1 | Ask the Data (public) | agents.ts | Generic — needs consumer translator |
| 2 | Fee Analyst (premium) | agents.ts | Upgraded 2026-04-08 |
| 3 | Content Writer (admin) | agents.ts | Upgraded 2026-04-08 |
| 4 | Custom Query (admin) | agents.ts | Upgraded 2026-04-08 |
| 5 | Hamilton Voice (reports) | voice.ts | Strong voice, over-constrained |
| 6 | Editor | editor.ts | Basic consistency |
| 7 | 12 internal tool descriptions | tools-internal.ts | Functional |
| 8 | 4 public tool descriptions | tools.ts | Basic |

### V2: 10 prompts + 16 upgraded tool descriptions

| # | Prompt | New/Upgrade | Purpose |
|---|--------|-------------|---------|
| 1 | Global Thesis Generator | NEW | Analyze full payload, produce quarter's thesis + tensions + priorities |
| 2 | Hamilton Voice v3 | UPGRADE | 150-200 words, think-then-compress, revenue prioritization, tension model |
| 3 | Section Generator v2 | UPGRADE | Receives global thesis + full cross-source context |
| 4 | Signal Detector | NEW | What changed? What's newsworthy? Runs on fresh data |
| 5 | Consumer Translator | NEW | Plain language per-institution briefings |
| 6 | Editor v2 | UPGRADE | Thesis alignment, revenue prioritization, contradiction detection |
| 7 | Morning Brief Generator | NEW | 3-5 actionable bullets from signal detector |
| 8 | Monthly Pulse v2 | UPGRADE | Global thesis + signals + trends |
| 9 | Unified Chat Persona | CONSOLIDATE | One Hamilton, role-based depth (consumer/pro/admin) |
| 10 | Tool Descriptions v2 | UPGRADE | Strategic guidance, not just data descriptions |

---

## Content Cadence

| Cadence | What | For Whom | Hamilton's Role |
|---------|------|----------|-----------------|
| Continuous | Intelligence feed — news + regulatory + data signals | Admin | Synthesize, connect to fee data, flag what matters |
| Daily | Morning brief — 3-5 bullets of what changed/matters | Admin | Chief of staff who read everything before you woke up |
| Monthly | Pulse — trend summary + notable events + market signals | B2B subscribers | Curated insights with fee data context |
| Quarterly | National report — full strategic analysis with thesis | B2B premium | McKinsey-grade, global thesis, all data sources |
| On-demand | Chat — ad-hoc questions from any audience | All | Senior partner on speed dial |
| On-demand | Competitive briefs — peer analysis for specific institution | Pro subscribers | Personalized, institution-specific |
| On-demand | Consumer briefings — your bank's position explained | Public | Financial advocate with data nobody else has |

---

## Key Design Decisions

1. **One unified Hamilton layer** — chat is for quick nuggets, reports are for structured published research. Same reasoning engine, different output format.
2. **Thesis is flexible per quarter** — emerges from the data each period, not hardcoded. Find data to support that quarter's thesis.
3. **Revenue > pricing** — if revenue implications exist, prioritize them over pricing observations.
4. **Data is the product** — Hamilton is the gateway, not the product itself. Data quality and coverage always come first.
5. **Fees don't change daily** — daily/weekly content is about connecting national noise (regulatory, economic, competitive) to the fee data, not reporting on price changes.
6. **Consumer Hamilton explains position** — not just guides. "Here's your bank's financial position and fee structure, here's how it compares, here's what it means for you."

---

## Salesforce Connected FINS Reference

46-page report. Structure:
- 60% narrative / 40% chart per page
- 150-250 words per section (vs our current 75)
- Bold inline stat callouts embedded in flowing text
- Full paragraphs, not stat cards
- Two-column layout: narrative left, chart right
- Chapter divider pages with bold typography

Our reports should match this depth and editorial quality.

---

## Success Criteria

Hamilton V2 is successful when:
- Output reads as a single argument, not isolated observations
- Each section reinforces a core thesis that emerged from the data
- Insights are directional ("banks must...") not descriptive ("the median is...")
- Revenue implications are clearly prioritized over pricing observations
- External events (CFPB, Fed, economic) are connected to internal fee data
- Consumers can understand their bank's position without financial expertise
- B2B subscribers renew because Hamilton's analysis is worth $2,500/month
- Admin morning brief saves 30 minutes of manual scanning daily

---

## Open Questions for Implementation

1. Signal detection: rule-based (threshold alerts) or LLM-based (Hamilton decides what's newsworthy)?
2. Consumer translator: separate prompt or mode parameter on unified Hamilton?
3. Morning brief: email delivery or admin dashboard widget or both?
4. Quarterly thesis: fully automated or human-reviewed before sections generate?
5. How to A/B test V2 output quality against current?

---

*Reference: Salesforce Connected FINS Report at Reports/Connected-FINS_Report_Final.pdf*
*Reference: Original V2 spec at docs/specs/hamilton-v2-strategy-engine.md*
