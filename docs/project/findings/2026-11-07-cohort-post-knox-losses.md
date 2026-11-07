# 2026-11-07: Right fees Knox read that never reached live on the scored cohort

**Agent lesson:** darwin/cohort-2026-11-07-the-word-in-its-place-and-the-twin-that-stands

**Guard:** src/lib/agents/darwin/cohort-post-knox-losses.test.ts

**Lesson:** An exclusion word refuses a fee only where it means what the rule was written for, and a
duplicate is held only for its twin. Most right fees lost after Knox on the cohort, though, are not lost in
Darwin's or Hamilton's code: they are Knox reads today's rules no longer reproduce, fees with no price to
publish, recorded decisions the answer key disagrees with, and scorer artifacts.

**What was measured:** answer-key score run 117 (scorer v3, Nov 6). On the seven cohort banks with a loss,
Knox matched 139 key fees, Darwin 123 and live 120: 19 key fees right at Knox and not live (Austin Bank 395:
17/15/14, Rabun County Bank 2267: 29/28/28, Tandem FCU 4888: 21/19/18, Metro North FCU 5410: 14/10/10,
Geovista FCU 6109: 29/23/23, Utility District FCU 7229: 17/16/15, Springfield City Employees FCU 7815:
12/12/12). These per-bank counts are the stored run's; they differ from the counts first quoted for the run,
whose total (19) is the same. Each of the 19 was traced on Nov 7 (prod, read-only): its raw rows on the key's
document, the latest `verify.rules` v3 decision, the verified row and flags, the publish attempts, and the
live row's take-down reason.

**The 19, by cause:**

| Cause | Key fees | Banks and fees | Fixed here |
| --- | --- | --- | --- |
| A "varies" fee with no price: Knox read no amount, and only dollar and rate fees publish | 5 | check printing at 395, 2267, 6109; safe deposit box at 395; Geovista's "VISA Foreign Transaction Up to 1%" (Knox reads no rate) | No: a product decision, and the rate miss is Knox's |
| A live fee the rules re-check took down on Oct 5 (`rules_recheck_unreproduced`): today's Knox rules do not read it, and the Oct 13 lost-restore bar judged it and kept it down | 5 | Tandem's two $3 official checks ("Official Checks", named from the words after the price), Metro North's NSF $20 ("A charge will be assessed...", figure cut out) and dormant $5 ("There will be a"), UDCU's "Debit/ATM PIN replacement" $5 | No: Knox's lane (reproduction and names) |
| A recorded rule the answer key disagrees with | 4 | Geovista's "Christmas Club Withdrawal" $5 as early closure (`CLUB_WITHDRAWAL_LIVE`, James's "Take down", Oct 19, #2023); Metro North's free balance inquiry and Geovista's free e-statements (`retired_category`, top-50 fold); UDCU's PIN replacement as card replacement (guard v80, #1912) | No: James's decisions stand |
| Scorer v3 artifact: the fee is live | 2 | Austin's $30 overdraft (live 131046 from document 28050, the key document's read 165565 held as identical); Metro North's "Return Mail" $5, live as `returned_mail` after the #1398 split (v5 scores it) | Nothing to fix |
| A peer or range hold on a low overdraft | 2 | Tandem's "Overdraft Fee $3.00 per item" (overdraft floor $5, `envelopes.ts`: live overdrafts under $5 were transfer fees and thresholds, "a real one goes to review"); Geovista's "Overdraft Privilege (Transactions less than $5) $5.00" (peer hold, then the release review refused it) | No: the floor is deliberate; both wait on review |
| A duplicate held behind a twin that no longer stands | 1 | Geovista's "Inactive Account Fee" $5 (raw 117266), held `duplicate_in_batch` behind "Vacation Club Withdrawal" $5 (117265), read from the same printed line under `dormant_account`; the guard took that one down on Oct 7 (live 29450) | Yes, behind `DUPLICATE_TWIN_GONE_REREAD_LIVE` (off) |
| Knox read the wrong price; the key is "varies", so any price scores | 1 | UDCU's check printing: "$20" is the next column's domestic wire; live 45619 came down as `source_mismatch: #1512` | Nothing to fix: rightly down |

Prosperity Bank (61), the eighth key bank in the cohort, shows the Overdraft Charge example: raw 278420,
"Overdraft Charge, each item, maximum of 5 fees per business day" $35, is refused at guard v110 for
"maximum", but raw 109075, "Overdraft Charge, each item" $35, on the same document is verified, so the key
fee is not lost.

**Darwin's two code causes:**

- The guard reads a word out of its place. On the 62 answer-key banks (same trace) 30 lost key fees have a Knox row whose latest
  decision is `category_mismatch`. Tested on the guard with each row's own line, three exclusions misfire on right
  fees: nsf's `others` on a tier label ("Insufficient Funds (NSF)- All Others | $35 per presentment",
  America's Credit Union 8162), nsf's `re-?present` on a bracket that charges each presentment ("Returned
  Item Fee (Each Time Item is Presented or Represented)" $32, 1552), and card_replacement's `check` on
  "Replacement Check (Debit) Card" $10 (8162). The rest are recorded decisions (club
  withdrawals, business accounts, account-benefit $0s), Knox's wrong rows, or need a ruling ("NSF Paid
  Check Fee" $25 keyed as overdraft at 4600; the trace lists each).
- A duplicate is never read again when its twin goes. `darwinStandingDecisionSql` re-reads a
  `duplicate_in_batch` hold only under an older batch key, and only when no row of the same document,
  category, price and line exists, whatever that row's status. 117266's twin 117265 shares its excerpt and
  is rejected, so 117266 waited from Oct 5.

**Fix:**

- Guard v111 (`src/lib/fee-category-guard.ts`): `(?<!\ball\s+)others`, a `re-?present` that does not follow
  "(... presented or" in an open bracket, and `check` not before "(Debit) card" or "(ATM) card".
  Accept-only. Dry run (prod, read-only, Nov 7): 8 Knox rows not superseded and held `category_mismatch`
  match the new words. 7 pass v111 and the shared source check (`checkFeeAgainstSource`, on a window of the
  stored text around the line), and each is its document's own line at that price and type: 1444058
  ($10) and 1444072 ($35) at 8162, 1121548 ($10) and 1121550 ($25) at 7142, 183418 ($32) at 1552, 660175
  ($15) at 3965, 677102 ($30) at 2584. The eighth, 188352 (a sentence, "If multiple items overdraw your
  account..."), still fails. Gained at Darwin: 7, wrong: 0, live fees taken down: 0. Hamilton's publish
  rules still apply to the 7. Three are answer-key fees (8162's NSF $35 and card $10, 1552's NSF $32); none
  is in the seven-bank cohort.
- `DUPLICATE_TWIN_GONE_REREAD_LIVE` (`src/lib/agents/darwin/verify.ts`, off): a hold on the current copy is
  read once more when no verified or approved fee of its category and price stands at the bank. Count
  (prod, read-only, Nov 7): 41 Knox rows at 38 banks, every `verify.rules` v3 decision a duplicate, 1 at
  the answer-key banks (117266, right). Read by eye on their own lines, several are not fees ("-$1.00 for
  eStatement" is a reward, "$2 Off Service Charge" a discount, "Free basic wallet style personal checks" a
  perk), and Darwin's rules for them need the database (peer ranges, learned envelopes, the category
  model), so the switch waits for a sampled dry run of the 41.

**Not fixed here, for the record:**

- Hamilton holds a verified fee as "Identical fee already published" behind a live twin, and re-selects it
  only when the twin came down as `rules_recheck_unreproduced` (`undecidedAtThisVersionSql`). Prod-wide on
  Nov 7, 2,186 verified rows whose last publish decision was "Identical fee already published" have no
  live fee of their category and price at the bank; most of their twins' take-down reasons (closed institution, account type, document
  host, edition) apply to the twin as much as to the row. 8 at the answer-key banks sit behind a
  category-guard take-down, and the two that are key fees are club withdrawals (7288's "Holiday Club
  Withdrawal" $3 behind 152838, 7346's "Club Account Early Withdrawal" $10 behind 71328). No recall gain on the key,
  so no change.
- The 5 re-check take-downs and the "up to 1%" rate are Knox's to read again; the "varies" fees, the club
  withdrawal, the PIN replacement and the retired categories are James's.

**Where it lives:** `src/lib/fee-category-guard.ts`, `src/lib/agents/darwin/verify.ts`,
`src/lib/agents/darwin/cohort-post-knox-losses.test.ts`; the trace is under
`/mnt/project-files/data-quality/cohort-post-knox-losses-2026-11-07/`.
