# 2026-11-01: the answer-key exclusions, read one receipt at a time

**Lesson:** Read every excluded answer key's own receipt before changing rules or keys: of 62 keys, 4 had eligible receipts and the scoreboard counted 1, because a day-old receipt was reused and lapsed minutes after the run, plain official links scored under the fee-link bar, same-text HTML recaptures counted as newer editions, menus read as business sections and div-grid schedules as unpriced; fixing those moves 4 to 7 (dry run from the receipts and stored texts), and the rest need the re-key path. A frozen, append-only golden set now measures recall 74.9% and precision 95.5% offline.

**What happened:** the Nov 1 12:50 UTC scoreboard counted 1 eligible answer-key bank of 62 (#2533). The
latest `answer_key.eligibility` receipt of each confirmed key (read-only, Nov 1) showed 4 eligible (keys 22,
66, 74, 85), 9 rejected and 49 unknown. Each receipt records its three facts (consumer, current, priced), the
pages it fetched with their links, and the discovery graph, so every exclusion could be checked against its
own evidence.

**Causes, by what the evidence shows:**

| Exclusion | Keys | Evidence | Verdict |
|---|---|---|---|
| Eligible receipt lapsed | 3 (22, 66, 85) | Checked Oct 31 12:40; the Nov 1 run reused them (still valid) and they expired at 12:40-12:41, before the 12:50 scoreboard | Bug: renew before lapse |
| `official_current_link_unproven` | 23 of 41 keys with no official path | An official page fetched in the receipt links straight to the key document; "Fee Schedule" on `/fee-schedule` scores 0.65 against the 0.72 fee-link bar, so it never became a candidate | Bug: a direct link is an official path |
| `reference_source_superseded` (HTML) | 15 of 29 | Every later copy is at the key's own URL with the same stored text hash; HTML bytes change on every fetch | Bug: same-text recapture is not a new edition |
| `consumer_scope_unproven` | some of 11 | Some "business section labels" are a run of menu items ("Business / Business Checking / Business Savings / Treasury Management") with no price near them; others (key 73) are a real priced business section | Bug for a menu of 3+ unpriced labels; right for the rest |
| `priced_schedule_unproven` / `not_priced_schedule` | most of 21 | Every key line is in the page (the consumer fact passed), but names and prices sit in separate div cells, so no text line pairs a fee word with an amount | Bug for a fee schedule: three confirmed key lines with a $ or cent price in the page prove it priced; a TIS disclosure or rates page (key 117) stays out |
| `key_line_not_in_reference` | 16 | Key lines are composed or transcribed, not the document's words (key 5: 37 of 37 lines missing from its own stored text; key 112: 40 of 40) | Right: re-key (#2832) |
| HTML superseded with changed stored text | 12 | A later copy at the key's URL has different text | Right: re-key against the current copy |
| PDF bytes or HTML main text changed | 9 (all also above as key lines missing) | The document changed after the key | Right: re-key |
| `business_document` | 5 | Business schedules | Right: needs a consumer document |

**Fix (this PR, no key or data changes):**
- `refreshReferenceEligibility` renews a durable receipt with less than 12 hours left (`needsRenewal`).
- `observeReferenceDocument` records an official page's plain link to the key document's own address as the official path. A link to where the key redirects (key 109) and business-only pages or links do not count.
- `currentFact` ignores a supersession of an HTML key's bytes when every later copy is a successful, non-duplicate capture that keeps the key's URL and stored text (`sameTextRecapture`).
- `consumerFact` reads a run of at least 3 business labels, with no price between them or on the 3 lines after, as navigation (`businessSectionEvidence`). Any other label, including two adjacent ones, still counts.
- `audienceHeading` reads an optional plural ("Business Account(s)") as the plural word, so a combined schedule's business section switches scope (key 51, texasfcu.org, read every business key line as consumer), and a consumer-headed page with no business heading still counts unheaded business labels as business evidence.
- `pricedFact` passes a fee schedule (or an "other" document that is not a rates page) whose own text holds at least 3 of the key's confirmed lines with a $ or cent price. TIS disclosures, rates pages, agreements, product pages and articles still fail. Candidates, which have no key, keep the page score alone.

**Dry run (from the stored receipts and stored texts, no fetch):** 4 eligible before (1 at the scoreboard).
After: 7 firm (22, 66, 74, 85, plus 59, 98, 104). Key 22 is firm on its live receipts only: eligible on 5
runs Oct 25-31, each fetching the key's own PDF bytes. The stored-text dry run does not support it (the stored
copy is an older read with another hash whose lines wrap differently, so it reads `key_line_not_in_reference`),
and its last receipt expired Nov 1 12:40, so it stays firm only if the next live run repeats that result.
At most 8 if key 60 also passes live (its stored text
passes the consumer and priced facts, its live receipt did not). Out after review: 51 (its key holds
business-section fees, such as "Business Loan Application Fee $50.00", from a "Business Account(s)" section
the heading parse missed), 109 (official pages link only the address its key URL redirects to), 73 (a real
priced "Business Checking Fees" section), 117 (a rates page), 41 and 96 (business labels outside a menu run
of three). Every later copy behind 98 and 104 is a successful, non-duplicate capture. The target of 40 is not reachable by repairing exclusions; it needs about 30 stale or
non-verbatim keys re-keyed from current documents (#2832), which writes keys and waits for James's yes.
Live re-observation from this session was not possible: the session's proxy refuses bank websites.

**Golden set:** `src/lib/agents/deming/__fixtures__/golden-set.json` v1 holds 381 members:
- 252 shadow-lab cases, frozen by text hash with their expectations: W43 live audit, adversarial documents, hard documents, the hourly rows and the holdout answer keys;
- 125 regression takedowns, with their check inputs frozen;
- the 4 eligible banks, by key fingerprint and document hash.

`measureGoldenSet` (offline, no model calls) measures today's pipeline at:
- recall 1,322 / 1,766 = 74.9%;
- precision 1,366 / 1,431 = 95.5%;
- 254 of 287 known-wrong fees refused (88.5%).

The 4 banks need their stored text (`loadAnswerKeyBankTexts`) and are not in these numbers.

**Data check (read-only):** golden member key 66 is a `rates.php` address, but its stored text is the
"Fee Schedule" tab ("Effective as of: January 1, 2024", no APY or dividend terms, kind fee_schedule), so it stays.
Key 59 is "Fee Schedule - Effective 05/01/21"; the 2026-10-01 date belongs to the "Products and Rates" rates
page, which has no stored copy, and the 2021 schedule is the only fee schedule the homepage links, so it stays
eligible with that caveat. Key 59 is not a golden-set member.

**Agent lesson:** deming/issue-2533-read-every-exclusion-reason
