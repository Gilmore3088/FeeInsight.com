# Fee Insight refinement plan — from the executive-panel audit (2026-08-17)

Source: six-lens executive audit (CMO, Brand, Communications, UX Research, UI/Visual, Growth/SEO)
synthesized into 16 findings (F1–F16). Panel verdict: do not send the 25 outreach emails against the
site as it stands. This plan resolves every code-addressable finding, then re-runs the same panel.

Brand hierarchy is settled and out of scope: Fee Insight (company/site) → Bank Fee Index (product)
→ Hamilton (Pro workspace). Contact stays hello@bankfeeindex.com.

## Decisions taken (panel resolutions adopted as-is)

- Report offer: **Competitive Fee Position Report — $300, delivered in 48 hours.** One name, one
  price, everywhere ($250 was a placeholder). "Fee Insight Advisory" = the commissioned report plus
  custom competitor sets, board decks, multi-institution work.
- Homepage stays search-first; add the site header, an institution lane under the search, and an
  outcome-first Pro card. No hero redesign.
- Sales-page primary CTA: "See a sample report"; secondary "See pricing". Retire "Request Early Access".
- Hamilton canonical sentence: "Hamilton is the Fee Insight Pro workspace: benchmark, scenario,
  report and monitor your fee position against a verified peer set." Never "our AI analyst" as a headline.
- Public status vocabulary: **Verified / Under review / No published schedule found.** "Rows" → "fees".
- One numbers source: `getPublicStats()` + `getDataFreshness()` via a shared `public-stats` helper (all figures queried live; no constants);
  no hand-typed counts on any public surface. One freshness format: "Data refreshed Aug 12, 2026".
- Free tier is the public Bank Fee Index lookup; remove any promised Hamilton quota.
- Contrast: #7A7062 minimum for text ≤14px; #A09788-family reserved for rules/disabled.

## Work streams (parallelizable; strict file ownership)

### S0 — Numbers contract (do first; others depend on it)
- New `src/lib/public-stats.ts`: `getPublicStatsSummary()` → formatted strings
  (institutions, observations, categories, states, freshness) with `cache()`.
- Replace hand-typed counts: `subscribe/page.tsx` ("1,100+"), `(auth)/login`, `(auth)/register`,
  `components/upgrade-gate.tsx` ("1,100+", "13,000+"), `(public)/about` ("65"), `(public)/methodology`
  ("4,000+", "approximately 4,800"), `(public)/fees` header ("65", "94 more"), `(public)/research`.
- One freshness format via `formatFreshness()`; institution pages: "Fee schedule collected <date> ·
  Financials as of <quarter>". Retire "the definitive source". (F6)

### S1 — Shell, homepage, sales page, pricing (owner: `src/app/page.tsx`, `landing-hero.tsx`,
`landing-trust-stats.tsx`, `for-institutions/page.tsx`, `subscribe/page.tsx`, `components/consumer-nav.tsx`,
`consumer-mobile-nav.tsx`, `customer-footer.tsx`, `pro-nav.tsx`, `(auth)/*`, `account/welcome/*`)
- Render `ConsumerNav` on `/` and `/for-institutions`; add "For Institutions" to nav + footer Product
  column; "Get Pro Access" → `/for-institutions`. Standardize on `max-w-6xl`. (F5)
- Homepage: Pro card rewritten in outcome terms; institution lane line under search
  ("Work at a bank or credit union? Get your Competitive Fee Position report — $300"); Organization +
  WebSite JSON-LD; em dashes. (F5, F8, F10)
- `/for-institutions`: report offer block first (name, $300, 48h, inline request form → `/api/leads`
  with source=report); CTAs "See a sample report" / "See pricing"; "How this compares" table (annual
  survey / DIY scrape / Fee Insight); Advisory defined in one line; Hamilton canonical sentence;
  one list of five workspace modes. (F1, F14, F8)
- `/subscribe`: cards "Fee Insight Pro — Monthly / Annual" with identical features; "$499/mo";
  "Save $1,000" → computed; Advisory card "Competitive Fee Position Report — $300"; Free column
  (public lookup); FAQ (cancel, invoice/PO, seats, refresh cadence); "Book a walkthrough" mailto;
  ladder line; CTAs "Start monthly / Start annual" carrying `?plan=` through `/register`. (F7, F1)
- Auth: "Work email" on both; "Forgot password?" link (mailto fallback if no reset flow); shared value
  prop line; header on auth pages; remove "3 Hamilton queries/day". (F9, F7)

### S2 — Institution profile, directory, submit/claim, consumer copy (owner: `(public)/institution/[id]/*`,
`(public)/institutions/*`, `submit-fees/*`, `consumer/*`, `lib/institution-profile-links.ts`, `api/institutions` if needed)
- Profile: one formatter for assets/deposits/service-charge income (fix `formatAssets` vs
  `formatCompactDollars`); hide ROA when 0; delete "displayed as stored"; enum → label map
  (`community_small` → "Community credit union, under $250M", `per_occurrence` → "per item", etc.);
  title-case city; hide Source submission/status rows publicly; title
  "<Institution> Fees: Overdraft $X, NSF $Y, Monthly $Z"; fee schedule as a grouped table with one
  Verified badge per family; one metric row; "Work at <Institution>?" band; anonymous Pro buttons →
  `/subscribe?from=`; suppress narrative below 5 verified fees; collapse duplicate fee names. (F4)
- Directory: verified-first sort with "Has verified fees" chip; per-state "N verified / M monitored";
  one control per viewport (drop snapshot repeat + "Update directory"); buyer-language subhead and
  labels; auto-apply filters. (F12, F9)
- Submit-fees: nav + footer, back link, optional work email, success card; free "Claim this profile"
  path for institution employees (route to `/submit-fees?claim=<id>` instead of Pro-gated settings). (F15)
- Consumer headline: "What does your bank charge? Compare overdraft, ATM, wire and monthly fees
  against N banks and credit unions." (F9)

### S3 — Brand edges, contrast, tokens (owner: `src/app/icon.tsx`, `apple-icon.tsx`, `manifest.ts`,
`opengraph-image.tsx`, `not-found.tsx`, `globals.css`, `lib/brand.ts`, `lib/fee-taxonomy.ts` FAMILY_COLORS,
`lib/email/workspace-invite.ts` styles, `Reports/studio/template.html` cover ring, `(public)/fees/*` bars)
- One mark (three bars) on icon/apple-icon/OG/brand.ts/print cover; manifest theme_color #FAF7F2;
  OG card with the wordmark, "The Bank Fee Index", feeinsight.com. (F10)
- Focus ring terracotta; 404 + invite email on the warm palette; warm-family palette for /fees;
  per-family bar scaling; thousands separators. (F10)
- Contrast: promote ≤14px text from #A09788/#A69D90/#B0A89C to #7A7062+ (eyebrows 11px, table
  headers, footer, footer email as mailto in #5A5347); hamburger 44px; wide tables scroll with
  affordance. (F11)

### S4 — Proof, reports, leads, analytics, SEO (owner: `(public)/reports/*`, new `r/[token]/*`,
`api/leads/route.ts`, `components/public/email-signup.tsx`, `lib/analytics.ts` (new), `sitemap.ts`, `robots`,
`(public)/fees/city/*` aggregation, `lib/report-*` for sample)
- Publish one anonymized sample Competitive Fee Position report under `/reports/sample-competitive-fee-position`
  built from an existing `Reports/studio/out/*.html`, anonymized ("a $400M community bank in the Atlanta
  district"); `/reports` hides filter UI when empty and lists the sample. (F3)
- Hosted per-institution report route `/r/[token]` that renders a prepared report by token from
  `Reports/studio/out/` (token map file), with exec summary, PDF link, refresh price, "Book 15 minutes". (F3)
- Leads API: newsletter branch inserts-or-tags and never overwrites non-null name/company/role;
  footer copy "Monthly fee index update: new benchmarks, notable fee changes, one chart." (F13)
- Analytics: `trackEvent(event)` helper (no analytics provider connected); events on Create account / Request a Report /
  See a sample report / newsletter / checkout start. (F13)
- SEO: sitemap adds /for-institutions, /subscribe, /contact, /api-docs, guides; /reports priority
  reduced until content; real lastmod where available; noindex city pages with <3 institutions and
  institution pages with 0 verified fees; city aggregation includes listed institutions. (F16)

### S5 — Outreach kit (owner: `Reports/studio/outreach-template.md`, `email-preview.html`, `template.html`
back page, `fill.mjs` if it generates the back page)
- Sender "James Gilmore · Fee Insight"; full signature; neutral subject; priced 15-minute ask; drop
  "verified data pipeline"; form-only 3-line variant; "Attn:" for general inboxes; UTM on links;
  PDF filename convention; back page "Retail $300 — yours with our compliments; quarterly refresh $300". (F1, F2)

### S6 — Naming canon and copy purge (cross-cutting; applied inside S1/S2 files plus
`lib/hamilton/navigation.ts`, `(public)/research/*`, `components/upgrade-gate.tsx`, `pro/page.tsx`)
- Nav/footer label "Bank Fee Index" for /fees; retire "National Fee Index" label, "Hamilton Pro",
  "Executive Hamilton reports" → "Board-ready reports from Hamilton"; one list of five modes; purge
  Atlas/Scout/admin strings from public routes; glossary terms; drop TIER column on /fees. (F8, F9)

## Explicitly not resolvable in code (handed back)
- LinkedIn research for marketing/product leads at the 25 targets; sending the emails.
- Stripe payment-mode checkout for the $300 SKU: scoped as an inline request form now; checkout
  needs a Stripe price created in the dashboard (user action) before code can reference it.
- Verification of the top-50 banks / 25 CUs by deposits (data pipeline work, not UI).

## Verification
- `npm run guard:legacy` (incl. brand-kill), `npx tsc --noEmit`, `npm run lint` (0 errors),
  `npm run test:agentic`, `npx vitest run` for touched libs.
- Re-capture the 17 pages (desktop + mobile) and re-run the same 7-agent executive panel; publish
  v2 of the audit page with before/after scorecard.
