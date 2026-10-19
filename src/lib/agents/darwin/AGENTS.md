# Darwin Agent Guide

Darwin owns verification and classification.

## Ancillary product ownership (#1911 code phase, 2026-10-19)

A bounded single-primary-deposit-product document can assign its own ancillary priced fee
rows to the literal product. `ANCILLARY_PRODUCT_VERSION` is v1 (Knox's evidence format,
`ancillary_product:v1`); this is not a re-read selector or permission to repair old metadata.
The title and printed applicability clause stay with the bank's own fee conditions; frequency
comes only from the fee's own price line. Mixed sections/columns, generic guides, unsupported
headings and exceeded budgets remain unassigned. The general U.S. Bank $3 ATM/$5 money-order
rows keep their existing unassigned scope; the Safe Debit exceptions belong to Safe Debit.

Only newly inserted ancillary raw rows receive v1 ownership. A same-document raw insert
conflict, including an ordinary due read or held takeover, keeps the existing row unchanged.
Monthly-maintenance/minimum-balance lineup behavior is unchanged. Therefore simply re-running
existing rows cannot recover missing ownership. Existing NULL metadata, numeric pooling policy
and any exact metadata/rejudge recovery remain separate unchecked work in #1911.

Shared `fee-product.ts` identity folds ASCII case and explicit transport whitespace (including
NBSP). Unsupported Unicode case/separators stay distinct. Null/blank is one unassigned identity,
never every product. Represented distinct products and represented/unassigned pairs cannot
supply one another's duplicate, refresh or source-applicability witness. Holds and admin
correction blockers keep their conservative broader overlap rules.

Extract rules v83, stale-read floor v78, verify rules v3, Darwin batch key v4, publish rules v3,
refresh-copy v2, current-copy v2 and newer-copy v1 stay settled. No source-check v2 bump,
fingerprint reopening, broad re-run, historical metadata backfill, recovery or numeric benchmark
policy is authorized by this code phase. Bayes's `ANCILLARY_PRODUCT_VERSION` no-replay entry
records the exception; old settled decisions need a separately designed and authorized path.

Darwin's v4 batch key and second-source comparison include the represented normalized product.
New v1-owned rows must still have the matching primary-product title and their own price inside
its bounded fee block; generic neighbouring prices are insufficient. The verifier locks and
rechecks the selected raw product before writing its new verified lineage inside the run-ledger
transaction. That transaction is a precondition of exported insertVerifiedFee; inSavepoint
alone does not start one, and standalone autocommit is not supported. Existing peer/category/source/zero policies and settled decisions remain intact.
## Reference eligibility (2026-10-19, #1862)

Current answer-key feedback is admitted only through the shared durable eligibility snapshot
and its original real-run receipt. Matching IDs/fingerprints alone do not authorize old labels.
The category-model cache rechecks the snapshot revision before reuse; all historical unbound
answer-key rows remain stored and excluded. Missing/unknown is never a right/wrong lesson.

Frozen `answer-key-fees.json` is a separate dataset. Its provenance manifest hashes the original
fixture text and compact fees but records the absent original document mapping for all 81 texts.
Runtime verdict scoring v2 therefore reports no measurement, and unbound old chunks/lessons
cannot teach or authorize promotion. Offline fixture history remains intact. Holdout weight is
always zero and its misses never enter prompts. See `deming/REFERENCE-ELIGIBILITY.md`.

## Authority

- Darwin reads `raw_fee_observations`.
- Darwin writes eligible rows to `verified_fee_observations`.
- Darwin may skip or challenge raw rows when canonical category, amount, duplicate, source lineage, or policy checks fail.
- Darwin may emit Monitor signals for verified rows and verification-review states.
- Darwin owns re-checking live fees against today's rules (James, 2026-10-15). A rule added at Knox,
  Darwin or publish joins Darwin's live re-check in the same PR, with a dry-run count of the live
  fees it would take down. Takedowns go through the shared second look and the run ledger
  (`docs/project/DECISIONS.md`, 2026-10-15).
  The account type hold (#1100 gap 1, James Oct 16: a savings, money market, club, business or
  IRA/HSA/CD account's monthly fee is not consumer checking monthly maintenance) has its live
  re-check in Hamilton's publish step (`hamilton/account-type-hold.ts`, part 1), which reads every
  live `monthly_maintenance` fee each step and holds a typed one as verified; see Hamilton
  `AGENTS.md` item 10b.
  The article-page refusal (publish never puts a fee read from an article, blog, learning or
  advice page live; #1774 widened it on Oct 17 to Magellan's article rule) has its live re-check
  in Hamilton's publish step too (`hamilton/article-page.ts`, check `hamilton.article_page`,
  through the shared second look). Dry run, Oct 17: 7 live fees at 6 institutions.
  The Oct 15 re-file of excess withdrawals and returned mail out of account research (#1398) has
  no Darwin-only live pass yet: its live re-check is Hamilton's fold step (`taxonomy-fold.ts`,
  every publish step), which reads up to 2,000 live and verified account research fees whose name
  the split might move (every one with the `research_split_full_count` param) and, while `RESEARCH_SPLIT_LIVE` is off, writes the would-move count by route
  with samples to `detail.taxonomy_fold.pendingResearchSplit` and moves nothing. Moves only
  re-file; none takes a fee down. Once on, live fees under the two new types are guarded by the
  category guard's live sweep.

## Current Implementation (2026-10-12, verify.rules version 3)

`darwin/verify.ts` checks, in order, and records the first failure as a reason code:

| Code | Rule | Decision |
|---|---|---|
| `missing_canonical` | a valid canonical hint | rejected |
| `missing_name` | a non-empty fee name | rejected |
| `category_mismatch` | for the guarded categories, the fee name names its category and not a different fee (`src/lib/fee-category-guard.ts`); a name that names a neighbouring guarded category is re-filed there first (`refileCategory`). Guard v62 (#1100) also reads the row's own source line: a monthly maintenance row whose line charges its price per withdrawal, debit, transaction, transfer or item fails, and one charged per activity over a limit is re-filed to account research first (`refileFromLine`; to excess withdrawals instead, once `RESEARCH_SPLIT_LIVE` is on, when the line names savings, money market or share withdrawals, transfers or debits) | rejected |
| `missing_lineage` | Hamilton's publish rule (`sourceLinkSkipReason` in `hamilton/source-link.ts`, #1345): a source document, and an http(s) link, the row's own or its document's. A stored file key alone is not enough (#1350): such a row would be verified and then refused at publish forever. The reason text is Hamilton's refusal ("No source link: the fee can't be traced to the bank's document", or "No source document: ...") | rejected |
| `percent_not_publishable` | a fee stated as a rate ("1.1% of the transaction") is filed under a category that publishes rates (`PERCENT_FEE_RANGES` in `src/lib/percent-fees.ts`: foreign transaction, cash advance, coin counting, late payment); elsewhere a rate is often an interest rate, not a fee. A rate that passes needs `rate_percent` and no dollar amount (else `invalid_amount`) and a rate inside that category's range (else `outside_envelope`), and its source check is `checkRateAgainstSource` | rejected |
| `invalid_amount` | an amount; $0 only with Knox's `knox_review:zero` flag | rejected |
| `outside_envelope` | a positive amount inside its category's range: hand-set (`envelopes.ts`), else learned (`learned-envelopes.ts`), else $0.01-$2,500 | needs_review |
| `not_in_source` | the fee is stated in the stored text of the document Knox read it from (`checkFeeAgainstSource`, the shared accuracy check; a tiered price counts) | rejected |
| `peer_outlier` | pass 2: not far outside the state's peer range (below); a district or national comparison never holds | needs_review |
| `duplicate_in_batch` | the same fee line (institution, category, amount, frequency, stored document) already verified in this batch | duplicate |
| `duplicate_verified` | the insert did not conflict with an existing verified row | duplicate |
| `category_lesson_pending` | the fee name does not match a category lesson the shared guard has not learned yet (`DARWIN_CATEGORY_HOLDS` in `verify.ts`); Darwin never re-files a row itself, so the row waits for the guard | needs_review |
| `retired_category` | after the source check: the category is not one the top-50 fold retired (`RETIRED_CATEGORIES` in `src/lib/fee-fold.ts`); Hamilton never publishes a retired type, so Darwin never verifies into one | rejected |
| `conditional_zero` | after the source check: a $0 fee whose own schedule line (or Knox's excerpt) carries a non-zero price ("FREE with e-statements, else $6.95 per month"); the charge is the fee, so the $0 reading waits for a re-read | needs_review |
| `tier_perk_zero` | after the source check: a $0 fee is not from one account tier's own schedule (a premium, private-banking or BankOn fee page, known by its address or title) and is not named for such an account (`tier-perk.ts`, #1397: one large bank's live overdraft, NSF, stop payment and wire fees were the $0s of its private-banking Premium Account); a priced row on that schedule is still verified | rejected |
| `name_rule` | after the source check: the name and line pass Hamilton's live-fee name rules (`ruleFor` in `hamilton/eval-verdicts.ts`: rebate, no-fee or waiver sentence, balance threshold, merchant payer, two fees on one line, rate bound, price in name); the rule and why are in the reason text | rejected |
| `insert_failed` | the database accepted the verified row; a refused insert holds that row so the rest of the batch still runs (#1113) | needs_review |

- Each decision records `category_guard_version`; when `CATEGORY_GUARD_VERSION` rises, rows rejected
  as `category_mismatch` or held as `category_lesson_pending` under an older guard are selected
  once more. The hold list (`DARWIN_CATEGORY_HOLDS`) is empty. Its one entry, "Bond return items"
  $35 filed `nsf` (raw 246460, 2026-10-09), left when guard v58 learned that a returned bond or
  coupon filed as NSF is a returned deposited item.
- A Knox category change is a reason to judge a row again (#1295, `category-change.ts`): new
  category, new decision. A row qualifies only when Knox marked it as re-read (`knox_reread_took_over`,
  `knox_stale_hint_repaired`, or `knox_refiled_from:<old>` from #1291), it waits for Darwin
  unverified, no decision was judged under today's category or today's `refileCategory` of it, and
  each decision was made under an earlier Knox category. A decision says so by its `knox_category`
  (recorded from #1295 on). An older one needs proof from the row's flags: a `knox_refiled_from:`
  or `knox_stale_hint_repaired` marker (written when Knox's category changes on a row Darwin had
  judged), or a judged category that is another `canonical_hint:` flag still on the row. Without
  proof the decision may be an older Darwin re-file of today's category, and the row is left
  alone: raw 132922, "Collection Items (plus any bank fees)" $20, a plain take-over filed
  `collection_item` and judged `check_cashing`, while today's re-file keeps `collection_item`.
  The same free checks decide, the shared source check among them, and the new decision records
  today's category, so a row is judged once per category. Switched on Oct 15 (#1093, James's
  yes; `DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE = true`): up to 100 a step join the batch. Each verify
  step, a dry run included, writes the candidate count, their earlier reasons and a 25-row sample
  to `detail.category_change_rejudge`; the read runs in a savepoint, so a failed count never fails
  the step, and a dry run judges nothing. The switched-off dry run (Oct 14 16:16 to Oct 15 09:26,
  336 steps) found 10 candidates; all 10 match their bank's schedule in amount and today's
  category: 6 had been judged under the neighbouring column's fee, 4 fax fees under
  `account_research`. Measured Oct 14 (after #1291 merged): 0 rows qualify; the SQL
  selection reads 1 row (132922), which the proof rule leaves alone. The 8 take-over rows with a
  stale first flag qualify once #1291's repair (inside its switched-off re-file pass) runs, and the
  re-file pass adds its rows when it is on. The 216 rows #1093 step 2 sent back carry the category
  they were rejected under, so this rule does not reach them.
- A Knox take-over that changes a retired row's category writes `knox_takeover_from:<old>`
  (#1295, `knox/extract.ts`), since the take-over drops the old `canonical_hint:` flags and left
  no proof. It counts as proof, like `knox_refiled_from:`, only with
  `DARWIN_TAKEOVER_CATEGORY_PROOF_LIVE` on (off, gated on James). Off, each verify step counts and
  samples the rows only it would add in `detail.category_change_rejudge.takeover_proof`. Measured
  Oct 16 (read-only): no row carries the flag yet, so it would add 0 today; the pool a take-over
  can reach is 1,356 retired, unverified Knox rows (1,269 with a v3 decision).
- `not_in_source` (2026-10-06) runs the same check Hamilton's live-fee source check runs, so a
  fee the bank's schedule does not state is stopped before it is verified instead of being
  published and then taken down. It joined version 3 without a bump: a bump re-selects every
  decided row, and rows once held as `duplicate_in_batch` would be verified as second copies.
  Each decision also records `source_check_version` (`DARWIN_SOURCE_CHECK_VERSION`, 2026-10-09):
  when it rises, `not_in_source` rejections stamped lower (or unstamped) are read once more, so a
  fix to the shared source check reaches the rows it was made for. Before that a `not_in_source`
  rejection was final; 1,126 rows at 499 banks were waiting on fixes already live (Northern Trust's
  wrapped-name $25 overdraft, raw 457013, among them).
  The count-cap note fix (Oct 17, Gate City Bank 349: a price under "Maximum of 4 fees per calendar
  day.") did not raise it: of the 1,816 Knox rows rejected `not_in_source` with no verified row, none
  is stated on a price line right under such a note (read-only count), so a bump would re-read 1,259
  rows for nothing this fix changes. Gate City's own row (raw 767395) is undecided and gets the new
  check on its first read.
  The wrapped-bullet fix (#2151, Oct 19) also leaves source-check v2: it adds an own-row witness
  for newly faithful Knox candidates and restricts neighboring-price fallback. A read-only
  current-copy screen of latest-v3 `not_in_source` rejections found 149 rows whose texts contain
  the bullet-label grammar; none matches an owned primary label, and stored-source replay changed
  zero verdicts. SchoolsFirst's old misnamed row was rejected for category, not source. New
  undecided candidates receive the check normally; old decisions are not reopened as a side effect.
- `retired_category`, `conditional_zero` and `name_rule` (2026-10-09, `postSourceCheck` in
  `verify.ts`) run after the source check on the line it matched. UAT's hand check of the first
  36 rows the `not_in_source` re-select verified found 16 of a random 20 right: three were $0
  readings of "free if you meet a condition, else $2.50-$6.95" lines, one a package list verified
  into the retired `estatement_fee` type. The same checks are Hamilton's publish-time rules, so a
  row that would come down after publishing now stops before it is verified.
- A `conditional_zero` hold is settled by the next verify step (`conditional-zero-resolve.ts`,
  #1115; James approved rules a-c, 2026-10-13), up to 200 a step, each as a `verify.rules` verdict:
  (a) a duplicate when the same document has a priced verified fee in its category; (c) verified
  at $0 (flag `darwin_conditional_zero_released`) when the bank's own schedule, not a product page,
  prices it free on its own line with no other dollar figure, outside overdraft, NSF, monthly
  maintenance and minimum balance, and not on one account tier's own schedule (`tier-perk.ts`,
  #1397); (b) otherwise rejected, for Knox's next read of the line.
- `verify.recheck` (`verified-recheck.ts`, version 5, 2026-10-16) ends every learning verify step
  by reading up to 200 rows `verify.rules` v3 verified (the rows the `not_in_source` re-select
  verified first, then newest first), once each under `postSourceCheck` and, from version 3, the
  tier-perk test (`tier_perk_zero`, #1397). Version 4 (#1571, #1574): on a run-on line with no
  cell break the conditional-$0 test reads only the fee's own row, from its name to its $0 and
  any terms after it ("FREE with e-Statements"), so "Notary Services No Charge" is free even when
  the line also holds "Record Searches $30"; a cell with its own label ("Certified Letter Fee:
  $10") is never this fee's price. The tier-perk name test skips an account's own monthly or
  minimum-balance price ("Premier Checking" $0, "NONE"); a tier's own schedule still refuses it.
  Version 5 (#1593): the conditional-$0 test reads a two-column page by its columns, failing safe:
  the other column must be positively another fee. A cell after this fee's own "name $0" is the
  other column only when its label is a Title Case name the page prints as its own priced row
  elsewhere or under a right-column heading naming fees ("Bill Pay | Other Fees" over "Bill Pay
  ---- No Charge | Account History ---- $3.00 each"); a fee noun alone is no proof. A delivery
  tier, channel, activity or holder's choice ("Overnight Shipping", "Verbal Request", "Low
  Activity", "Opted Out Of Overdraft"), or a label opening with No, Range of, Multiple, Each
  additional or Per, never is. A price opening the fee's
  table cell after another fee's label cell is that fee's ("5x10x20 Safe Deposit Box Annually |
  $75.00 Bill Pay | No Charge"). On a run-on line, text after the $0 that states a condition
  anywhere, parentheses included, stays the fee's terms; otherwise it is the other column only
  with document evidence (a label under the right column's fee heading that opens that column on
  a neighbouring line, or the same "name $0" row repeated next to a two-cell line with a tail the
  page prints as its own row). A label priced $0 is the next row; and
  a domestic wire's row reads its international price as another fee's. A $0 traced to a line
  that lacks a word of its name is read on the line that prints its whole name with its $0
  (`sourceLineFor`), unless that $0 is one audience's. A fee named for one audience ("Check
  Printing (members over 62)") is never freed by the column reading. A failing row that is
  not live is rejected with an `outlier_flags` entry `darwin_recheck:<code>[:<rule>]`; a live one
  is archived in the same step (`published_fee_records` rolled back with that reason, batch
  `darwin-recheck-<run>`, never deleted), the verified row rejected with the same flag and the
  public read cache cleared, once `DARWIN_RECHECK_SAME_STEP_TAKEDOWN` is on (James, 11:55 UTC
  2026-10-09: "stop waiting 12 hours. go"). While it is off (the default) the live row is flagged
  `takedown_pending` through the shared second look (`darwin.verified_recheck`), which is the dry
  read: the switch turns on by PR once UAT has hand-checked 10 flagged rows and found at least 9
  right (version 1 scored 7 of 10 at 12:19 UTC; the three misses are below). A $0's conditional
  price is read from the fee's own table cell (`ownSegment`) and, inside a cell that lists several
  "Label: value" pairs, from the fee's own label; not from a neighbour's cell in the same row, the
  other product columns of a comparison table ("Monthly fee | $0 | $5* | $0"), a non-member or
  non-customer price ("$0 - Members $5 - Non-Members"), or the deposit that opens the account
  ("$1 minimum opening requirement"). Version 2 also re-reads the rows version 1 rejected (flag
  `darwin_recheck:*`): one that passes now is restored to verified with the flag removed; a live
  row that passes now has its pending second-look flag cleared (`takedown_cleared`). Each row
  records a `verify.recheck` attempt (fingerprint `verified:<fee_verified_id>`), so a row is read
  once per recheck version and the pass never starves the batch. Never a hand UPDATE.
  Live fees verified under an older `verify.rules` version were never selected, so a rule added
  here never reached them (#1568: 15 live tier-perk $0s stayed up after version 3).
  `DARWIN_RECHECK_OLDER_LIVE` (default off) adds them: on, each step also reads up to half its
  limit of those live rows, newest first, and they fail or pass like any other row. Off, every
  fourth run reads a sample of 200 of them (in id order up from a random id, wrapping round to the
  lowest ids), runs the same checks and writes nothing: step detail `recheck.olderLive` gives `read`,
  `wouldFail` by reason code and 20 samples. That is a per-step sample; the whole backlog's count
  is a separate read-only query. It turns on by PR once James approves that count by reason.
  The 12-hour path never reached its second look: a row is read once per recheck version, so a
  live row flagged `takedown_pending` was never read again (Frost's 14 premium-schedule $0s,
  flagged `tier_perk_zero` on 2026-10-15 08:35, #1397). `DARWIN_RECHECK_SECOND_LOOK_LIVE` (default
  off) gives each due first look its second read: on, each step re-reads up to 100 live rows whose
  `darwin.verified_recheck` flag is at least 12 hours old, oldest first, and the shared second look
  archives the ones still failing and clears the rest. Off, step detail `recheck.dueSecondLooks`
  gives `due`, `wouldConfirm` by reason code, `wouldClear` and 20 samples, and nothing is written.
  It turns on by PR once James approves the count of due flags. It is still off for every code but
  one: `DARWIN_RECHECK_SECOND_LOOK_LIVE_CODES` (`["tier_perk_zero"]`, James's yes 2026-10-16 03:37
  UTC; 15 live due flags then, 14 on one large bank's premium-account schedule and 1 "Premier
  Checking" $0 that v4 now passes) gives only those codes' due first looks their second read. Such
  a row is archived only when it fails again under a switched-on code, cleared when it passes, and
  left flagged when it now fails under another code (step detail `recheck.secondLookOtherCode`);
  `recheck.dueSecondLooks` keeps reporting every other code (conditional_zero, name_rule and the
  rest). Roll back by emptying the list. `DARWIN_RECHECK_OLDER_LIVE` only
  flags; without this switch its first looks would never be confirmed, so it turns on with or after
  this one.
- `verify.document_owner` (`document-owner.ts`, version 1, 2026-10-15, #1455) ends every learning
  verify step after `verify.recheck`. It asks whose schedule a live fee's document is, by the
  document's own text, never by the stored website (the registry seed stored another bank's website
  for 5756, 4884 and 1903; CU website vendors serve one CU's file on every member domain). A live
  (institution, document) pair is read when the document is shared with another institution (its
  host is that institution's stored website, that institution has live fees from the same address,
  or one of its documents has the same `text_hash`: a completed text of 200 characters or more shared by
  at most 20 documents, so empty and "Access Denied" pages link nothing) or sits on a vendor download path
  (`/ezs3download/download/`, `/_/kcms-doc/`; a path alone is no proof). The order: all linked
  institutions share this bank's holding company gives `sibling_shared` (Wells Fargo 4/172/359,
  #1441: never taken down, counted once per document); this bank's distinct name, credit union
  acronym (SMFCU, SMCU), printed website (not the document's own host), city or certificate number
  gives `own_named` (co-branded documents pass; names read "&" as "and" and drop a trailing
  "Company", "Co.", "Corp.", "Inc.", "N.A.", "F.S.B." or "S.S.B."); on a vendor path, the hash-linked institution whose
  name form the text prints owns the copy (`other_bank` when it is another, unrelated institution;
  a bare one-word brand never counts, nor a sharer's form that contains or sits inside one of
  this bank's own forms; on this bank's own site the sharer's name must be its own: not shared,
  or printed with its city); a document on another institution's stored website, not on
  this bank's site (its stored host, a subdomain or parent of it, or the same registrable domain:
  `home.acmebank.com` owns `acmebank.com`), that never names this bank is `other_bank` naming that
  institution (the site rule; never for a bank with no stored website); then linked institutions count by a name of two words or
  more (a one-word brand such as "healthplus" only next to bank/credit union/fcu or its city;
  boilerplate and common words such as "currency", "direct", "popular" never), a name another
  institution's name contains only with its city, an acronym, or city with state. One named
  institution gives `other_bank`, two or more `shared_service` (passes); a named institution
  linked only by address or text hash is capped at `shared_service` when the text gives only its
  acronym or city with state, or when the document is on this bank's own site, so a name variant
  this bank's forms miss ("HBT Bank") never hands its own schedule away, a named sibling
  `sibling_shared`. The header rule (`headerNamesInstitution`: one of the first ten non-empty lines
  starts with the full legal name, two words or more with "bank" or "credit union", printed as a
  title, no other institution sharing it) applies only to linked institutions. An institution only
  the registry-wide name scan finds gives `registry_named`, a review verdict that passes, even as a
  title line ("Wells Fargo Bank", "U.S. Bank", "Bank of America ATM Fees", "Fees associated with",
  "processed through Bank of America" are all negative tests). Other verdicts: `unproven` (also a
  pair with no registry row), `no_text`. Live fees exclude rolled-back and quarantined ones; the scoped pairs read runs at most once an
  hour (`DOCUMENT_OWNER_SCAN_INTERVAL_HOURS`, keyed on the mode's last event), with JIT off and a
  60 s statement timeout inside its savepoint, both put back after the read. Up to 25 new pairs a step, one attempt each (fingerprint
  `owner-shadow:<institution>:<document>:<text_hash>` in shadow, `owner:...` once live, so a
  re-extracted text is read again). A step skips the scoped read when the last one of its mode
  selected no pair and the newest stored text and live fee ids are unchanged. `DARWIN_DOCUMENT_OWNER_TAKEDOWN` is on
  (James's yes, 2026-10-17; dry count 228 live fees, 19 pairs, 10 institutions). Off, it only logs
  the live fees it would take down (`darwin.document_owner_shadow` event, step detail
  `document_owner`); on, `other_bank` pairs are
  re-read under their own cap of 25, a failing fee goes through the shared second look
  (`darwin.document_owner`), passing fees clear their pending flags, and a confirmed fee is
  archived with reason `document_owner: names institution <id>`, never deleted. After the
  takedowns, on each live step that reads pairs, `releaseOwnerLinks` (#2018 item 13) lets go of the
  fee link such a takedown leaves behind: when an institution's `fee_schedule_url` is still the
  document whose fees came down as `document_owner` and no fee from it is still live there (and no
  correction locked the profile), the URL joins `rejected_source_urls`, the canonical link clears,
  and `institution_sources` goes back to `rescue_status = 'pending'` with failure reason
  `darwin_document_owner`. Step detail `links_released`. Read-only count Oct 19: 3 (Bluegrass 5756
  on UK FCU's PDF, 5Star Bank 2092, First National Bank 1903).
  `documentOwnerCountSql()` is the read-only count of the whole backlog by verdict, mirroring these
  rules in staged, materialized steps, as one script in a read-only transaction that rolls back (JIT
  and merge joins off, a 120 s statement timeout; names are matched only where their first two words
  appear next to each other). It skips the certificate test, so its `other_bank` count is an upper
  bound.
- Live name re-check (`live-fragment-check.ts`, #1443, #1436; decision 2026-10-15, "Darwin
  re-checks every live fee against today's rules"). `verify.recheck` reads verified rows of the
  current `verify.rules` version, so fees that went live earlier are never read again; this pass
  reads the live table itself. Every verify/classify step reads the next `LIVE_FRAGMENT_BATCH`
  (2,000) live fees (`published_fee_records`, not rolled back or quarantined, dollar and rate
  rows) after a cursor kept on the run ledger: the `darwin.live_fragment_check` event each step
  writes, whose `next_after_id` is 0 once a pass reaches the end of the table, so the next step
  starts the next pass. An institution-scoped run reads that bank's live fees and leaves the
  cursor alone; a dry-run run writes nothing. The rule is `liveFragmentName` (Knox's
  `name-retidy.ts`, beside `isCutoffName`), keyed on the live catalog name `fp.fee_name`, not the
  verified name (21 of 29 rows where the two differ were fragments already repaired in the
  catalog). It is the narrow live twin of publish's `cutoff_name` hold, which matched 1,571 live
  fees on Oct 15 with about half real fees in a labelled sample of 155:
  `sentence_end` (a joining word at the end; "a", "an", "the" only in lower case so "N/A" never
  fires; never "above" or "each"), `trailing_range` ("up to" or "per", never "each"), `pronoun`
  ("will" or "you" only) and `plus` (a leading "+" with no fee noun after it). Step detail
  `live_fragment_check`: rows read, the counts and samples by action below, the cursor. `FRAGMENT_NAME_TAKEDOWN_LIVE` is on
  (James's yes, 2026-10-17, after the whole-table dry run: 619 matched, 8 down, 21 renamed, 572 kept
  live for a re-read, 18 exempt; with round 8 below, 7 down and 23 renamed). Switched off it only
  reports. On, a `takedown` fee is archived in the same step (`rolled_back_reason` `fragment name:
  <pattern>`, batch `darwin-live-fragment-<run>`, never deleted), its verified row is rejected
  with `darwin_live_fragment:<pattern>` so publish does not bring it back, the public read cache
  is cleared and a `darwin.live_fragment_name_taken_down` event lists the takedowns. A pure
  fragment is taken down rather than renamed because many carry the wrong amount (a minimum, a
  waived price, a $0 online copy). Whole-table dry run in one read: queue a verify run with
  `fragment_full_count: true` (step detail `live_fragment_full_count`), or hand someone with
  prod access `liveFragmentCountSql()` (the same rules as read-only SQL, counted by action and
  pattern; it skips the category guard on a rename, so the step's ledger is the exact count).
  Switch-on prerequisites (#1443, `LIVE_FRAGMENT_STRATEGY` v1; the Oct 15 dry run counted 629
  takedowns, and a hand sample of 100 `pronoun` rows found about 77 fragments, 15 real fees with
  a sentence glued on and 8 real names). Each match takes one action (`liveFragmentVerdict`):
  - `exempt` / `parenthetical`: a pronoun only inside a parenthetical ("Stop Payment (per item,
    if you request it)") is no fragment; `liveFragmentName` returns null, `liveFragmentShape`
    keeps the raw shape for the count. Public pages follow: `isCutFeeName` (`fee-display-name.ts`)
    uses `liveFragmentName`, so such a fee shows its stored name, not the category's.
  - `rename`: a `pronoun` or `sentence_end` name that opens with a real fee name followed by a
    glued sentence ("Overdraft Fee You will be charged when ..." becomes "Overdraft Fee", Knox's
    `gluedSentenceHead`), when the amount is above $0, the name has no waiver or discount wording
    (`LIVE_FRAGMENT_WAIVE_WORDING`) and the category guard still accepts the cleaned name. The
    head is 2 to 8 words, capital or digit first, ends on a fee word, never opens on an article,
    quantifier or ordinal ("A Fee", "Each Item", "2nd Item"), holds no "you", "your", "we" or
    "our" ("Checks Your order") and is not fee nouns alone ("Fee Per Item"). With the switch on it
    goes through Knox's live rename path (`writeLiveRenames`: a `pipeline_feedback`
    `name_retidied` row with the old and new name, `check_name` `darwin.live_fragment_check`, then
    the update guarded on the old name); a `darwin.live_fragment_name_renamed` event lists them.
    Knox's own restore pass reads only its own renames, so it never puts the sentence back.
  - `takedown` / `rename_duplicate`: a rename onto a name another live fee of the bank (not
    rolled back or quarantined) already has at the same price and category, compared with inner
    whitespace collapsed and case-free, or onto a name an earlier fee (by id) of the same read is
    renamed to, comes down instead (`rolled_back_reason` `fragment name: <pattern>
    (rename_duplicate)`): that fee is already live. Decided in `findLiveFragments`, so the shadow
    report, the dry run, the whole-table count and the SQL count it the same way; if the read of
    the bank's other live names fails, the step renames nothing (`duplicate_check_failed`).
  - `trailing_range` comes down only when the name has waiver or discount wording or the amount
    is $0; otherwise it is `exempt` / `trailing_range_priced` (reported only).
  - Everything else is a `takedown` / `fragment`, except (v5) a priced `sentence_end` line with no
    rename and no waiver wording, which is a `reread`: kept live, re-read request only (see v5 below).
  Step detail: `would_take_down`, `would_rename`, `exempt`, `exempt_by_reason`,
  `takedown_by_reason`, `by_pattern`, `by_action` (pattern counts per action),
  `samples_by_action` (up to 20 of each, with `rename_to`, `exempt_reason` or `takedown_reason`)
  and `samples_rename_duplicate`.
  v2 (#1499, `LIVE_FRAGMENT_STRATEGY` v2, after a prod hand-check of v1 found generic and clause
  heads renamed and most of the 431 `sentence_end` takedowns real fees; still in shadow):
  - Generic heads are no name: an account, a period, "additional", "other" or "misc" and fee
    words alone ("Account Fees", "Monthly Fee", "Quarterly fee", "Additional fees"); "Monthly
    Service Fee" and "Monthly maintenance fee" still are. A list of services that does not end on
    "fee", "charge" or "penalty" is a heading ("ATM & Visa Debit Card").
  - Clause heads are no name: opening with "Customers", "No matter", "To request" or "All", or
    holding "who", "sending" or "receiving" ("Bank sending the wire", another bank's charge).
  - A footnote number glued to a capitalised word is dropped before the head is read
    ("10NON-MEMBER LOAN APPLICATION FEE"; "6A monthly fee" then opens on an article and has no
    head), never an ordinal or a time ("1ST", "24HR"); so is a leading "To request " before a
    capitalised name, which must then pass every bar.
  - A name that speaks of a minimum or opening deposit is never renamed
    (`LIVE_FRAGMENT_OPENING_DEPOSIT`: its price is the deposit).
  - The split is wider for `sentence_end` names: the last fee word may carry a parenthetical
    before a cell or sentence break ("Returned/Non-Sufficient Funds (NSF) fee (per item). This fee
    applies to"); the sentence may open with the price's lead-in ("A fee of", "The fee", "the
    charge") or a named subject and a modal verb ("... Non-BankFive ATM BankFive may impose a";
    "ATM" now ends a name); and a name ending on "fee" or "charge" splits at a lower-case "if" or
    "when" whose condition names no person ("Monthly maintenance fee if the average daily balance
    falls below"; "Wire Fee if you request" still has no head). Waiver and discount lines still
    come down.
  - Re-read request: with the switch on, each `takedown` / `fragment` / `sentence_end` fee also
    gets a `pipeline_feedback` row of kind `knox_reread_requested` (`LIVE_FRAGMENT_REREAD_KIND`;
    signal `wrong`, about stage `extract`, reported by `darwin`, check `darwin.live_fragment_check`,
    dedupe key `darwin.live_fragment_check:reread:pub:<id>`, with the raw row and document from the
    fee's verified row and evidence `request: reread_source_line`), so the real fee can come back
    under a proper name. Knox reads this kind in its extract step (`knox/reread-feedback.ts`,
    #1511, `KNOX_REREAD_FEEDBACK_LIVE`, on; see Knox's AGENTS.md).
    Step detail `would_request_reread` (also in shadow) and `reread_requested` (written); a failed
    request never undoes the takedown. `liveFragmentCountSql()` applies the same strip, bars and
    deposit wording; its `takedown` / `fragment` / `sentence_end` row is the re-read count. (v5:
    priced lines with no waiver wording are no longer taken down; they are `reread`, and the count
    SQL's `reread` row is the re-read count.)
  v3 (#1499, `LIVE_FRAGMENT_STRATEGY` v3, after a prod hand-check of v2: 40 of 43 renames right,
  17 of 20 sampled `sentence_end` takedowns real fees; still in shadow):
  - Threshold gate: a head split from an "if" or "when" condition (either case) is renamed only when
    the condition is a balance condition (it names a balance and ends on below, under or less than)
    and the amount is under $100 (`LIVE_FRAGMENT_BALANCE_CONDITION`, `LIVE_FRAGMENT_CONDITION_MAX`):
    13 of 14 "X fee if the balance falls below" rows on prod were the fee. Any other condition
    ("when overdrawn by more than" $5, "if more than" 6, "if inactive for more than" 12) is a
    threshold: no rename, so the fee comes down and asks Knox to re-read.
  - Another price in the name means no rename (`liveFragmentOtherPrice`): two "$N ... fee" phrases,
    one whose figure is not the fee's amount, or any other dollar figure in a line that is not
    about a balance ("a $35 Overdraft Fee ... or a $15 NSF Fee" $15, 133792; "A $20 NSF fee ...
    $45 in NSF fees" $45, 55708). "below $500 ... a minimum balance fee of" $6 still renames.
  - "(cont.)" / "(continued)" is dropped before the head is read ("Inactive Accounts Fee (cont.)").
    A single digit on exactly two capitals and a space is a name ("2FA Token Fee"), not a footnote.
  - Tail name (`rename` / `tail`): a `sentence_end` line with no head is renamed to the fee its
    sentence ends on, with Knox's fee-of-sentence phrase (`feeOfSentenceTail`, the same regex
    builder as Knox's `FEE_OF_SENTENCE`; "minimum" bars it only right before the fee word): "There
    will be a card replacement fee of" $10 becomes "Card replacement fee", "... for a monthly paper
    statement fee of" $3 "Monthly paper statement fee". First letter capitalised as Knox's cut-off
    repair writes it, the rest as in the source. Every head bar applies ("a service charge fee of",
    "a monthly fee of" give no name), as do the amount, waiver, deposit and other-price gates and
    the category guard. A line whose head was refused by the threshold gate gets no tail.
  Step detail `would_rename_by_via` ({head, tail}) and `rename_via` on each sample; the count SQL
  reports tail renames as reason `rename_tail` under action `rename`.
  v4 (#1499 review and the prod hand-check of v3: 67 of 74 renames right, 31 of 32 head, 36 of 42
  tail; still in shadow):
  - Figure gate: a tail rename, and a head renamed through an "if"/"when" condition, is refused
    when any figure in the line (dollar or bare, commas ignored, 6 = 6.00) equals the amount: on a
    tail line the price follows the cut-off "of", so an equal figure means the amount was read
    from a threshold or a count ("below $500 ... a minimum balance fee of" $500, "more than $5"
    $5, "inactive for 12 months" $12, "exceed 6 withdrawals" $6). A plain head ("Overdraft Fee
    You will be charged $35 per item") keeps its price.
  - A dollar figure a threshold word leads into ("more than $5", "under $500") is not another
    price; "Wires are $15 incoming and an outgoing wire fee of" is (no rename at any amount). Only
    comparison words count: "up to", "at least" and "a minimum of" state a price on a fee line.
    A tail that opens on a parenthetical ("(OD) fee") is refused.
  - Total wording ("may therefore incur", "incur $N in", "in ... fees for one", "a total of") is a
    sum: no rename (55708).
  - A balance condition that also counts an excess ("if more than 6 per month, balance below") is a
    threshold. A dormancy tier after a cell break ("| If more than 3 years dormant", "| If
    inactive ...") is the fee's own condition: the head renames when it ends on "fee" or "charge"
    (44880 "Inactive Accounts Fee (cont.) | If more than 3 years dormant" $15).
  - A lower-case line is read capitalised for its head only when a lower-case "if"/"when" follows
    the head ("monthly service fee if balance falls below" becomes "Monthly service fee"), under the
    same balance gate.
  - Tails: "Bank's", "appropriate", "normal", "applicable", "small", "low" (and the other usual
    qualifiers) are dropped from the front ("Returned item fee", "Overdraft item charge",
    "Activation fee"); a tail of only handling / flat / small / low / late / monthly / service /
    additional and fee words is refused ("Handling fee", "Late charge"), as is one holding "our" or
    "your" ("Allpoint network our ATM fee"); a tail word may hold "/" or be a parenthetical
    ("Return Item/Insufficient Funds Fee", "Consecutive days overdrawn (OD) fee").
  v5 (#1499, after a prod hand-check of v4: 101 of 105 renames right, 2 too generic, 2 wrong, 5
  missed, and a prod check of v5: 125 of 127 checkable renames right, but 20 of 22 sampled
  `sentence_end` takedowns real, correctly priced fees; still in shadow):
  - Re-read, not takedown: a `sentence_end` line that gets no rename falls into one of three groups
    (`liveFragmentVerdictDetail`; count SQL reason in brackets):
    - `reread` (`reread`): amount above $0, no waiver wording, and no gate refused the amount. The
      fee stays live and, with the switch on, the step only writes the `knox_reread_requested` row
      (evidence reason "kept live: sentence_end with no name", `kept_live: true`) so Knox can rename
      it later (#1511, Knox's `consumeRereadRequests`). Example: "Paper statement fee for the" $2.
    - `takedown` with a re-read request (`fragment_reread`): a gate refused the rename because the
      amount is not the fee's price: total wording, an opening deposit, another price in the line
      (`other_figure`, two priced phrases), a figure equal to the amount, or a refused "if"/"when"
      threshold (balance below at $100 or more, "more than", "inactive for", excess wording). The
      fee comes down and its `knox_reread_requested` row keeps the takedown reason ("fragment name:
      sentence_end"), as in v4.
    - `takedown` with no request (`fragment`): $0, no amount, or waiver wording (the
      `LIVE_FRAGMENT_WAIVE_WORDING` pattern): a waived price (5314's "... reduce your monthly fee
      to" $0, #1436).
    `pronoun` and `trailing_range` fragments and `rename_duplicate` still come down with no
    request. Step detail `would_reread` and `samples_by_action.reread`; `would_request_reread`
    counts both kinds of request.
  - A capitalised "THERE" opens the glued sentence like "There" ("10NON-MEMBER LOAN APPLICATION FEE
    THERE IS A $10.00 NON-MEMBER APPLICATION FEE ..." $10, 109893, renames to "NON-MEMBER LOAN
    APPLICATION FEE").
  - "may therefore" anywhere is total wording: a stored name cut just after it ("... you may
    therefore", 55708) is a sum, never renamed.
  - Generic: a period and a fee word alone ("Per quarter charge", 64144; "Per month fee", "Per year
    fee") and a bare "Activation fee" (98668, a gift card's) are no name, as head or tail. "Card
    Activation Fee" still is.
  - "only if" / "only when" after the head reaches the balance gate (132041), and "your" is allowed
    in a balance-below condition ("... fee if your daily balance falls below", 142684); "you",
    "we", "our", and "your" in any other condition still give no head.
  - A generic head ("Monthly Fee", "Service charge") renames only on a balance-below condition that
    passes the balance gate (under $100, no excess, no figure equal to the amount): 142422, 110391,
    110392 were real fees correctly priced. Any other generic head is refused as before, and its
    line may still take a tail name (`gluedSentenceSplit(name, { allowGeneric: true })` returns it
    flagged `generic`; every other caller still gets null). Generic names such as "Per quarter
    charge", "Monthly fee" and "Annual fee" are still allowed as a head when the rest of the line is
    a gated balance-below clause.
  - Figure gate: read on the name after its glued footnote ("10NON-MEMBER LOAN APPLICATION FEE" $10,
    109893), and a bare whole figure followed by a count noun (debits, withdrawals, transactions,
    transfers, checks, items, times) is a count, not the price ("more than 6 debits per month ...
    excessive transaction fee of" $6, 137819), on an amount under $100 only ("more than 1,000 items"
    $1,000 still blocks). A span of time ("After 5 days" $5, 97910; "3 years
    dormant" $3) still blocks.
  - Known miss: 125163 "Monthly service charge when balance falls below" $2, whose source line also
    states "$5 monthly service charge" and "$2 paper statement fee". The stored name lost both
    figures and neither the live row nor its verified row carries the source line (the raw row's
    `conditions` / `extraction_note` would take a new join), so the second price cannot be seen;
    the fixture asserts the rename as it is.
  - Known and accepted: 125166, whose source line is "$3.00 per monthly fee if balance falls below
    $150, $9 per item charge after 3 withdrawals", is renamed "Per monthly fee" at $9: the stored
    name lost the figures, so the generic head passes the balance gate (with the figures in the name
    the second price refuses it; both are fixtures). 64144 "Per quarter charge" renamed through the
    generic balance-below route, and 110391's generic tail "monthly service charge" refused, are
    accepted as they are.
  `liveFragmentCountSql()` mirrors each rule (`head_generic`, `generic_ok`, the figure gate on
  `readable`); JS-vs-SQL parity holds on every switch-on fixture.
  v6 (#1499, after a prod check of v5: 130 rename, 276 reread, 210 takedown, 17 exempt, with real
  fees still coming down; still in shadow). A `pronoun` or `sentence_end` line is taken down only
  when:
  - the amount is $0, missing or negative (`fragment`, no re-read request);
  - the line says the amount is a credit or discount (`LIVE_FRAGMENT_CREDIT`: "$2.50 credit",
    "reduced by $2", "discount of $2", a standalone negative as in "−$2" or "(-$2)", 87742)
    (`fragment`) when the credit's figure is the amount (`liveFragmentCredit`: "..., $2 credit with
    e-statements" at $10 is the fee). "$10 credit card", "credit union", "credit line", "credit
    limit", "credit report", "credit check", "credit inquiry" and "credit bureau" are no credit;
    a hyphen after a name is a separator ("Wire Fee -$25") and one at the start a bullet ("-$5.00
    per statement"). A credit or discount figure is no other price either;
  - the line is no fee of this bank (`LIVE_FRAGMENT_NOT_A_FEE`: a worked example, "for example,
    if", "Example:", "Because the transact..." at the start or after a sentence break, 95216; "Bank
    sending the wire" / "sending bank" at the start of the line, 142713) (`fragment`). A bare "for
    example", "typically charge", "charged because the transaction exceeds" and a later "; the
    sending bank sets its own fee" are left alone;
  - a gate refused the amount (`fragment_reread`, with a re-read request): total wording, an
    opening deposit, cap words (`LIVE_FRAGMENT_CAP_WORDING`: max, maximum or cap before "of $",
    "of" ending the line, a dollar figure or a charge/fee word; capped, greater of, lesser of,
    minimum charge, min or; so "MAX CHECKING MONTHLY FEE" and "maximum of 3 per day" are no cap;
    `liveFragmentCapRefused`: never when the line states a dollar price equal to the amount outside
    the cap's own figure, "Research Fee $25 per hour, minimum charge one hour" at $25), another
    price, a figure equal to the amount, a refused if/when threshold, or a line ending on a
    threshold (`liveFragmentThresholdEnd`, head or no head: "balance of" / "balance is", 133104;
    "more than", "greater than", "over", "above", "at least", "exceed(s/ing)", "in excess of",
    "inactive for"; "below", "under", "less than" at $100 or more).
  - Prod r9: a line that names a fee or charge at an amount under $100 (`liveFragmentSoft`) is
    most likely the fee, so a threshold reading of it (a threshold ending, a refused if/when or
    colon clause, a conditional glued sentence whose figure is the amount) keeps it live as a
    `reread` and never renames it, instead of refusing it: 35202 "Overdraft Fee for each item we
    pay that overdraws your account more than" $35, 144639's $5 service charge, 133104's $3 charge,
    "Excess Withdrawal Fee if more than" $6. At $100 or more the refusal stands. The one rename
    such a line can take is a proper head's balance-below condition, "... Below Minimum Balance of"
    included (136152 "Monthly Maintenance Fee if Account Falls Below Minimum Balance of" $4 renames
    to "Monthly Maintenance Fee"); a generic head never renames on "balance of" ("Service Charge
    if Balance Falls Below Minimum Balance of" $50 and "Monthly fee if account falls below the
    required minimum daily balance of" $8 are rereads).
  - Review 9: a head glued to a sentence with a condition (`LIVE_FRAGMENT_REST_CONDITION`: unless,
    after, exceed..., above, over, less than, greater/older than, at least, in excess of, keep, or
    a clause ending on below, under, by, within or before) is no rename ("Monthly Maintenance Fee
    You will be charged unless your balance is at least" $1,500, "Dormant Account Fee You will be
    charged after 12 months" $12). The colon gate also bars a clause ending on greater than, at
    least, above, exceed..., in excess of, by, within, after or before ("Overdraft Fee: If
    overdrawn by" $5, "Early Closing Fee: When you close the account within" $25); a duration
    ("more than 10 business days", 146643) is no money excess, so 146643 renames again. "lower",
    "lowered" and "half" bar a rename like waiver wording (`LIVE_FRAGMENT_REDUCED_WORDING`). A
    generic head whose if-clause was refused never takes its tail ("Service Charge if balance
    falls below the minimum; a monthly maintenance charge of" $500).
  - When the line states two or more dollar prices (thresholds left out), the first is not the
    amount and a later one is, the amount is another price on the line: no rename, `reread`
    (`liveFragmentPriceElsewhere`; 125163 "$5 monthly service charge ... $2 paper statement fee"
    at $2, 125166 "$3.00 per monthly fee ... $9 per item charge" at $9). Their live names lost the
    figures and open in lower case ("monthly service charge when balance falls below" $2, "per
    monthly fee if balance falls below" $9): on a line opening in lower case, a head of period and
    service words only (`LIVE_FRAGMENT_CUT_GENERIC_HEAD`: "monthly service charge", "per monthly
    fee") is no rename, and a head opening on "per" never renames (64144 "Per quarter charge").
    Other lower-case heads ("monthly maintenance fee only when the balance falls below") still
    rename, as in v4.
  - `rename_duplicate` reads each fee's source document (raw tier, through its verified row). A
    rename onto a name the bank already has live comes down only when that twin was read from the
    same document; a rename onto the name an earlier fragment takes comes down only when both come
    from the same document and the same line (the same stored fragment name, the only line signal
    the live tier carries). Any other collision, or an unknown document, is kept live as a
    `reread`: on prod 4 of 24 duplicates took down another account's fee (a checking page against
    a savings page), and same-fee twins on different documents (60484, 69054, 92417, 142086,
    142613) are now rereads.
  - A dollar figure with a period after it ("$3 per quarter", "$5 monthly") is the fee's own price,
    so the figure gate lets it through (133104). A priced fee never reads across "if", "when",
    "unless", "not" or "or" ("$2,500 if not fee will be charged monthly" is a balance, 37674:
    `reread`).
  - "reduced to" is waiver wording: no rename ("Debit Card overdraft fee will be reduced to
    $5.00", 93834, is a `reread`).
  Every other unnamed `pronoun` or `sentence_end` line is `reread`: kept live with a re-read request
  (evidence reason "kept live: <pattern> with no name"). `plus` and `trailing_range` are unchanged.
  - Waiver wording alone no longer takes a priced fee down ("to avoid monthly service fee of" $15,
    60783; "... discounted fee of" $15, 74073), and it still bars every rename, head or tail: a
    waived or reduced line is kept live as a `reread` ("Overdraft Fee You will be charged a reduced
    fee of" $15; "Club fee", 95229, and "Discounted monthly maintenance fee", 137778, are rereads,
    not renames). "Discounted" joins the generic tail words. 5314's "... reduce your monthly fee
    to" at $0 still comes down.
  - "if Account Falls Below" and "... Below Minimum Balance (of)" are balance conditions (96650,
    96651, 96652, 136152).
  - A head ending on fee or charge before ":" or a dash, then an if/when clause, renames when no
    figure equals the amount and the balance gate's bars hold: no excess or balance condition, no
    clause ending on below, under, less than, more than, over or for, and an amount under $100
    ("Closing Fee", 142676; "Inactivity Fee", 146563; "NON-MEMBER LOAN APPLICATION FEE", 109893).
    "Overdraft Fee: If overdrawn by more than" $5 is a reread and "Monthly Service Fee: If balance
    falls below" $500 is refused.
  - A balance band ("more than or equal to but less than", 129443) is not refused: `reread`.
  - A dollar figure a threshold word leads into is no priced fee either ("overdrawn more than $5.00
    Fees for" $30, 70303).
  - In this check only (`liveFragmentCheckShape`, `LIVE_FRAGMENT_CAPS_ARTICLE`), an all-capitals
    line ending on a verb or function word (IS, OF, FOR, TO, WITH, BE, BY, CHARGED, CHARGES,
    ASSESS, ASSESSED, INCUR) and " A", " AN" or " THE" is a `sentence_end` ("... THERE IS A",
    109893). Knox's `liveFragmentName`, which `fee-display-name.ts` reads for the public fee name,
    is unchanged from main, so "WIRE FEE FOR THE", "SERVICE CHARGE A" or "BILL PAY A" display as
    stored. An all-capitals label ending on a letter ("SAFE DEPOSIT BOX SIZE A") and "N/A" are no
    fragment here either.
  - 125166 and 125163 are no longer renamed (see above); the same words with a capital first
    letter would still rename, since nothing in the name shows the lost price.
  - Round 4 (review rev10, prod r10): conservative by default, so a gap fails safe to `reread`.
    Where this list and the bullets above differ, this list wins.
    - Takedown (`fragment`) only at $0 or no amount, on `plus`, when a credit or discount figure
      equals the amount (`LIVE_FRAGMENT_CREDIT`; "credit/debit", "credit or debit", "credit and
      debit", "credit builder", "credit score", "credit life" and "credit insurance" are no
      credit), or when the line opens on a worked example or another bank's charge at its start
      or a sentence start with no fee or charge word before it (`liveFragmentNotAFee`: "Overdraft
      Fee $35 per item you will be charged. Example: if you" $35 stays live). A gate refusal
      (deposit, total, cap, other price, threshold, refused if/when clause, tail figure) goes
      through one soft check (`liveFragmentSoft`, the amount under $100): under $100 it is always a
      `reread`, fee word or not (106716 "Cashier's Check (to third party) greater than" $10, the
      source reads "greater than $500 $10.00 per check"); at $100 or more it is `fragment_reread`.
      A same-document duplicate is `rename_duplicate`, as before.
    - A head renames only when the rest of the line carries none of `LIVE_FRAGMENT_RENAME_BAR`:
      if, when, unless, without, except, after, before, until, once, you, your, we, our,
      additional, subsequent, increase..., sustained, continuous, consecutive, smaller, lower...,
      half, reduc..., de minimis, tier..., senior(s), student(s), age(d), older, younger, under,
      over (only before a figure or a number word: "over the phone" is no condition, 85002),
      below, above, more, less, least, fewer, exceed..., beyond, max(imum), min(imum), cap(s/ped),
      up to, per day, daily, "-er than", in excess, keep(s), within, (non-)member(s),
      customer(s), and no digit or "$". The only exceptions, each under $100 with no figure equal
      to the amount and a head ending on fee or charge: the balance-below form as the whole rest
      (`LIVE_FRAGMENT_BALANCE_FORM`: "if the (average daily) balance falls below", "if Account
      Falls Below (Minimum Balance of)", 96650-96652, 136152; a generic head never on "balance
      of"), the dormancy tier after a cell break (`LIVE_FRAGMENT_TIER_CONDITION`, 44880), and a
      duration (`LIVE_FRAGMENT_DURATION_FORM`) when the head itself names the duration fee
      (`LIVE_FRAGMENT_DURATION_HEAD`: 146643 "Continuous Overdraft Charge", 146563 "Inactivity
      Fee"). The colon gate is gone: "Closing Fee: When the account is closed the" $25 (142676),
      "Incoming wire fee you will be charged; the sending bank sets its own fee" $15 and every
      "... You will be charged ..." head are now rereads, as are the NON-MEMBER LOAN APPLICATION
      FEE lines of 109893 that state "$10.00" or "IF YOU".
    - A rename target (head or tail) never carries a digit or "$", holds a fee noun or a known fee
      product noun (`LIVE_FRAGMENT_FEE_NOUN`), and never opens on a sentence opener (also, the,
      however, please, if, when, this, that, these, a, an), at its start or after a dash
      (`LIVE_FRAGMENT_SENTENCE_OPENER`; 64675 renamed to "Also, the order" $32.98 is now a reread).
    - A tail rename (`rename_tail`) needs the whole line to pass the same bar: no condition,
      person, segment or reduced word anywhere, and no figure ("you will be charged an overdraft
      fee of" $35 and "Accounts inactive for 12 months will be charged a dormant account fee of"
      $10 are rereads).
    - A cap's own dollar figure (`LIVE_FRAGMENT_CAP_DOLLAR`) is no other price (B1): "Overdraft Fee
      $30 per item, maximum of $150 per day, you will be charged" $30 is no longer refused (it is a
      `reread`, the rest barring the rename).
  - Round 5 (review rev11): both rename sides are allowlists. Where this list and the bullets
    above differ, this list wins.
    - A head renames only on one of the three narrow forms (balance below, now only under $25 with
      `LIVE_FRAGMENT_BALANCE_MAX`; the dormancy tier; a duration the head names) or when the rest,
      after an optional separator, is one bare charge sentence and nothing else
      (`LIVE_FRAGMENT_CHARGE_SENTENCE`: "you will be / you'll be / will be / is / are" charged,
      assessed or imposed, optionally "a", "an", "the", "per item", "per check", "per request",
      "each", "for each item/check/request/transfer/occurrence" or "per occurrence"; "this fee
      is / will be charged / assessed", optionally "per item" or "for each item"; a bare "you
      will"). "This fee is not charged on overdrafts of", "There is no fee for", "The fee for
      business accounts is", "NSF FEE. THERE IS A" and "A fee of" are rereads.
      `LIVE_FRAGMENT_RENAME_BAR` no longer reads a head's rest.
    - A tail renames only when the line opens on a bare charge clause (`LIVE_FRAGMENT_TAIL_LEAD`:
      "you will be / will be / are / is / accounts are" charged or assessed "a" / "an") and what
      follows passes `LIVE_FRAGMENT_RENAME_BAR`. Any subject before the clause ("Business accounts
      are charged", "Each returned item is charged", "There will be a") is a reread.
    - "No fee of this bank" (`liveFragmentNotAFee`) takes a fee down only when the marker opens the
      line itself; anywhere else the line is a reread ("Incoming Domestic Wire. The sending bank
      may charge you" $15).
    - Credits are an allowlist (`LIVE_FRAGMENT_CREDIT`): "credit of $N", "$N credit to / on /
      applied to your account / statement", "(-$N)" or "(−$N)" alone in parentheses, "reduced by
      $N", "discount of $N", each with N equal to the amount. "$25 credit batch", "−$2 discount"
      and "(-$2 with e-statements)" are rereads.
    - A "$" figure counts for the figure gate only when a threshold word leads into it, and the
      other-price gate never refuses when the line's first dollar figure is the amount ("Legal
      Process / Levy $100.00 per occurrence assessed to" $100 and "Safe Deposit Box Rental 10x10
      $150; Late Fee $10 if you" $150 are rereads).
    - A waived trailing range at a positive amount is a reread (Darwin's verdict only; Knox's
      `liveFragmentName` and the public display are unchanged). $0 still comes down.
  - Round 6 (review rev12), Darwin only (Knox's `liveFragmentName` and the display are unchanged):
    - A tail lead must carry its own subject (`LIVE_FRAGMENT_TAIL_LEAD`: "you will be", "you'll
      be", "accounts are"); a bare "are charged a" or "will be charged a" is a reread. A tail
      phrase with small, low, minimal, nominal, lesser, partial, reduced or discounted
      (`LIVE_FRAGMENT_TAIL_REDUCED`, read before Knox's qualifiers are stripped) is a reread.
    - A refused if/when clause is a takedown at $100 or more only when it holds a balance or
      threshold word (`LIVE_FRAGMENT_IF_THRESHOLD_WORD`) or a figure is the amount; otherwise it is
      a reread ("Safe Deposit Box Drilling Fee If keys are lost, you will be charged" $150,
      "Closing Fee - If closed early the" $150).
    - A bare figure with cents ("100.00 per occurrence") reads like the "$" form in the figure
      gate: it counts only when a threshold word leads into it (`LIVE_FRAGMENT_THRESHOLD_FIGURE`).
    - Floors (`LIVE_FRAGMENT_FLOOR_WORDING`: greater of, minimum charge, min or, whichever is
      greater, "$100 minimum") are rereads, never a takedown or a rename; caps stay hard.
    - A credit takes a line down only when no dollar figure outside the credit phrase is the
      amount, and a bare "(-$N)" counts only on a line with credit, discount, rebate or refund.
    - "Sending bank" / "bank sending" at the start of the line comes down only with no fee or
      charge word on the line (`LIVE_FRAGMENT_OTHER_BANK`).
    - The count SQL turns U+00A0, U+2007 and U+202F into spaces before collapsing whitespace, as
      the JS does.
  - Round 7 (#1521, review of bf43365e; still v6 and in shadow). Each change only moves a takedown
    or a rename to a `reread`; none adds one (checked on every switch-on fixture and the rev9-rev13
    probes):
    - An if/when comparative (below, under, less, more, over, above, exceed..., least, greater)
      counts as a threshold only when a "$" figure, a figure with cents or "balance" follows it
      (`LIVE_FRAGMENT_IF_THRESHOLD_WORD`; "minimum" and "maximum" still count alone). A count, a
      duration or legal wording is a reread at $100 too: "Legal Process Fee If we are served under
      a court order, you will be charged" $100, "Garnishment Fee If more than one order is
      received", "Account Research Fee If research exceeds one hour, the", "Inactivity Fee If the
      account is inactive for more than 12 months, the". A bare "balance" no longer counts.
    - The credit guard reads a bare figure with cents as the fee's own price, like "$"
      (`LIVE_FRAGMENT_OWN_PRICE`: "Paper Statement Fee 3.00 per month; you will receive a credit of
      $3.00 if you" $3 is a reread).
    - `LIVE_FRAGMENT_CREDIT_WORD` is a whole word and never a product or institution noun: a
      "(-$N)" line with "credit union", "Credit Card", "credit line", "Discount Brokerage" or
      "Refund Check" is a reread.
    - A credit line with no price of its own after a fee head and a cell or clause break
      (`liveFragmentCreditHeaded`: "Paper Statement Fee | credit of $3.00 if you", "Paper Statement
      Fee; e-statement credit of $2 if you") is a reread. With no head ("Credit of $5 for
      e-statements") or a head with another price ("Overdraft Fee $35; credit of $5") it still comes
      down.
    - A tail rename needs a line that does not open in lower case (`LIVE_FRAGMENT_CUT_START`, as for
      heads): "accounts are charged an overdraft fee of" and "you will be charged an overdraft fee
      of" were cut at their start and are rereads.
    - The count SQL and the duplicate-name read (`liveNamesFor`) turn U+00A0, U+2007, U+202F and
      U+FEFF into spaces (`LIVE_FRAGMENT_SQL_SPACES`) before collapsing whitespace.
    - Left as they are, pending James: a floor on the same line still holds a cap ("Overdraft Fee
      $35, maximum of $100 per day; $5 minimum" $100) or an opening deposit as a reread, and "$N
      minimum" still reads "$500 minimum balance" as a floor. Closing either the issue's way adds
      takedowns.
  - Round 8 (139153; still v6). A `pronoun` name whose only pronoun is a closing "account you
    have at <bank>" clause (`LIVE_FRAGMENT_OWN_ACCOUNT`: account, loan, card or line of credit,
    an optional "that"/"which", you have/hold/own/maintain, at or with, then "us" or up to four
    capitalised words and an optional footnote digit, ending the line) renames to its head at any
    amount, $0 included (`liveFragmentOwnAccountHead`). The head must name a fee, carry no price,
    waiver or reduced wording, open on no sentence opener, be no fragment, and keep the category
    guard's verdict. "Overdraft Protection Automatic Transfer from Another Deposit Account you have
    at MSCU1" $0 is printed "| Free" on the schedule, a real $0 price (rule 3): it renames to the
    head and stays live. On prod (2026-10-17) the clause matches 2 live fees: 139153 (a takedown
    before) and 93520 "Overdraft Protection transfer to another deposit account you have at Cross
    Bank" $10. The count SQL mirrors the rule (`own_account_head`).
- Live hourly re-check (`hourly-frequency-check.ts`, #1456). About 802 live fees say in their name
  that they are priced by the hour ("Research Fee $25/hour", "Subpoena Fee - Per Hour") but carried
  no frequency or a per-item one, so a report read the price as a flat charge. `hourly` shows as "per
  hour". Knox does not yet read hourly at extraction; that change rides the next Knox rules bump
  (`settledFrequency(..., { hourly: true })`), and until then this pass catches new fees once
  they are live. Darwin's own verify keeps a stated `hourly` but does not
  derive one, and Hamilton's frequency fill never writes or clears it. Every verify/classify step
  reads the next `HOURLY_CHECK_BATCH` (2,000) live flat fees after a cursor on the run ledger (the
  `darwin.hourly_frequency_check` event's `next_after_id`, 0 at the end of a pass); an
  institution-scoped run leaves the cursor alone. `hourlyVerdict`, on the live catalog name: `set`
  when the name prices by the hour (`HOURLY_WORDING`: "per hour", "/hr", "hourly", "(hour)", "$25 an
  hour") and the frequency is blank or per-item; `exempt` (reported only) for `partial_hour` ("per
  15 min", "per half hour"), `category` (`HOURLY_EXEMPT_KEYS`: monthly maintenance, minimum balance,
  dormant, continuous OD, paper statement, NSF, overdraft, returned item), `period_word` (the name
  also says monthly, annual, daily...) and `stated_period`. "24 hour", "within 48 hours", "after
  hours" and "1 hour photo" never match. `HOURLY_FREQUENCY_LIVE` is on (James's yes 2026-10-16
  03:37 UTC, on a whole-table count of 830 to set: 825 with no frequency, 4 `per_item`, 1
  `per_occurrence`; 17 exempt). Off, the pass only reports (step detail `hourly_frequency_check`:
  `would_set`, `would_set_by_frequency`, `exempt_by_reason`, samples). On, the live row and its
  verified row take `hourly` guarded on the old value, each change is logged to `pipeline_feedback`
  (check `darwin.hourly_frequency_check`, evidence `from`/`to`, so it reverses), and a
  `darwin.hourly_frequency_set` event lists them. Whole-table dry run: a verify run with
  `hourly_full_count: true` (step detail `hourly_frequency_full_count`), or `hourlyCountSql()` /
  `hourlySamplesSql()` for someone with prod access.
  v2 (James's live-fee check, Oct 18: per-hour fees shown as flat charges at 7 of 15 institutions):
  a fee whose name is silent on the hour but whose own stored line prices it by the hour
  ("Account Research Fee $20 per hour") is read too, by `hourlyFromLine` on Knox's `excerpt="..."`,
  which must print the fee's price; the same exemptions apply and matches carry `basis` (`name` or
  `line`); a line-only fee is also exempt for a period word anywhere on its line. Line-only fees are written only with `HOURLY_LINE_LIVE` on (off until James sees the
  count); step detail `would_set_from_line` counts them, and the whole-table count reads any fee
  whose name or line mentions the hour. Prod read Oct 18: 1,894 live fees at 1,433 institutions
  print "$X per/an hour" on their line with a silent name and a non-hourly frequency (a regex
  estimate; the step's count is the exact one). `hourlyCountSql()` still mirrors the name rule only.
- Live non-deposit document re-check (`non-deposit-document-check.ts`, #1442). James's catalog
  review (Oct 15, URL heuristics) found live deposit-fee rows read from brokerage and wealth pages
  (33 rows: Northern Trust wealth, U.S. Bank self-directed investing "Research" $20) and from
  loan, card, HELOC, mortgage and rate pages (386 rows: Bank of Greene `/current-rates/`
  "Appraisal $400"); those are the issue's counts, not this rule's. The rule is the shared
  classifier `nonDepositDocumentKind` (`src/lib/non-deposit-document.ts`, also Magellan's companion
  filter), read on the address of the stored document each live fee came from (the
  document-owner join: `lineage_ref` -> verified -> raw `source_document_id` -> `source_documents`).
  It returns `brokerage` or `loan` only when a path segment names the page as one ("current-rates",
  "loan-rates", "credit-card-agreement", "heloc", "loan-servicing-fees", "wealth-management",
  "self-directed-investing", "trust-and-investment"; or a `wealth.`/`invest.` host); run-together
  words are split first ("scheduleoffees", "loanfeeschedule"). A deposit word anywhere
  ("checking", "savings", "deposit", "overdraft", "truth in savings", "IRA", "HSA") wins, a fee
  named after a loan ("/fees/loan-payment-fee") never matches, a generic fee schedule filed under a
  loan section ("/loans/fee-schedule.pdf") and a combined "rates & fee schedule" or "investments
  and fees" page are left alone, and a bare "cardholder agreement" (often the debit card's) needs
  "credit" to count. Only lending-category fees on a matched document come down
  (`LENDING_CATEGORIES` from `knox/held-recheck.ts`: late payment, loan origination, appraisal,
  vehicle title, other lending fee, cash advance); every other category is a deposit one and stays
  live (`kept_deposit_category`). The prod read-only check of the first version (Oct 15: 172 fees
  on 47 documents) found 12 documents, 65 fees, were rate pages holding a credit union's whole
  deposit schedule, an HSA page or a run-together schedule; real HELOC, card and brokerage pages
  also list stop payment, wire and NSF fees under deposit categories. Business and commercial documents are out of scope
  (kept on purpose; fee-stats drops them from medians) and always pass. Every verify/classify step
  reads the next `NON_DEPOSIT_BATCH` (2,000) live fees after a cursor on the run ledger (the
  `darwin.non_deposit_document` event's `next_after_id`, 0 at the end of a pass); an
  institution-scoped run leaves the cursor alone. `NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE` is on (James's
  yes 2026-10-16 03:37 UTC, on a whole-table count of 92 lending or card fees on 42 documents at 36
  institutions). Off, the pass only reports (step detail `non_deposit_document_check`: `would_take_down`, `by_kind`,
  `kept_deposit_category`, `documents`, `institutions`, samples of both with the document address). On,
  a match goes through the shared 12-hour second look
  (check `darwin.non_deposit_document`; fees that pass clear a pending flag) and is archived on its
  second failure (rolled back with `non_deposit_document: <kind> #<doc>`, batch
  `darwin-non-deposit-<run>`, the verified row rejected with the `non_deposit_document` flag, never
  deleted), and a `darwin.non_deposit_document_takedown` event lists them. Whole-table dry run: a
  verify run with `non_deposit_full_count: true` (step detail `non_deposit_document_full_count`),
  or `nonDepositCountSql()` / `nonDepositSamplesSql()` (the classifier in Postgres, checked equal to
  the JS one on the fixtures in `src/lib/non-deposit-document.fixtures.ts`) for someone with prod
  access.
  v2 (#1518, found by the v1 prod dry run): each fee on a matched document gets a verdict
  (`nonDepositVerdict`), each rule its own reason prefix and count (`by_rule`).
  `lending_category` is v1's rule, except that on a rate page (a loan document named only "current
  rates" or "rate sheet", with no loan product segment: `ratePageDocument`) a lending-category fee
  also needs lending wording in its name (`hasRatePageLendingWording`: the allowlist below plus,
  for this branch only, "application", "credit report" and "processing"), so Siouxland's
  `/current-rates` "Late Fee" $5 (late_payment, fee 114953, among the safe deposit box lines) stays
  live (`kept_generic_on_rate_page`) while Bank of Greene's "Application fee" and "Credit Report
  fee" and Independent Bank's "Standard processing fee" come down. `lending_wording_on_loan_document` takes down a deposit-category
  fee on a loan, HELOC, card or rate document whose name carries lending wording
  (`hasLendingWording`: a closed allowlist of mortgage, HELOC, home equity, cash advance, late
  payment, payoff, appraisal, closing cost, escrow, subordination, origination only after loan,
  mortgage or HELOC, and "loan" only as "loan late", "loan application", "loan processing", "loan
  modification", "loan extension" or "loan documentation"), unless the name also carries
  deposit-side wording (safe deposit, box, SDB, checking, savings, share, certificate, CD, club,
  coin, debit, ACH, wire, overdraft, transfer, phone, or a "mortgage/loan/HELOC/home equity
  payment" phrase, a payment-channel fee): "Mortgage processing and research
  fee" (account_research), "Late Payment — Return Check" (nsf), "Cash Advance ATM"
  (atm_non_network), a $250 subordination (legal_process). A bare "loan" ("Loan payment by phone",
  "transfer to pay a loan", "Loan coupon book") and a bare "late fee" are not lending wording, and
  such fees stay; so do "ACH origination", "share certificate early payoff", "SDB late payment",
  "debit card cash advance", "coin appraisal" and "Mortgage payment at teller". Same switch as v1. `brokerage_document` counts every deposit-category fee on a
  brokerage, wealth or investing document (U.S. Bank's brokerage pages: wire, "Research", returned
  check, stop payment, overnight check, IRA fees; the taxonomy has no brokerage category): those come
  down only when `BROKERAGE_DOCUMENT_TAKEDOWN_LIVE` is on as well (its own switch, James's call on a
  count: on since 2026-10-16, 7 live U.S. Bank brokerage-page fees on 4 documents); with it off they
  pass and clear any pending flag.
  Step detail adds `by_rule`, `brokerage_document`, `kept_generic_on_rate_page`,
  `brokerage_switch_live`, `samples_lending_wording` and `samples_brokerage_document`. Read-only
  SQL: `nonDepositCountSql()` (counts by kind and verdict), `nonDepositSamplesSql()` (by document)
  and `nonDepositFeeVerdictsSql()` (one row per fee with its verdict), checked equal to the JS on
  the fee fixtures in `darwin/non-deposit-document-check.fixtures.ts` crossed with the URL fixtures
  on a local Postgres 16 (UTF8). The `documents` and `judged` CTEs are `MATERIALIZED` (the
  reviewer's prod-size run went from over 5 minutes to about 1 second with the same output).
  v3 (#1908, James's live-fee check, Oct 18): the classifier's third kind, `card_program`, is a
  prepaid, payroll, gift, travel or TravelMoney card's own document, named by the address's last
  segment (`CARD_PROGRAM_LAST_SEGMENT`: SchoolsFirst's `payroll-card-statement-of-fees-disclosure`,
  Acadia's `/checking/cards/prepaid-travel-card/`, "Gift_Card_Terms_and_Conditions.pdf"). It is
  asked only where the v2 classifier said null: after the brokerage and loan tests (so
  `/credit-cards/travel-card/` stays a loan page) and in place of the deposit-word null, since such
  pages often sit under a checking section. A deposit word in the last segment itself
  ("prepaid-checking-account") still wins, business documents still pass, a general schedule that
  names the card only after its own fee words ("fee-schedule-including-gift-cards",
  `GENERAL_SCHEDULE_BEFORE_CARD`) stays, a bare "pay card" is not a card, and a loan's "prepaid
  finance charge" or a mortgage's "prepaid items" is not a card. `card_program_document` takes
  every fee on such a document except the card's purchase and reload price (`CARD_PROGRAM_KEEP_KEYS`:
  gift_card_purchase, prepaid_card_reload; `kept_card_purchase`). Its own sub-switch,
  `CARD_PROGRAM_TAKEDOWN_LIVE`, is on since 2026-10-18 (James, "Take them down", 11:34 UTC) on the
  count: on Oct 18 (prod, read-only) 44 live fees on 12 documents at 12 institutions, 4 purchase or
  reload fees kept; 35 at switch-on after SchoolsFirst's 9 hand takedowns. Step detail adds
  `card_program_document`, `card_program_documents`, `card_program_institutions`,
  `kept_card_purchase`, `card_program_switch_live` and `samples_card_program_document`. Magellan's
  companion filter skips these documents too. A card program's section inside one fee page (Navy
  Federal's "GO Prepaid Cards", #1905) has no address of its own and is not caught here.
- Spanish copies of an English schedule (`translated-copy-check.ts`, #1909, James's live-fee check
  Oct 18). M&T publishes its checking fee guide in English and Spanish, both were read, and "Cargo
  por sobregiro" $15 sat beside "Overdraft Fee" $15. A live fee comes down only when its document's
  address names a Spanish copy (`spanishCopyDocument`: "spanish", "español", a "/es/" path or an
  "-es."/"_ES-" token), its name reads as Spanish (`readsSpanish`: an accented letter or two Spanish
  words; East West's `/es/` page was stored with English names and stays), and the institution has a
  live fee in the same category at the same amount from a document that is not a Spanish copy (the
  English twin). A Spanish-only fee stays until its English line is live (M&T's non-network ATM and
  outgoing wires, Express CU and Travis CU, whose English schedules are not on file, Puerto Rico).
  Every verify step reads every live fee on a Spanish-copy document (no cursor).
  `TRANSLATED_COPY_TAKEDOWN_LIVE` is on (James, "Turn it on", 2026-10-18 11:28 UTC, on the count
  below); a match goes through the
  12-hour second look (check `darwin.translated_copy`) and is archived on its second failure (rolled
  back with `translated_copy: #<doc> twin #<fee>`, batch `darwin-translated-copy-<run>`, the verified
  row rejected with the `translated_copy` flag, never deleted; event `darwin.translated_copy_takedown`).
  Step detail `translated_copy_check`. Dry run Oct 18 (prod, read-only, `translatedCopyRowsSql`): 127
  live fees on 12 Spanish-copy documents at 11 institutions; 35 would come down (Sound 22, OnPoint 6,
  M&T 5, FirstBank PR 2) and 92 stay. v2 (review of v1): a fee with no dollar amount (a percent fee)
  never has a twin, and "fondos", "insuficientes" and "cobro" read as Spanish. A fee taken down for
  its twin is not read again if the twin later comes down under another check; restore it by hand.
- Canadian bank documents (`canadian-document-check.ts`, #2022, James's "Do all three", Oct 19).
  Natbank (2675), a Florida bank owned by National Bank of Canada, had 12 live fees read from the
  parent's Canadian chequing page and personal fee guide. Every institution here is U.S.-chartered,
  so a live fee's document is Canadian when its stored text names two of Interac, e-Transfer,
  chequing and CDIC/Canada Deposit Insurance as whole words and names neither FDIC nor NCUA (one
  alone is not enough: a border credit union may price Interac ATMs in Canada; the address is not
  used: Natbank's own U.S. pages are on nbc.ca too and name only "chequing"). It reads every live
  document's text (8,722; 1.3 to 3.9 s), so at most hourly; an institution-scoped run always reads
  and does not restart the clock. On (`CANADIAN_DOCUMENT_TAKEDOWN_LIVE`), a match goes through
  the 12-hour second look (`darwin.canadian_document`) and is archived with `canadian_document:
  #<doc>` (batch `darwin-canadian-document-<run>`, verified row rejected with the
  `canadian_document` flag; event `darwin.canadian_document_takedown`). Step detail
  `canadian_document_check`. Dry run Oct 19: 12 fees on docs 26833 and 26834, all Natbank; the same
  12 are #2022 hand takedowns, and Atlas points Natbank's registry at its U.S. accounts page.
- One printed line, two reads (`line-conflict-check.ts`, #1440). James's catalog review (Oct 15)
  found live fees sharing institution, name, amount and source address under two categories (1st
  Summit's "Prepaid Card" $5 as document reproduction and gift card purchase) or one category with
  two frequencies (Abound's safe deposit boxes, per item and annual). Hamilton's exact collapse and
  publish-time refusal partition by category and keep conflicting frequency classes apart, so
  neither reaches them. Every verify step reads every such line (one grouped read; an
  institution-scoped run reads that bank's) and keeps one reading (`lineConflictVerdict`): for two
  categories, the guard's re-file into another category of the line (`refile`), else the only
  category the guard does not refuse (`guard`), else the category the model gives at least 0.95
  while disputing the others (`model`; never on a line with loan origination, other lending fee
  or late payment on it, whose borders the taxonomy has not settled, and never on a name that opens
  as a clause, "No contents (e.g. check) included in the ATM"; a name saying "foreign" on a line
  filed as a non-network ATM fee and an international or foreign-transaction fee is undecided
  before any step); for two frequencies, the frequency
  the schedule line states for the price (`line`; not from a line with a rate on it, and a per-item
  reading never beats a period category's period). Kept apart, never retired: rows stating
  different audiences (`audiences`), a name joining two fees outside its notes that the guard
  accepts under each guarded category ("Money order/Cashier check fee"), a name with an NSF word and
  an overdraft word on an NSF/overdraft line, or a name whose parts are each the model's pick for a
  different category of the line ("Charge-Back Fee Check Printing Fee") (`joint_line`), and anything
  else (`undecided`). Each step reports (detail `line_conflict_check`: `by_kind`, `by_basis`,
  `by_exempt`, `would_retire`, samples with the model's scores). `LINE_CONFLICT_TAKEDOWN_LIVE` is
  true (switched on Oct 16, James 04:53 UTC: "Retire wrong copy"; `live: false` reports only): a
  retired row goes through the
  shared second look (`darwin.line_conflict`) and is archived on its second failure with `one line,
  two reads: kept #<id> (<kind>, <basis>: <reading>)` while the kept row is still live, its
  verified row rejected with `one_line_two_reads`, never deleted, and a
  `darwin.line_conflict_takedown` event lists them. `lineConflictCountSql()` counts the lines for
  someone with prod access. Dry run on Oct 16 (117 lines, 236 live rows): 30 rows retired (22 by
  the model, 8 by the line), 69 undecided, 18 joint lines; re-counted at switch-on (04:57 UTC,
  run 7161): 29 (22 by the model, 7 by the line), 70 undecided, 18 joint lines.
- Released-fee category re-check (`release-repair.ts`, the repair half of #1367; decision
  2026-10-15, "Darwin re-checks every live fee against today's rules"). Until PR #1468 the release
  check passed "." as the category pattern, so every fee the release published before then went live
  without its category being checked: on Oct 15, 2,566 verified rows carried `darwin_released_hold`
  and 1,680 were live (239 of them from the recorded-pass release's 387 that morning); a seeded
  sample of 20 found 2 in the wrong category, both `od_protection_transfer` holding an overdraft or
  courtesy-pay item fee. Every verify/classify step reads the next `RELEASE_REPAIR_BATCH` (250)
  released fees (`published_fee_records` joined to a verified row flagged `darwin_released_hold`;
  live ones, plus ones this pass archived) after a cursor on the run ledger (the
  `darwin.release_repair` event's `next_after_id`, 0 at the end of a pass). It runs
  `releaseCheckHold` on each, against the fee's own stored text and the category model
  (`loadReleaseCheckInputs`), with the live category and amount and the name Knox read from the
  schedule. The amount-range gate is skipped (the live fee already passed Hamilton's range, and the
  range must not hide a category failure). At release time either category failure only keeps a
  fee for a person, and each alone is wrong too often for a takedown (the text check fails real
  names with no heading nearby, such as "Service Fee" under "Basic Checking", "Bounced Check" or
  "Transfer from Savings"; the model disputes about 6% of right fees). So a fee is a takedown
  candidate only when both fail: `category_not_in_text` AND the model disputes the category,
  picking another with at least `RELEASE_REPAIR_SUGGEST_MIN` (0.5) of its probability (reason
  `category_not_in_text_and_disputed`). One failure alone is report only, counted and sampled apart:
  `text_only` (`category_not_in_text`) and `model_only` (`category_disputed`). Any other hold is
  `other`, report only. `no_source_text` and `no_category_model` are skipped and read again next
  pass (with no model the whole step is skipped and the cursor stays). Step detail
  `release_repair`: `checked`, `passed`, `would_take_down`, `deferred`, `report_only` (`text_only`,
  `model_only`, `other`), `by_reason`, `by_category`, `text_only_by_category`,
  `model_only_by_category`, up to 20 samples of each bucket (with the model's pick and its
  probability), the cursor. `DARWIN_RELEASE_REPAIR_LIVE` is on (James's OK, 2026-10-17; the last full
  loops found 0 takedown candidates among 1,639 live released fees, so it guards future releases): a candidate goes through the shared 12-hour second look (`secondLook`, check
  `darwin.release_repair`): flagged `takedown_pending` first, archived only when a run at least 12
  hours on fails it again (`rolled_back_reason` `release_repair:<reason>`, batch
  `darwin-release-repair-<run>`, never deleted), its verified row rejected with
  `darwin_release_repair:<reason>` appended last, in the same savepoint. Rejected rather than
  re-held: the held pile is raw rows with no verified row, and no code reads a verified row in
  another status (`challenged` is allowed and read by nothing), so a re-hold would strand the fee.
  A live fee that is not a candidate (a pass or any report-only bucket) clears its pending flag.
  Restore: an archived fee that no longer meets the takedown bar comes back in one statement (fee
  live and verified row verified with the flag removed, together), only when this pass's flag is
  still the verified row's last flag (no other rule flagged it since) and no equal fee is live at
  that bank; otherwise it stays down (`restore_blocked`). The restore writes the second look's
  `takedown_cleared` state row and `flag_cleared` audit row in the same savepoint. A
  `darwin.release_repair_acted` event lists what came down and what came back. The verify step
  calls it through `runReleaseRepairStep`, which catches any throw, so the repair never fails the
  step. No provider call: the category model is Darwin's own naive Bayes, trained in-process from
  `published_fee_catalog`. Whole dry run in one read-only pass: queue a verify run with
  `release_repair_full_count: true` (step detail `release_repair_full_count`, every bucket).
  `releaseRepairCandidateSql()` is the read-only SQL for someone with prod access: live released
  fees by category, the recorded-pass share, and names lacking the category's wording, a rough
  guide to the text half only (neither bound: the check reads the schedule line and rows above, not
  the name); the line read and the model do not run in SQL.
- The in-batch duplicate key (`batchKey` in `verify.ts`, `DARWIN_BATCH_KEY_VERSION` v4) is the
  institution, category, amount (or rate), frequency, stored document, the fee's own source line
  and its audience. Version 1 named the URL, so a fee on a bank's current copy of a page was held
  as a duplicate of the same fee on an older copy and never verified; version 2 (2026-10-07)
  named the stored document. Version 3 added the source line, so two products' fees with one
  price on one document (SCCU's money market and interest checking at $15/mo.) are two fees,
  while one line read twice is still one. Version 4 (2026-10-09) added the fee's audience
  (`fee_audience`, `unknown` when unset), so a consumer and a business fee are not duplicates of
  each other. A duplicate recorded under an older key version on a current copy with no verified
  twin on that same document is selected once more.
- Darwin decides each verified fee's audience (#1059; James, Oct 13). A label Knox read on the
  fee's own line stands. A fee Knox left `unknown` takes Knox's context suggestion
  (`knox/audience-context.ts`, via `darwin/audience.ts`), in this order: the fee's own name
  (`nameAudience`: a name that lists both sides is both; a product, an exception clause or a
  business day names no audience, #1626), the schedule's address,
  then the section heading above the fee's line, then its title, a schedule that prices nothing
  for businesses (consumer), or a schedule that also prices business items and does not limit
  the fee (both). In a schedule that also prices business items, a heading for all accounts
  gives both, and a heading naming one audience leaves the fee `unknown` unless it is a business
  heading under a business schedule title: on unseen schedules those headings agreed with a blind
  reading on 14 of 36 fees (#1059, Oct 14). A business heading never takes the consumer default.
  The climb for a heading stops at a heading-case line that names no audience and is a schedule
  title ("Common Fee Schedule") or starts with Other, Miscellaneous, General, Additional or Common
  ("OTHER SERVICES"), so a menu link, a perk list or a sign-off further up never claims the fee; a
  bullet ("• Basic Business Checking") is never a heading. A change notice's sign-off ("your
  continued business"), a "business" wrapped before "days" and "individual check" name no
  audience. A fee whose own price cell names its audience beside the other audience's price
  ("$2.00 personal" over "$5.00 business") takes it (`fee_price_cell`). A consumer heading in a
  mixed schedule still decides nothing: loosening it fails #1059 holdout 4, where the same fee at
  the same price sits under both a consumer and a business heading (#1059 unknown review,
  2026-10-16).
  The evidence is written as `darwin:<source>: <words>`, and migration 20270110000047 lets the
  audience trigger keep a `darwin:` decision on the verified row (every other verified write
  still inherits the raw row's audience). The decision is the audience the batch duplicate key,
  the consumer peer check and the second-source check read, and it is recorded on the
  `verify.rules` attempt (`fee_audience`, `audience_evidence`).
- The audience relabel (`audience-relabel.ts`, step `audience-relabel`, #1059 step 3) gives the
  same decision to live fees verified as `unknown` before migration 20270110000047, reading each
  document's newest text. A fee it cannot decide stays `unknown`. No provider calls. Each step
  reads at most `AUDIENCE_RELABEL_DOCUMENTS_PER_STEP` documents (by document id, after the
  run's `after_document_id`) and reports `next_after_document_id` and `remaining_documents`; the
  tick queues the next batch from that cursor until none remain. `AUDIENCE_RELABEL_MODE` is `off`
  until James switches it, in its own PR:
  - `off`: the tick queues one dry run a day over a sample of documents (md5 order by day) that
    counts decisions by audience and evidence source, and writes nothing.
  - `dry_run_full` (shipped, the gate before live): the same cursor chain as live over every
    document, one batch per tick, key chain `darwin:audience-relabel:dry:v4:after:<cursor>`,
    writing nothing but each batch's counts. The last batch adds the chain's totals to its detail
    (`dry_run_totals`) and writes an `audience_relabel.dry_run_totals` event. Live waits until the
    totals show unknown at most 10%, and consumer, both and business each within about 5 points
    of the sample's 70.5 / 23.3 / 2.2. A run does what it was queued for (`params.mode`).
  - `live`: before any write, each fee's old value is recorded as an `audience_relabeled` row in
    `pipeline_feedback` (weight 0). Then the verified row takes the `darwin:` decision, and the
    live published row is touched so the trigger copies it.
  - `rollback`: every recorded fee still carrying the relabel's evidence goes back to `unknown`
    with its old evidence, and the trigger copies the raw row's audience back (the old value),
    in batches of `AUDIENCE_RELABEL_ROLLBACK_PER_STEP`.
  Live and rollback refuse to start (the tick queues nothing, and a step that finds the trigger
  without `darwin:` fails) until migration 20270110000047 is present. On a random 150 of the
  7,949 documents (1,509 of the 77,268 live unknown fees, 14 Oct 2026), it decided 1,064
  consumer, 351 both, 33 business and left 61 unknown.
  Version 4 (#1687, Oct 17) also re-reads live fees Darwin called `both` only because the
  schedule prices business items somewhere (evidence `darwin:mixed_schedule_unqualified:`). Such
  a fee moves only to one audience read from a schedule's own title (`document_title`,
  `schedule_section_title`), never back to `unknown` and never to a default read from a newer
  copy of the text; anything else leaves it as it is. Its old value is recorded under its own key
  (`darwin.audience_relabel:v4:both:verified:<id>`), and a rollback restores each fee's first
  recorded value when it still carries the last relabel's evidence.
- A schedule's own title decides the fees under it (`scheduleSectionTitle`, #1687): the nearest
  heading-case title above the fee's line that is one audience's whole schedule ("PERSONAL
  SCHEDULE OF FEES", "Commercial Account FEE SCHEDULE", "SCHEDULE OF FEES - BUSINESS", or one set
  on two lines, "Consumer Deposit Account" over "Fee Schedule"), when the fee's line and every
  line between name no other audience. A title naming no audience ends the search, and so do two
  titles for different audiences one over the other (a menu or a contents list). A product's
  schedule ("Business Remote Deposit Capture Fee Schedule"), a joined audience ("General and
  Business Membership Fee Schedule"), a menu line and a line cut mid-sentence are no title. It is
  read after the fee's price cell and before the section-heading rule; a title at the top of the
  document keeps the source `document_title`.
- Every decision is written to `pipeline_attempts` (stage `verify`, fingerprint
  `raw:<fee_raw_id>`) with `decision` and `reason_code`; a row decided under this rule
  version is never selected again, so skipped rows cannot starve the batch.
- Which rows are due is one SQL test, `darwinDueSql` (`darwinStandingDecisionSql` for the
  decision part) in `verify.ts`, read by the selection, the state-lane scheduler's backlog check
  and the daily health check (#1052, 2026-10-14). Before, the scheduler and health counted only
  rows with no decision, so a row due again after a guard bump in a state with nothing else to do
  never woke a lane: 26 rows in Puerto Rico and Guam waited from Oct 9 and Oct 13.
- Review signals carry `reason_counts` keyed by code, and the category range for
  `outside_envelope` rows.
- A verified $0 row carries the `zero_fee` flag, which is what lets Hamilton publish it.
- Pass 2 (`peer-checks.ts`, free, rows the rules accept), each its own strategy in
  `pipeline_attempts` (stage `verify`, fingerprint `raw:<fee_raw_id>`):
  - `verify.peer_range` v5 (#1112, Oct 16): a state-level outlier is held only in
    `PEER_HOLD_CATEGORIES` (atm_non_network, overdraft, od_protection_transfer, rush_card,
    minimum_balance, wire_domestic_outgoing), where an outlier was usually a misread. In every
    other category the outlier is recorded on the attempt (`peer_outlier: true`, `peer_held:
    false`) and the fee is not held: graded on the 123 v4 and 113 v3 holds against their stored
    text, nearly all of those were real fees at an unusual printed price (photocopies, box
    drilling, $5 stop payments). No-fee, discount and allowance lines are the shared name rule's
    (`ruleFor`, Hamilton `EVAL_VERDICT_VERSION` v8). Each `verify.rules` attempt records
    `peer_version`, and a `peer_outlier` row decided under an older peer version is re-decided
    once. An older hold that has no `peer_version` is re-decided only when its own run's
    `verify.peer_range` attempt was a graded version (`DARWIN_PEER_GRADED_VERSIONS`, v3 and v4)
    and held it; the ungraded v1/v2 holds of Oct 5–10 stay held until they are graded (#1694).
    Below, "is held" means held in those categories.
  - `verify.peer_range` v4: a fee enters on the benchmarks' terms (`entersPeerCheck`, #1112).
    The peer levels are the benchmark population (`statsRowFilter`: consumer, both and unknown
    fees, no business-only schedule), so consumer and both fees are compared, an unknown fee is
    compared unless its schedule's address is business-only (`isBusinessOnlyLink`), and a
    business fee never is; its source check and second-source check still run. (v3, 2026-10-09,
    compared consumer and both only; on Oct 15, after Darwin's audience decision, that left 368
    accepted unknown fees a day unchecked.) A positive amount below p25 / 3 or above p75 * 3 of its
    state peers (asset-size tier level when it has 8+ institutions, else the state-wide
    level) is held as `needs_review` with reason code `peer_outlier` and the range in
    the reason and in the review signal's `peer_outliers`. When the state has fewer than
    8 peers the comparison falls back to the bank's Fed district, then the nation (same
    tier-then-all rule; levels from the live catalog, cached an hour per instance). A
    fallback comparison is recorded (`peer_scope`, `peer_held: false`) but never holds:
    the 2026-10-06 audit found half of the state-level holds were real prices, and every
    fee reaching pass 2 is already stated in the bank's schedule. Outcome
    `evidence_mismatch` when outside, `ok` when inside. Step detail:
    `peer_fallback_checks`, `peer_fallback_outliers`. On the 24 hours to 2026-10-06
    13:30 UTC, 11,637 of 28,039 approvals had no state comparison; the fallback covers
    all but a handful, and about 1,500 of them sit outside the wider range.
  - `verify.second_source` v2: the same fee in another stored document of the same
    bank (an older copy or a sister document) only when customer applicability is
    compatible. Consumer rows accept consumer or both-audience corroboration; business
    rows accept business or both; unknown rows do not receive second-source confidence.
    A business-only fee can never corroborate a consumer fee. Same compatible amount:
    outcome `ok` and the verified row gets the `second_source_agrees` flag. Different
    compatible amount only: `evidence_mismatch`, recorded as evidence, never blocking. Re-measured 2026-10-06
    13:30 UTC: before the schedule check (`not_in_source`), published fees whose second
    copy disagreed were pulled within 8 hours at 22% (77 of 346) against 8.5% (571 of
    6,709) when it agreed; since, 1.9% (2 of 108) against 2.7% (5 of 183). The schedule
    check closed the gap, so a disagreement stays evidence.
- Layer 2, learned category check (`category-model.ts`, free, shadow mode):
  `verify.category_model` v1 is a naive Bayes model over fee-name word stems and word
  pairs, trained on the live published catalog (cached an hour per instance), so it
  improves as wrong fees are taken down. It records, for every row with a category,
  the probability of Knox's category and its own best guess. Below 0.05 the outcome is
  `evidence_mismatch` (disputed); it never changes the decision yet. Step detail:
  `category_model_disputes`. On the 43 Texas answer keys it disputed 20 of 61 wrong
  approvals and 16 of 268 right ones, and its guess matched the key for 14 of the 20.
  Disputes are meant for the Claude adjudicator (layer 3), one of Darwin's two paid passes
  (the other is the release review, below), both billed to `ANTHROPIC_API_KEY_DARWIN`. The model also trains on the hand-checked
  answer-key fees in the shared learning store (`pipeline_feedback`, kind `answer_key`).
- Layer 3, Claude adjudicator (`adjudicate.ts`, step `verify-paid`, a provider step after
  `classify`, shadow mode): `verify.adjudicate` v1 sends Claude only the fees the free
  layers disagree on: approved fees the category model disputes, and category-guard
  rejects where the model is at least 0.9 sure of another category the guard accepts.
  25 fees per call, at most 10 calls per run, `PIPELINE_PAID_VERIFY_MODEL` (default
  Haiku 4.5), billed to Darwin's key under `agent:darwin`, which is fail-closed until its
  caps are set. Each verdict (is it a fee, which category) is recorded per fee with its
  side (`knox`, `model`, `other`, `not_a_fee`); it never changes a decision yet. On live
  data at 2026-10-06 07:20 UTC, 23 approvals and 477 rejects qualified.
  v2 (2026-10-07) sends each fee with the schedule rows around it (`scheduleContext`) and
  the shared source check's verdict on its amount (`price_check`), and re-reads v1's
  disagreements. Scored against the 81 answer-key texts, v1 was right on 27 of the 37
  disagreements at key banks (Knox on 2); its misses mostly took a neighbouring row's
  price or a balance threshold as the fee
  (`/mnt/project-files/darwin/adjudicate-vs-answer-keys-2026-10-07.md`).
- Paid calls only when they can act (#1111 step 1, PR #1126, 2026-10-12): `verify-paid` pays for the release
  review only while `DARWIN_RELEASE_ACTS` is on, and for the adjudicator only while
  `DARWIN_ADJUDICATE_SHADOW` is on (off: its verdicts never change a decision). With both off,
  as now (releases paused 2026-10-08), the step makes no model call, spends $0 and says which
  pass it skipped; the free verdict score still runs. In October the two passes had spent
  $9.02 (812 calls) and $3.98 (778 calls) on verdicts that changed nothing. A capped
  measurement run passes `measure: true` to make the calls anyway.
- Verdict score (`verdict-score.ts`, runs at the end of `verify-paid`, no model call): the
  category review's and the release review's verdicts at answer-key institutions are scored
  against the hand-keyed schedules (`answer-key-fees.json`, compacted from the Knox
  fixtures) in chunks of 20 decided verdicts, per review and per prompt version; a version
  below the newest one seen gets no more verdicts, so its open chunk is closed as a partial
  chunk (`detail.partial`, read with `decided`; 2026-10-09, after the release review went v11
  to v17 in a day and no version reached 20). Each chunk is a `verify.verdict_score` attempt
  (`detail.review`, `review_version`, `right`, `wrong`, `hit_rate`, `knox_right`, `misses`),
  outcome `ok` at 19/20 or better. Each miss is a `pipeline_feedback` row (kind
  `review_wrong`, check `darwin.verdict_score`), and both reviews read their own recent
  tuning-key misses for the categories in a batch as lessons. Holdout-key misses are recorded
  at weight 0 (`lesson: false`) and never read back, so `detail.holdout.hit_rate` measures the
  review on fees it was never corrected on (2026-10-09; before that, 29 holdout misses had
  been fed back as lessons). Coverage is small: about 5% of the
  category review's verdicts and 15 release reviews (to 2026-10-07) fall at keyed banks.
- Held fees (`release-held.ts`, after each verify step, up to 200 per step): every fee
  held as `outside_envelope` or `peer_outlier` is checked against the bank's stored schedule
  with `checkFeeAgainstSource`. Not stated: `reject`. Stated but outside the hand-set range:
  `keep` for a person (Hamilton's publish gate uses that range). Stated only as a tier, or
  filed under a category the category model disputes: `keep`. Same fee already verified:
  `duplicate`. Otherwise `review`: in the next `verify-paid` step, before the adjudicator and
  from the same call budget, `release-review.ts` (`verify.release_review`) has Claude read the
  fee beside its schedule line and release it only if it is a price the bank charges, fits
  the category it was filed under (the prompt lists the names the taxonomy files there), and
  the amount is the price, not a cap or a misread number. Released rows carry the
  `darwin_released_hold` flag so the whole release can be found and rolled back.
  A state lane whose state has fewer held fees than its call budget fills the rest with the
  oldest held fees from any state (2026-10-07: Utah's lane had 1 while about 1,000 waited elsewhere).
  Recorded passes (`releaseRecordedPasses`, strategy `verify.release_recorded`, each extract-free
  `verify` step): the review never picks a fee with a v17 attempt again, so the 421 fees v17 passed
  while the release did not act would stay held even with `DARWIN_RELEASE_ACTS` on. This pass
  releases them after today's free holds, under its own switch (`DARWIN_RECORDED_RELEASE_ACTS`, on since Oct 15),
  so the other release paths stay verdicts-only. Three holds were added after a hand check of 20
  found 19 right (Oct 15), and they hold in the review too:
  - `business_activity_row`: a business account's "Per Each ..." activity row filed outside
    account research (raw 418400, "Per Each ATM Withdrawal" $0.25 filed as an out-of-network ATM
    fee).
  - `frequency_word_disagrees`: an allowance's period stored as the fee's ("Over 3 per Year"
    stored annual), or a period word that contradicts a stated frequency.
  - `glued_or_cut_name`: a glued header ("Account Fees: ..."), a glued column (": no", "Notary:
    Outgoing") or a cut-off ending.
  Off, the step detail (`recorded_pass_release`) counts what would release and what is held, by
  category, and nothing is written. Switched on, the first step is a dry run that writes one
  ledger row (fingerprint `darwin:recorded-release:dry-run:v1`) with those counts; a step of
  another run at least 4 minutes later (the next tick) releases. A rollback of the batch reads the
  `verify.release_recorded` v1 attempts with outcome `ok` (`detail.fee_verified_id`).
  A second hand check of the 402 left to release found 15 of 20 right (Oct 15; overdraft 4 of 6,
  NSF 1 of 3, maintenance 5 of 6). Four more holds, in the review too:
  - `footnote_in_price` (also): the line's only price, whole with no cents, ending in 1 to 3,
    held as a peer outlier, and still plausible for its category without the last digit
    ("Monthly Service Charge: $31" for $3 plus footnote 1, raw 459372); or a superscript digit
    after the price.
  - `overdraft_transfer_as_od_nsf`: an item paid by an overdraft transfer filed as NSF or overdraft
    (raw 151073, filed as NSF; it is `od_protection_transfer`).
  - `band_as_price`: a band or threshold read as the price ("Lessthan $5.00", raw 437275; "$1,000 or
    over"), or a name cut at the band word.
  - `two_column_glue`: a name holding a second fee's name that another row prints as its own fee
    (raw 296682), a row's short band and price cells (40 characters or fewer, opening on a band
    word) printed again under another fee's name (raw 432124), or two headings and their two prices
    on one line with the fee's price not under its own heading (raw 169723, a levy given the
    account-closure price).
  Every other overdraft and NSF pass in the batch waits for a person (`overdraft_nsf_for_person`,
  `RECORDED_RELEASE_PERSON_CATEGORIES`). The third hand check scored 18 of 20. Its two misses
  hold, and two good fees the glue check held (whole sentences repeated in a product table, raw
  206385 and 512869) now release. `maintenance_without_context` (recorded passes only) holds a
  maintenance price with no rows around it, already a peer outlier: "Monthly Service Fee $29.95" on
  every Wilson & Muir page (raw 538902), a business cash management fee. On 15 Oct: 387 of 421
  would release, 34 held (11 glued or cut name, 7 frequency word, 5 overdraft/NSF for a person, 3
  two-column glue, 3 maintenance without context, 2 band as price, 1 footnote, 1 overdraft
  transfer, 1 business activity row).
  The release check reads the category (#1367, Oct 15, no version change). Until then `releaseVerdict`
  passed "." as `checkFeeAgainstSource`'s category pattern, so "stated" meant only that the name and
  amount were on the schedule (a hand check of 20 held `keep` fees found 8 filed under the wrong
  category, all passing that check). It now passes the category guard's own pattern
  (`releaseCategoryPattern`: `CATEGORY_GUARD_RULES[key].include`; none for a category with no guard
  rule or one that accepts any name, where the category rests on today's name guard and the model).
  A fee on the schedule with no category wording on its line or the 3 rows above is `keep`
  (`category_not_in_text`), never a reject. Both release paths run the same check again at release
  time against the fee's own stored schedule (`releaseCheckHold`), so verdicts recorded before the
  fix are re-read: a recorded pass or a review pass that fails it holds as
  `release_check:<reason>` (`category_not_in_text`, `category_disputed` when the category model
  disputes the category, `no_source_text`, ...), in step detail and the attempt's `release_check`.
  No release without the category model: when it cannot be loaded (each read runs in its own
  savepoint, `loadReleaseCheckInputs`), the recorded-pass release releases and records nothing that
  tick, not even its dry-run row, and the paid review makes no call (`modelMissing`). A hold that
  says only that this tick could not read what the check needs (`no_source_text`,
  `no_category_model`: `TEMPORARY_RELEASE_HOLDS`) writes no attempt, so the fee comes back next tick;
  a real hold (`category_not_in_text`, `category_disputed`, ...) is recorded and final for v1.
  The context check adds to the name guard only where the bank's own row words differ from the
  stored name; the category model is the stronger gate for a name that fits its category on paper.
  v1 released on the schedule check alone; its dry run on 2026-10-06 (1,997 of 4,128 held
  fees) had 12 of 20 hand-checked releases right. v2 adds the gates above. v3 (James chose
  "Reject only", 2026-10-06 16:49 UTC) acts on rejects (`DARWIN_RELEASE_REJECTS_ACT`): each
  writes a `darwin.release` note of kind `not_on_schedule` to `pipeline_feedback` and leaves
  the held pile. Those fees were never live, so nothing comes down. v4 (James, 2026-10-07:
  scrapping is a last resort, looked at more than once, logged, never deleted) takes two
  looks: the first "not stated" is `reject_pending` (logged, no note, still held); at least
  `DARWIN_REJECT_SECOND_LOOK_HOURS` later the fee is read again against its own document and
  the bank's current copy, and only a second "not stated" is a final `reject` with its note.
  A fee found on the schedule replaces an earlier reject note with a `restored` one
  (`stated_on_later_look`). Raw rows, attempts and notes are never deleted. Releases stay a dry run
  while `DARWIN_RELEASE_ACTS` is false; switching it on needs James's word and a version bump,
  and writes released fees as `darwin_verified` notes. Step detail: `held_release`.
  `verify.release_review` v5 (2026-10-07) is versioned on its own: a hand check of 20 v4
  verdicts had 17 right; the prompt now says a stop payment's removal and an expedited
  version of a service do not fit the service's category, and "Cost plus $8" is not a price.
  The review also reads lessons from `pipeline_feedback` (2026-10-07): for each category in
  a batch, the 3 latest live fees Hamilton's category checks took down as wrongly filed and
  the 2 latest takedowns a later check restored, each with its schedule line. A new takedown
  or restore is in the next review's prompt with no code change. The source check's amount
  judgements are left out until they hold up (of 20 read against the full page, 4 were real
  prices wrongly taken down and 3 unreadable). The review also reads the 3 schedule rows on each
  side of a fee's line (`scheduleContext`), since a price can belong to the next row or column.
  Each review attempt's detail records `lessons` (how many were in its prompt).
  v6 (2026-10-07): a second hand check of 20 v5 passes had 16 right, with two overdraft-protection
  transfers passed as overdraft. Each item now lists `not_these` (the categories the guard's
  re-file rules move its category's fees to), and a fee whose name plus line `refileCategory`
  moves elsewhere never passes (attempt detail `refiles_to`).
  v7 (2026-10-07): a hand check of 20 v6 passes had 17 right (a "Smart Safe" cash device passed
  as safe deposit box rent, a $65 box read with its footnote as $651, a bare "overdrafts $5.00"
  from jumbled rows). The prompt names all three.
  v8 (2026-10-07): a hand check of 20 v7 passes had 17 right (an incoming wire priced "$2.95 (FEE
  WAIVED)", an NSF check re-clear filed as NSF, an online-wire monthly fee filed as monthly maintenance).
  The prompt names all three. `scheduleContext` no longer anchors on a bare price row ("$5.00"),
  which had shown one item the rows around a different fee.
  v9 (2026-10-07): a hand check of 20 v8 passes had 18 right (an "Emergency Card Replacement" passed
  as card replacement, and a $10 rush card read from "Debit Card Replacement Rush Order | $10 $75").
  The prompt names emergency service and two prices in one row.
  v10 (2026-10-07): a hand check of 20 v9 passes had 18 sure right (an "Overnight Fee (Business Bill
  Pay)" passed as bill pay; a $2.75 "Return Check Item" beside a $30 returned-check fee is unclear).
  A fee whose name says it is the expedited, rush, overnight, emergency or same/next/second-day
  version of a service now never passes outside a premium category such as `rush_card`
  (`premiumServiceMisfiled`, attempt detail `premium_service`).
  v11 (2026-10-08): releases on (`DARWIN_RELEASE_ACTS`, James, "Turn on" at 02:16 UTC) after a
  hand check of 20 v10 passes had 19 right and 1 arguable. A passing fee becomes a verified row
  flagged `darwin_released_hold`, so the whole release can be found and rolled back. The bump
  has every held fee judged again with release on (paused again after v13, below).
  v12 (2026-10-08): v11 released 1,637 fees (219 live by 03:48 UTC). A hand check of 20 live ones
  found 18 right: "Monthly Fee $50.00" above "Night Deposit Bag $10.00" passed as the account's
  monthly fee and a $5 "Returned check fee" passed as NSF. A passing fee now stays held when the
  category guard rejects its name, when a bare "Monthly Fee" sits among a business service's rows,
  or when a plain returned check or item under $10 is filed as NSF (`releaseHoldReason`, attempt
  detail `hold_reason`).
  v13 (2026-10-08): v12 released 198 fees by 10:08 UTC (130 live). A hand check of 20 live ones
  found 18 right, 1 wrong ("/hr incl. reproduction", Legal Process Compliance $20/hr, released as
  document reproduction) and 1 arguable (a $5 draft copy named "account research fee may apply)").
  A name starting with "/" or ending in an unopened ")" now stays held (`name_fragment`).
  Releases off again (2026-10-08 21:30 UTC, James, "Pause" on the release card) after a hand
  check of 20 released v13 fees scored 17 (the three misses v14 names): `DARWIN_RELEASE_ACTS` is false in `release-held.ts`, so the review
  records verdicts only, and with #1111 step 1 (above) `verify-paid` does not pay for it at all
  until releases are back on or a run passes `measure: true`. They stay off until a fixed
  review's 20-fee check scores 19 or better. The review went on to v17 with releases off
  (`DARWIN_RELEASE_REVIEW_STRATEGY` in `release-review.ts`):
  v14 (2026-10-08): a hand check of 20 released v13 fees found a merchant's fee for a member's
  NSF check released as NSF, a $5 "Overdraft Protection Fee" beside a $25 Courtesy Pay fee
  released as overdraft, and an early-closure fee read as "$251 | 1" ($25, footnote 1); those
  stay held (`charged_to_merchant`, `small_overdraft_protection`, `footnote_in_price`).
  v15 (2026-10-08): James set the bar as the complete record, frequency included; a fee whose
  frequency says the opposite of its schedule line stays held (`frequency_contradicts_line`;
  "Excess activity charge - $5.00 each after 6" had been released as monthly).
  v16 (2026-10-08): the first 200-fee complete-record eval found frequency blank on 48% of live
  fees although the line said "each" or "per month", and 25 of 31 bad names were dot leaders,
  footnotes, bullet text, table headers or two-column glue. A released fee takes its frequency
  from the words after its own price when they point one way (`frequencyFromLine`), and those
  name shapes stay held (`name_fragment`).
  v17 (2026-10-09): names cut from a sentence or a table ("Inactive fee: This account may be
  subject to an Inactive fee of") stay held when Knox's `isCutoffName` finds a cut-off shape
  (`name_fragment`); Knox's retidy v6 gives the live ones their tidy name.
  Category guard v21 rejects business services' monthly fees (remote
  deposit scanners, IntraFi/ICS, per-location fees) as monthly maintenance and deposited checks
  coming back as NSF, so Hamilton's category guard takes the live ones down after its second look.
  Guard v22 (2026-10-08) also fails a returned check or item under $10 filed as NSF when the same
  schedule prices NSF separately at $15 or more (`schedule_contradicts`; Dean Co-operative Bank).
  Guard v23 drops the $10 ceiling (any price below the schedule's NSF fee). Once Hamilton takes such
  a fee off NSF, the classify step's `verify.schedule_refile` re-files its verified row as
  `deposited_item_return` (flag `darwin_schedule_refiled`, attempt detail from/to), and Hamilton
  publishes it as an RDI through its normal checks.
  Guard v24 (2026-10-08) rejects statement-copy and photocopy fees ("Statement Copy Fee",
  "Returned Item Photocopy", "Copy of ...") filed as overdraft or NSF, even under a section heading.
  Guard v29 (2026-10-08) accepts a per-item overdraft or courtesy pay fee whose own note counts the
  fees charged a day ("Overdraft Item Fee (Maximum of 5 Charged Per Day)"); a cap priced in the
  note or named outside it ("Overdraft Fee (maximum charge per day)", "Overdraft Daily Cap") stays out.
- Guard v29 also files "Insufficient Funds Charge (Paid)" (beside "(Returned)") as the overdraft fee, and re-files it there from NSF (WaFd).
- Guard v34 (2026-10-08; v31 and v33 went to the Accuracy rules in PRs 659 and 662) files paid and honored NSF items ("Paid nonsufficient funds (NSF)", "NSF Share Draft (Honored)", "Paid Consumer & Business NSF Items") as the overdraft fee, and re-files them there from NSF. One price for the paid and the returned item ("NSF Paid Item Fee/Returned Item Fee") counts as both, like "Returned item/overdraft".
- Guard v35 (2026-10-08) accepts a per-item overdraft or NSF fee whose note states the daily cap: a dollar cap above the row's own price ("NSF Returned Item(s) Charge (NSF charge maximum of $100 per day)" $25, First State Bank of Rosemount), and a cap note that names the returned items sharing it ("Overdraft Fee ... (Consumer Accts: 5 max total OD or Returned Item fees daily)", BankIowa).
- Guard v36 (2026-10-08) changes no rule: PRs 665 and 668 both shipped v35, so rows rejected between their deploys are re-checked under both.
- Guard v42 (2026-10-08; v40 and v41 are Accuracy's, PR 682) files an NSF item marked paid after a dash or in brackets ("NSF Fee Charge - Paid (per item)", "Nonsufficient Funds Fee-Paid", "Insufficient Funds Charge (Check Paid, Per Item)") as the overdraft fee and re-files it there from NSF; "per non-paid item", "Paid from other ... account" and "We will not assess ..." stay out. "Overdraft Privilege Standard or Extended Coverage" names the program, not an extended overdraft fee.
- The guard is at v75 (`CATEGORY_GUARD_VERSION` in `src/lib/fee-category-guard.ts`). v75 (Oct 19,
  #2023, James chose "Take down"): `CLUB_WITHDRAWAL_LIVE` is on, so a club or holiday account
  withdrawal ("Christmas Club early withdrawal | $20 per w/d") fails early closure; a read-only check
  of 25 of the 313 live found every one a per-withdrawal charge. Closing a club early still passes.
  v74 (Oct 19,
  #2018, James's 20-defect register): a bill pay investigation or research request re-files to
  account research; a withdrawal limit ("withdrawal over 6 per month") or returned mail leaves
  account research for its own type (a rule marked `onlyIfRefiles` fails a fee only when the other
  type accepts it, so "Excess withdrawal research" stays); an excess IRA withdrawal leaves IRA
  termination for IRA administration; foreign currency shipping leaves rush card for courier
  delivery; a loan payment line that names no deposit leaves returned deposited items for other
  lending; and a withdrawal at the institution's own named ATM ("at JSFCU ATM", `NAMED_OWN_ATM`;
  never "at other/non-network/Allpoint/our ATMs") fails the non-network ATM fee. A club or holiday
  account withdrawal (`CLUB_WITHDRAWAL`) would fail early closure, but `CLUB_WITHDRAWAL_LIVE` was off
  until v75. Dry run on 606 live candidates: 38 re-files, 2 to
  the second look. v73 (Oct 17,
  #1837, James's yes): `borrowedDirection` is on. A name whose part after its last colon is only a
  direction ("Check Printing: Incoming", a wire row read under the other column's heading) fails
  outside the categories a direction prices (`DIRECTION_KEYS`, any `wire_` key; a stop payment or
  research row naming a wire); 48 live fees go to the second look. v72 (Oct 17,
  #1788, James's sample-report review): an ATM used in another country, outside the U.S. or
  internationally (`INTERNATIONAL_ATM` in `fee-fold.ts`; never "foreign ATM", and a row that also names
  domestic or in-the-U.S. ATMs stays) leaves the non-network ATM fee for `card_foreign_txn`; an
  optional add-on (a named add-on, "add ID Protect to your account", "each additional Elite
  membership", on its name or its own line) is not the monthly maintenance fee and fails, since none of
  the 50 types holds it; a sustained overdraft filed as the per-item fee (`SUSTAINED_OVERDRAFT`: "Cont
  OD", "7 Day Overdraft", "6th business day overdrawn", or a price whose own line says it is charged
  when the balance stays negative for N days) re-files to `continuous_od` (never to NSF); an incoming
  wire filed under an outgoing wire key (`INCOMING_WIRE`: in coming, in-bound, wire-in, ": In",
  "Domestic-In", wire deposit; one price for both directions stays) re-files to the matching incoming
  key. Each moves by guard, re-file rule and fold split. Its live re-check is the publish step's fold
  split and the guard's live sweep: the dry run (Oct 17, SELECT-only) re-files 14 live fees in place (4
  international ATM fees, 3 sustained overdrafts, 7 incoming wires) and fails 7 more, flagged for the
  second look and then taken down: 5 add-ons, and 2 re-files a live twin at the same bank, type and
  amount blocks (14348, 98702). 5 rows no name rule can place are hand takedowns (#1788: 2 repeat
  international ATM reads, 3 add-ons), and ServisFirst's "Domestic Wire Transfer Fees" $10 (66594, the
  incoming price on its line) is a hand re-file (`HAND_REFILES` in `taxonomy-fold.ts`). Hancock
  Whitney's "Overdraft Charge/Overdraft Fee (each item)" $36 (66419) stays: it is the per-item fee, and
  the $36 Sustained Overdraft Fee is live as continuous_od 66411. No batch reaches 20, so no switch
  holds them. v71 (Oct 17,
  #1772, #1773): the non-network ATM fee also refuses another institution's card named in more than
  one word after "non-" (`OUTSIDER_CARD_WORDS` in `OUTSIDER_ATM`: "ATM Non-STAR Financial Credit Union
  card Surcharge", "Non Co-Op Card ATM Withdrawals at TLC"); words that reach "ATM" or "machine" first
  are a non-network ATM and stay. An ATM transaction verification re-files to account research
  (`NOT_ATM_USE`, 96092). Its live re-check is the guard's live sweep: the dry run (Oct 17,
  SELECT-only) counts 8 live fees newly failing, 8 of 8 non-customer surcharges on their stored line,
  flagged for the second look and then taken down, and 1 re-filed in place. The bare "ATM Surcharge"
  lines a name cannot place (13 non-customer surcharges by their heading or line) and 15 lines that
  are not the fee (in-network $0s, a refund cap, a waived price) are hand takedowns held by
  `ATM_SURCHARGE_TAKEDOWN_LIVE` (on since James's yes, Oct 17 11:28 UTC). v70 (Oct 17,
  #1765): a card-product fee filed as the non-network ATM fee (`CARD_PRODUCT_FEE`: the card's monthly,
  annual, holder or maintenance fee, its issue, activation or origination, a reinstatement or limit
  increase, the card's inactivity, a point-of-sale purchase fee) and a card's inactivity filed as a
  dormant account (`CARD_INACTIVITY`) fail the guard; none of the 50 types holds them. Darwin and
  publish refuse new reads at once. Their live re-check is the guard's live sweep (catch-up, then every
  publish step). `CARD_PRODUCT_TAKEDOWN_LIVE` is on since James's yes (Oct 17, 10:47 UTC), so they are
  flagged and taken down through the second look; switched off, the sweep counts and samples the live
  fees failing only this rule (`category_guard_card_product_pending` in the publish step's detail)
  and flags none. The dry run (Oct 17, SELECT-only) counts 61: 39 non-network ATM fees
  and 22 dormant account fees; 59 trace on their stored line and 2 do not (25037, 57456). Navy
  Federal's gift card "Inactivity Fee" (122350) names no card, so it is a hand takedown under the same
  switch (62 in all). An ATM-named bill payer service (147703) re-files to bill pay and a card charge
  on early account closure (117628) to early closure, in place, switch or not. Skipped loan payments
  (`SKIP_A_PAY`, James, Oct 17) leave late payment (29 live) and loan origination (2) for other lending
  by guard, re-file rule and fold split (31 of 31 trace), and the taxonomy's skip-a-pay aliases point
  there. v69 (Oct 17):
  a returned Canadian or international item filed as NSF (`FOREIGN_DEPOSIT_RETURN` in `fee-fold.ts`;
  one that also names domestic items, insufficient funds or a cost stays) is a returned deposited item,
  and an IRA's own closing charge filed as an early closure (`IRA_CLOSING`; a closure that only
  mentions the IRA, or a certificate's or club's, stays) is the IRA termination fee, each by guard,
  re-file rule and fold split. The non-network ATM fee refuses what non-customers pay at the
  institution's own ATMs (`OUTSIDER_ATM`; none of the 50 types holds it, #1196) and a monthly ATM
  add-on or plan (`ATM_PLAN`, "Power Checking +ATM Freedom"), and ATM-named lines that price something
  else (`NOT_ATM_USE`: a dispute, a copy of a card sale, a lost, stolen, blocked or replaced card, a
  negative balance, a cashier's, treasurer's or official check, temporary checks, a cut-off-times
  sentence). An ATM balance inquiry stays: `balance_inquiry` is retired and folds here. Its live
  re-check is the publish step's fold split and the guard catch-up: the dry run moves 6 live NSF fees
  and 12 live early closure fees (and 17 verified rows not live), and fails 79 live non-network ATM
  fees: 58 non-customer surcharges, 5 ATM plans and 16 `NOT_ATM_USE` lines (flagged for the second
  look; 4 of those come back re-filed, 2 as account research and 2 as card replacement, and the rest
  are taken down). 9 verified rows not live fail it too. Two earlier NSF takedowns (41726, 22674) that trace on their
  own stored text come back as returned deposited items.
  v68 (Oct 17):
  a returned foreign, Canadian or international check or item (`FOREIGN_ITEM_RETURN` in
  `fee-fold.ts`) leaves `check_cashing` for `deposited_item_return` by guard, re-file rule and fold
  split, and `bill_pay` refuses a row that is the overdraft (courtesy pay) or NSF fee by its own name
  or by the heading just before it on its source line (#1304). Its live re-check is the publish
  step's fold split (it runs before the guard) and the guard catch-up: the dry run moves 10 live check
  cashing fees and fails 8 live bill pay fees (flagged for the second look, then taken down; 6 of the 8
  repeat an NSF fee already live at that bank and price). Darwin re-reads its older category
  rejections once, as for every guard version.
  Before v68, v67 was the guard with `RESEARCH_SPLIT_LIVE` on (James, Oct 17), and v66 with it off
  (off, v65's rules read every live fee as v64 did, so v66 is v64 plus v66's rule and v67 is v65 plus
  it); v68's rules do not depend on the switch, so turning it off again needs its own version. v66 (James, Oct 16, #1099 option A; #1605): a deposit for
  the night depository key is a key charge, not the service, so `night_deposit` refuses it; a lost or
  replaced key stays. Its live re-check is the category guard's live sweep (Hamilton's guard
  catch-up on the first tick after the deploy, then every publish step): 10 live key deposits fail
  it, each flagged for the second look and then taken down. The notes for v43 to v72 are the version
  comments above that constant, not this guide; v58 is the bond-return lesson above. v65 (James, Oct 15, #1398) adds guard rules for `excess_withdrawal` and
  `returned_mail` (amount envelopes $1 to $50 in `envelopes.ts`), re-files research filed under
  either back to account research. Once `RESEARCH_SPLIT_LIVE` is on, an over-limit activity charge
  on a monthly maintenance row's own line (`refileFromLine`) that names savings, money market or
  share withdrawals, transfers or debits goes to `excess_withdrawal`; until then, and for every
  other activity charge, it still goes to account research. Nothing is filed under either new key
  while the switch is off.
- Learning store: every verify decision except duplicates and category rejects (the
  publish-step sync writes those) is written to `pipeline_feedback` as a judgement on
  Knox's read (`darwin/feedback.ts`; step detail `feedback_written`, null when skipped).
- The ranges in `envelopes.ts` are hand-set and deliberately wide. Categories without one
  get a learned ceiling (`learned-envelopes.ts`): three times the 95th percentile of the
  banks' median live amount, for categories priced by 30+ banks, lending fees excepted;
  the floor stays $0.01 because per-page and per-item prices of a few cents are real.
  Darwin alone applies it (Hamilton's publish gate and outlier rollback keep the
  hand-set ranges, so it never takes a live fee down). Step detail:
  `learned_envelope_holds`; the decision's attempt records `amount_envelope` with its
  source. On the 24 hours to 2026-10-06 13:30 UTC it would have held 35 of about 5,500
  approvals in its 19 categories; in a sample most were limits, thresholds and examples
  read as the fee.

## Required Behavior (target contract)

- Verify canonical fee hints, amount reasonableness, duplicate state, source lineage, and rejection policy before promotion.
- Preserve raw row lineage through `fee_raw_id`, institution ID, source URL/key, confidence, flags, and verifying run/event IDs.
- Aggregate review signals by institution/run with reason counts instead of creating noisy one-row alerts.
- Keep verified rows separate from published rows until Hamilton publication gates pass.

## Boundaries

- Do not publish fee rows directly.
- Do not turn skipped or challenged rows into public benchmark inputs.
- Do not weaken verification checks to increase row volume.

## Daily health check (contract)

`agent-health.ts` runs with the daily scoreboard step and stores these numbers in
`pipeline_scoreboard_snapshots.detail.agent_health`, next to yesterday's. A broken rule, or any
number that moved more than 25% since yesterday, is named in the scoreboard step's summary.
Change this table and `agent-health.ts` in the same PR.

| Rule | Number | Holds when |
|---|---|---|
| Steps do not fail | `stepsFailed` (24 h) | 0 |
| Darwin keeps up | `undecided` (Knox rows the verify step would select now: never decided, or due again after a guard, source-check, envelope or batch-key change; `darwinDueSql` in `verify.ts`) | ≤ 500 (`DARWIN_VERIFY_MAX_LIMIT`) |
| No week-old waits | `waitingOver7d` (due rows sent to Darwin over 7 days ago with no first decision at this rule version) | 0 (`DARWIN_MAX_FIRST_DECISION_DAYS`) |
| Fees Darwin passed survive the bank's own schedule | `sourceCheckTakedowns / published` (24 h) | ≤ 5% |

Also recorded, without a rule: `stepsCompleted`, `spendUsd`, `decided`, `passed`.

The pool of Knox rows flagged for Darwin and not verified (`pool`) is split three ways, and the
parts add up to it:
- `undecided`: due now (the "Darwin keeps up" number above).
- `heldForReview`: not due, and the latest `verify.rules` decision is a hold the release review
  looks at (`outside_envelope`, `peer_outlier`; `DARWIN_HELD_REASON_CODES`). Split by the latest
  `verify.release` verdict: `heldKeep`, `heldReview`, `heldDuplicate`, `heldReject`, and
  `heldNoVerdict` (none yet, or a first "not stated" look waiting for its second).
- `finalRejects`: not due, with a standing decision that is not a hold. Darwin owes these
  nothing until a rule version changes, so they are in no waiting number.

`audienceCorrection` counts rows the audience trigger refuses; they are neither due nor decided.
On 15 Oct (03:46 UTC): pool 16,351 = 7,340 due + 6,094 held (4,121 keep, 886 review, 809 duplicate, 278
reject) + 2,917 final rejects.

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `AUDIENCE_RELABEL_VERSION` | `darwin.audience_relabel` | v4 | `darwin/audience-relabel.ts` |
| `DARWIN_ADJUDICATE_STRATEGY` | `verify.adjudicate` | v2 | `darwin/adjudicate.ts` |
| `DARWIN_CATEGORY_MODEL_STRATEGY` | `verify.category_model` | v1 | `darwin/category-model.ts` |
| `DARWIN_PEER_STRATEGY` | `verify.peer_range` | v5 | `darwin/peer-checks.ts` |
| `DARWIN_SECOND_SOURCE_STRATEGY` | `verify.second_source` | v2 | `darwin/peer-checks.ts` |
| `DARWIN_RELEASE_STRATEGY` | `verify.release` | v4 | `darwin/release-held.ts` |
| `DARWIN_RECORDED_RELEASE_STRATEGY` | `verify.release_recorded` | v1 | `darwin/release-review.ts` |
| `DARWIN_RELEASE_REVIEW_STRATEGY` | `verify.release_review` | v17 | `darwin/release-review.ts` |
| `DARWIN_SCHEDULE_REFILE_STRATEGY` | `verify.schedule_refile` | v1 | `darwin/schedule-refile.ts` |
| `DARWIN_VERDICT_SCORE_STRATEGY` | `verify.verdict_score` | v2 | `darwin/verdict-score.ts` |
| `DARWIN_RECHECK_STRATEGY` | `verify.recheck` | v5 | `darwin/verified-recheck.ts` |
| `LIVE_FRAGMENT_STRATEGY` | `darwin.live_fragment_check` | v6 | `darwin/live-fragment-check.ts` |
| `HOURLY_CHECK_VERSION` | `darwin.hourly_frequency_check` | v2 | `darwin/hourly-frequency-check.ts` |
| `NON_DEPOSIT_CHECK_VERSION` | `darwin.non_deposit_document` | v3 | `darwin/non-deposit-document-check.ts` |
| `LINE_CONFLICT_CHECK_VERSION` | `darwin.line_conflict` | v1 | `darwin/line-conflict-check.ts` |
| `TRANSLATED_COPY_CHECK_VERSION` | `darwin.translated_copy` | v2 | `darwin/translated-copy-check.ts` |
| `CANADIAN_DOCUMENT_CHECK_VERSION` | `darwin.canadian_document` | v1 | `darwin/canadian-document-check.ts` |
| `DOCUMENT_OWNER_STRATEGY` | `verify.document_owner` | v1 | `darwin/document-owner.ts` |
| `DARWIN_VERIFY_STRATEGY` | `verify.rules` | v3 | `darwin/verify.ts` |
| `DARWIN_SOURCE_CHECK_VERSION` | — | v2 | `darwin/verify.ts` |
| `DARWIN_BATCH_KEY_VERSION` | — | v4 | `darwin/verify.ts` |
