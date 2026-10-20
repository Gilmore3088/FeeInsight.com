# Weekly live fee accuracy: sampling, correction and retest

Protocol v1 · 2026-10-19 · written acceptance for [#1923](https://github.com/Gilmore3088/FeeInsight.com/issues/1923).

The launch accuracy measurement is the **one weekly live batch of 50 whole institutions**, in five prompts of ten, set by James in [DECISIONS, 2026-10-19](../project/DECISIONS.md). Check every published fee against the institution's current applicable schedule and record missing tracked categories. The data quality lane supplies the draw, takes every miss and handles follow-up. James receives the score; this protocol adds no manual confirmations, answer-key checks, row checks or extra live batches for him.

This document fixes the sampling, scoring, uncertainty and repair rules. It does not record a new draw, execute an audit, certify 99.5% accuracy or approve launch. The [automated stored-copy diagnostic](../../src/lib/agents/deming/ACCURACY.md) is separate. Live-fetch automation [#2061](https://github.com/Gilmore3088/FeeInsight.com/issues/2061), answer-key document eligibility [#1862](https://github.com/Gilmore3088/FeeInsight.com/issues/1862) and automated quality coverage [#1063](https://github.com/Gilmore3088/FeeInsight.com/issues/1063) remain open.

All provenance capture, hashes, category/row manifests, probabilities, reconciliation, ledger preparation and interval calculations below belong to the **data quality lane and its tooling**, not James. The existing five packets of ten remain his complete checking workflow. Missing metadata or evidence is a lane-owned limitation to resolve from existing receipts or report explicitly; it creates no additional human entry or checking task.

## 1. Reuse the existing draw and preserve its population limits

The primary workspace already has `live-batch/README.md`, `export-population.sql`, `generate-weekly-batches.mjs`, `packet-method-template.md`, `audit-history.json` and the five `Weekly Review/` packets. These are existing local operational files, not files introduced or modified by this plan. Their current method is:

- Export a complete, timestamped population of institutions with live dollar or percentage catalog records. Preserve its read-only query receipt and reject truncated, inconsistent or more-than-seven-day-old input. It is a **published-institution frame**, not all active banks and credit unions; zero-fee profiles are outside it.
- Keep bank and credit-union charter types separate. Retain the existing asset tiers `community_small`, `community_mid`, `community_large`, `regional`, `large_regional`, `super_regional`, their registry definitions and dated asset metadata; do not replace them with invented dollar thresholds. Map the 50 states and DC to Northeast, Midwest, South and West using the existing Census mapping. Unknown metadata or an unmapped territory stops preparation rather than silently removing an institution.
- Preserve the existing exclusions: Frost Bank (49), Space Coast Federal Credit Union (8109), and checks/reservations within the inclusive previous 182 days. Do not open those permanently excluded institutions as part of this review. Missing historical checks remain a provenance limitation. A labelled partial-history draw cannot certify complete 26-week exclusions.
- Form each stratum `h = charter × asset tier × Census region` **after exclusions**. For eligible population `N = sum(N_h)`, allocate `n_h` of the fixed 50 using Hamilton largest remainder: start at `floor(50 N_h/N)`, then assign remaining places by descending integer remainder `50 N_h mod N`, using the saved seeded order only to break equal-remainder ties. Keep zero allocations in the receipt. Within a stratum, use the existing versioned, seeded SHA256 rank and take the first `n_h`; separately order the selected 50 into five packets of ten. There are no category-level row subsamples: all fees and the complete tracked-category checklist are examined inside each institution.

The seed is generated once, after freezing the frame, before seeing results; preserve it even when the result is poor. Conditional on the recorded allocation, the design interpretation is a simple random sample without replacement within each stratum, with `pi_i = n_h/N_h`. This relies on the stated pseudorandom-ranking assumption; hashing is not external certification of randomness. A zero-allocation cell has `pi_i = 0`, not an invented positive probability. Do not redraw for a nicer mix, replace blocked institutions, filter by source readability, or infer historical probabilities from today's population.

Save the algorithm/template/metric versions; seed; preparation time and actual execution times; raw and canonical frame hashes; history-before and proposed history-after; every exclusion and reason; `N_h`, `n_h`, `pi_i`; selected IDs and five packet assignments. A reservation is not an executed review. Preserve failed attempts and incomplete coverage. Later fresh weeks get a new seed; a deliberate repeat keeps its original sample identity.

The raw weekly score describes the selected institutions. Proportional allocation with rounding, no-repeat exclusions and zero cells does **not** make it an unweighted whole-index estimate. If all cells have positive inclusion probabilities and inventories reconcile, an optional eligible-population point estimate is the fee-weighted ratio `sum(C_i/pi_i) / sum(m_i/pi_i)` over selected institutions. Label it a ratio estimate, retain design weights and never compute it with division by zero. When any cell is unobserved, report the descriptive score and conservative bound below rather than pretending that cell is represented.

The default inferential target is the named, frozen **post-exclusion published-institution population**. Any whole-index statement must also account for excluded institutions' row mass as worst case. If those inventories are unavailable, no numerical whole-index bound is available. Neither target covers institutions with no published fees or establishes their missing-fee coverage. The guide's existing phrase that the draw stands for the whole index must not be used as a statistical claim.

## 2. Freeze the fee units and current-source evidence

Define one fixed target time `t0` in UTC in the draw receipt: the timestamp of the frozen population/fee inventory, before selection and before results. Both the published units and the official schedule's applicability in the statistical target are evaluated **as of `t0`**. Retain the later execution window and each retrieval time separately. A document retrieved later may establish applicability at `t0` through its effective interval/version, but its retrieval time does not move that cutoff. Without that evidence, classify the affected rows as unresolved and withhold certification when target-unit reconciliation fails. Do not silently combine each institution's latest state into a supposed single-time population.

Before scoring, save a versioned manifest of the public category keys, including their ranking/version. The public list is capped at 50 while the [taxonomy](../../src/lib/fee-taxonomy.ts) can contain additional keys; a historical packet's longer label list is not silently declared the same 50. Check every published row even if its category is outside the frozen recall checklist, and report that scope separately.

A published fee unit has institution, published/lineage IDs where available, canonical category, actual displayed name, product/account, audience, channel/geography, amount kind, dollar amount or percentage, basis/frequency, quantity/minimum/cap/tier/waiver conditions, document/version/line location and effective-date applicability. Equal amounts or names alone do not establish identity. Keep legitimate product variants separate; a duplicate translation/source copy cannot earn a second match to the same fee. One shared row rendered in both audience panels counts once; save the mapping. Rates stay rates, and their accuracy/counts are also reported separately from dollar fees; amounts and percentages are never averaged together.

Save the complete public inventory, including hidden “Show all” rows and both audience panels, timestamped public-catalog metadata, reconciliation mapping, page/source hashes and capture receipts. A catalog count is not automatically the number of unique rendered fees. For the inferential target below, `m_i` must be the known count of the **same fee units** for every institution in that frozen target, not a stale count, panel-copy count, category count or assumed 15 fees per bank.

If a sampled inventory differs from the frame, retain both. The data lane's tooling reconciles identity and timing without deleting troublesome rows or silently updating the denominator. A newer complete page may be described as a new snapshot, but it does not repair the old draw's inventory or probabilities. Withhold the design bound if target inventories cannot be reconciled; do not extrapolate the sampled discrepancy to unsampled institutions. A blocked or incomplete selected page remains selected and unresolved. An unavailable population-wide row inventory permits only descriptive results, not the fee-weighted bound. None of these cases requires James to repeat the live check.

For each bank source, record the official owner/charter, URL, capture time, bytes/text hash, relevant page/line or short quotation, document date, effective interval and product/audience. Establish that the schedule applies at the frozen audit cutoff; fetch/read time is not its effective date. A wrong bank, business-only schedule used for consumer fees, hub, or unrelated product is not evidence. A future schedule does not replace today's one early. A legacy product may legitimately retain charges for existing customers; establish applicability and labelling rather than assuming all legacy fees are discontinued. Loan, gift/prepaid and other tracked products use their own applicable schedules, not a blanket personal-deposit exclusion.

Use current official sources and examine newer linked schedules. An old stored text, a shared validator passing, a source URL resolving, or an answer key marked confirmed does not by itself establish current applicability. `checkFeeAgainstSource` is useful supporting evidence, not an independent adjudicator of document identity, time or missing fees. Conflicting, blocked, unreadable or temporally ambiguous evidence is `CANT_VERIFY`. If the source/page changed during the audit window and applicability at the original cutoff cannot be reconstructed, keep the row unresolved and retain both versions. The data lane investigates from available evidence; James is not asked for an extra check or to re-confirm an already covered bank.

## 3. Row decisions and missing-fee denominators

Keep the existing verdict vocabulary. Give every published unit one primary verdict and any secondary error tags; count it once as wrong even when several fields fail. Preserve the scoring version. Use these distinct tags rather than hiding conditions and dates inside “amount”:

| Error class | What must agree with the applicable schedule |
| --- | --- |
| Amount/rate | Exact dollars or percent, including mixed formulas, floors, tiers and ranges |
| Category | Actual service and direction: NSF/OD, wire/book transfer, ATM/card, lending/safe deposit, etc. |
| Conditions/basis | Waiver eligibility, balance/product thresholds, per-item/hour/month/year units, bundle quantity, minimum and cap |
| Audience/product | Consumer/business treatment, account/product, channel, customer eligibility and geography |
| Effective date | Current legal applicability, including not-yet-effective schedules |
| Discontinued/legacy product | Whether the charge remains applicable and is labelled for that product/customer cohort |
| Source identity/currency | Correct institution and document; newer applicable schedule considered |
| Duplicate/not-a-fee | Repeated source/translation rows, examples, benefits, limits and non-fee text |
| Name/presentation | Garbled or cut identity, ambiguous product name; cosmetic formatting recorded separately |
| Missing | An eligible tracked category on the current schedule is absent, or a separately identified variant is missing |

`MATCH` requires the full fee identity and applicable conditions to hold, not just a nearby matching number. A substantively garbled name is `BAD_NAME` and an error. Pure capitalization/style is a presentation note, not proof of a wrong fee; historical packets using a different convention retain their original labelled score. An unsupported row is `NOT_IN_SCHEDULE` only after the applicable source was adequately examined; inability to inspect it is `CANT_VERIFY`. Record the evidence and reason, not a guessed correction.

For published units, let `C = MATCH`, `W = all identified wrong verdicts`, `U = CANT_VERIFY`, and `D = C+W+U`:

- Report conditional evaluated accuracy `C/(C+W)` and verification coverage `(C+W)/D`, with every count. It is not an all-published success rate.
- Also report known-right/all-published `C/D` and the logical missingness range `[C/D, (C+U)/D]`. This range is **not a confidence interval**; unknowns are never assumed to pass.
- Break these out by charter, asset tier, region, category and dollar/rate kind. Empty cells say no evidence; no macro-average substitutes for the pooled or design-weighted metric. Distinguish strict full-record correctness from any optional amount-only/economic diagnostic.

For missing categories, keep one `MISSING` finding per institution/category, separately from missing variants. During the same whole-schedule read, retain a category-presence ledger: expected on the applicable source, correctly represented, present-but-wrong, absent, not applicable, or unresolved. Correct category coverage is `correctly represented expected categories / all expected eligible categories` among fully resolved sources. A category with a wrong published row is not automatically correctly represented. The denominator includes both represented and missing eligible categories; it is neither the missing count alone nor `50 categories × 50 institutions`. “No published fee” is not “free”; an explicit $0 price is a fee observation.

Fee-instance recall additionally needs a complete expected-fee inventory with product/audience/variant identity and a one-to-one match to correct published units: `correctly represented expected fees / all eligible expected fees`. A count of absent categories cannot provide that denominator. Where the existing whole-institution evidence lacks that complete inventory, report missing counts/category coverage and **fee recall unavailable**; do not ask James for another inventory exercise. Unresolved source applicability makes the corresponding recall denominator unknown. Report resolved-source coverage and never present that subset as whole-population recall. The upper published-error bound in section 4 does not bound absent fees or certify recall.

## 4. Conservative institution-cluster confidence bound

For a fresh, documented design and reconciled target inventories, use the following finite-population bound. It allows arbitrary dependence among a bank's fees and arbitrarily unequal bank sizes. It is deliberately conservative under the fixed 50-institution workload; a wide interval or “insufficient evidence” is an acceptable result. Never treat approximately 750 fees as 750 independent trials or use an all-correct bootstrap returning `100%–100%`.

The 95% coverage concerns **sampling uncertainty conditional on the fixed reconciled population and valid current-source adjudications**. It does not quantify systematic checker/auditor mislabelling or undiscovered document/applicability errors. Ambiguous labels remain `U`. Independent source evidence and review protect label quality; the confidence formula cannot make unreliable ground truth trustworthy or certify the absence of systematic error.

For each nonempty eligible stratum `h`, with population `N_h` and original selected sample `S_h` of size `n_h`:

- `w_i`, `u_i` are known-wrong and unresolved counts among the frozen `m_i` published units. An unreviewed selected institution has `u_i = m_i`; do not drop it from `n_h`.
- `d_h` is the number of selected institutions with at least one **known-wrong** unit.
- `b_h` is the number with at least one known-wrong **or unresolved** unit, so `d_h <= b_h <= n_h`. Fully verified, all-correct institutions have neither flag.
- Fix `alpha = 0.05` and `alpha_h = alpha/H` before looking at results, where `H` is the number of nonempty eligible strata, including zero-allocation cells. Other allocations are permissible only if fixed in advance and their sum is at most `0.05`.

For hypothetical population count `k` of institutions with any wrong published unit, the number sampled is hypergeometric. Its lower tail is:

The without-replacement probability and support follow the [R stats hypergeometric reference](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/Hypergeometric.html). The stratified tail inversion, simultaneous error allocation and largest-cluster row budget here are **our derived conservative protocol**; that reference does not establish this entire procedure.

```text
F_h(b; k) = sum[j=max(0,n_h-(N_h-k)) .. min(b,n_h,k)]
             choose(k,j) choose(N_h-k,n_h-j) / choose(N_h,n_h)
K_h = max { k in 0..N_h : F_h(b_h; k) >= alpha_h }
```

Invert this monotone tail, with exact integer/rational comparisons or verified stable numerics. For `n_h=0`, set `K_h=N_h`; for a census `n_h=N_h`, it becomes `K_h=b_h`. This is an upper confidence bound on the number of bad institutions. Using `b_h` instead of the unknown true observed bad count is conservative by monotonicity. The union bound gives simultaneous coverage at least 95% across strata; independence of fee rows is not assumed.

Let `c_h = min(N_h-n_h, max(0, K_h-d_h))`. Select the `c_h` **largest unsampled institution row counts** in that stratum. Then:

```text
E_h_upper = sum[i in S_h](w_i+u_i) + sum[largest c_h unsampled i](m_i)
E_upper   = sum[h](E_h_upper)
T         = sum[all institutions in the declared target](m_i)
A_lower   = max(0, 1 - E_upper/T)
A_upper   = min(1, 1 - sum[selected i](w_i)/T)
```

Subtract `d_h`, **not `b_h`**, when budgeting unseen bad institutions: an unresolved sampled institution might actually be correct and cannot consume one of the population's true bad institutions. The formula also conservatively treats all unresolved sampled rows as wrong. All unobserved fees in the largest possible bad clusters may be wrong, so an institution-pass bound is never mistaken for a fee-weighted bound.

Report `[A_lower,A_upper]` as an **at-least-95% conservative confidence set for published-fee accuracy**, with a one-sided simultaneous 95% lower bound and a logical upper endpoint; it is not an equal-tailed interval or a point estimate. Print the population, cutoff, `H`, allocations, unresolved counts, numerator/denominator, method and limitations beside it. Round outward only for display; compare the unrounded lower bound to `0.995`. A target can be supported only for its explicitly declared population when `A_lower >= 0.995` and all design/inventory/evidence prerequisites hold. This does not establish missing-fee recall, whole-index accuracy or completion of the other launch gates.

For a whole-index claim, add every excluded institution's published row count as potentially wrong, and add those rows to `T`; preserve eligible-stratum bounds. Zero-allocation cells already contribute their entire row mass. If excluded counts are unknown, the original frame is unavailable, historical probabilities are unknown, or population row counts fail reconciliation, report **population confidence unavailable** rather than inventing a weight, interval, narrower target or zero-error result. A protocol-valid all-correct sample from a larger population retains uncertainty; only a fully verified census could eliminate sampling uncertainty.

### Reproducible synthetic examples

These are mathematical examples, not production measurements. Every example uses exactly 50 selected institutions except the explicitly zero-sampled cell. All rows are reconciled, all selected rows are correct unless stated, and the target is only the shown frozen eligible population.

| Example | Frame and sample | Bound calculation | Published accuracy confidence set |
| --- | --- | --- | --- |
| Equal clusters | One stratum, `N=100`, `n=50`, 10 rows each, no errors/unknowns | `K=4`; `E_upper=4×10=40`; `T=1000` | `[96.00%,100%]` despite a 100% sample score |
| Unequal clusters | Same draw; selected 50 have 10 rows each; unsampled four have 1000 each and 46 have 10 | Same `K=4`; `E_upper=4000`; `T=4960` | `[19.35%,100%]` rounded outward; the institution bound did not change |
| Two strata | Each has `N=100`, `n=25`, 10 rows each; `alpha_h=.025` | `K=11` in each; `E_upper=220`; `T=2000` | `[89.00%,100%]` |
| Unresolved sources | One stratum, `N=100`, `n=50`, 10 rows each; ten selected sources wholly unresolved, others correct | `b=10`, `d=0`, sampled `u=100`, `K=28`; unseen budget `28`, not `18`; `E_upper=380` | `[62.00%,100%]` |
| Zero allocation | A cell has `N=20`, `n=0`, 10 rows each | `K=20`; all 200 rows potentially wrong | Its own range is `[0%,100%]`; add its mass when bounding a larger target |

For comparison only, 50/50 error-free **independent institutions** under an unstratified binomial model have an exact two-sided 95% institution-pass interval lower endpoint `0.025**(1/50) = 92.8878%`, obtained by exact binomial tail inversion as described by [NIST](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm). NIST distinguishes one-sided and two-sided limits. This is a different estimand/design, not a fee-level interval, not the finite-population calculation above, and not evidence of meeting 99.5%.

Run this standard-library calculator locally to reproduce the table; it neither draws a sample nor accesses any service:

```python
from fractions import Fraction
from math import comb

def upper_bad(N, n, b, H=1):
    assert 0 <= b <= n <= N and H >= 1
    alpha_h = Fraction(1, 20 * H)
    denominator = comb(N, n)
    def admitted(k):
        numerator = sum(
            comb(k, j) * comb(N-k, n-j)
            for j in range(max(0, n-(N-k)), min(b, n, k)+1)
        )
        return Fraction(numerator, denominator) >= alpha_h
    low, high = 0, N
    while low < high:
        middle = (low + high + 1) // 2
        if admitted(middle):
            low = middle
        else:
            high = middle - 1
    return low

def bounds(N, n, b, d, sampled_wrong, sampled_unknown, unsampled, T, H=1):
    assert len(unsampled) == N-n and 0 <= d <= b
    K = upper_bad(N, n, b, H)
    c = min(N-n, max(0, K-d))
    E = sampled_wrong + sampled_unknown + sum(sorted(unsampled, reverse=True)[:c])
    return K, E, Fraction(T-E, T), Fraction(T-sampled_wrong, T)

assert bounds(100, 50, 0, 0, 0, 0, [10]*50, 1000) == (4, 40, Fraction(24,25), 1)
assert bounds(100, 50, 0, 0, 0, 0, [1000]*4+[10]*46, 4960) == (4, 4000, Fraction(6,31), 1)
assert upper_bad(100, 25, 0, H=2) == 11
assert 1-Fraction(2*11*10, 2000) == Fraction(89,100)
assert bounds(100, 50, 10, 0, 0, 100, [10]*50, 1000) == (28, 380, Fraction(31,50), 1)
assert bounds(20, 0, 0, 0, 0, 0, [10]*20, 200) == (20, 200, 0, 1)
assert upper_bad(100, 50, 50) == 100  # every selected cluster potentially bad
assert bounds(3, 3, 1, 1, 2, 0, [], 30) == (1, 2, Fraction(14,15), Fraction(14,15))
print("Five synthetic confidence examples verified; no production result computed.")
```

## 5. Correction, paired retest and closure

1. Lock the original draw, full inventory, schedule snapshots, applicability cutoff, metric/checker versions, complete verdict ledger and original summary. Corrections to an audit label are append-only revisions with evidence and before/after counts; do not rewrite the historical baseline or silently change its denominator.
2. The data quality lane reconciles each finding to stable row/source/semantic identity and records the evidence, error class, affected population, owner and existing issue/feedback link. Magellan owns wrong/current-source/effective-date discovery; Rosetta owns text/layout/unit loss; Knox owns extraction and conditions; Darwin owns validation/classification; Hamilton owns publication, copy identity and customer displays. Ambiguous labels remain candidates/unresolved. Reuse the weekly evidence and any bank-level confirmation; no extra James confirmation is requested. A model or the failing validator alone cannot establish ground truth.
3. Fix the producing rule/process before output correction. Turn the frozen example into a fixture; a used case becomes regression evidence, not an untouched holdout. Require a meaningful before/after reproduction, exact-head tests and existing review/CI. Check applicable siblings/adversarial cases so a fix does not erase legitimate variants. A pass from the same validator is not independent data-quality proof.
4. Predefine the affected-institution cohort and expected movement. Under existing operational controls, the owning lane performs a bounded reprocess/canary and compares the same frozen cases, including all misses/unknowns and missing categories. Capture source → raw → verified → published identity and resulting public/API output as applicable. A one-off output correction comes last. This document authorizes no production change, provider activation or takedown.
5. Retest against the **same applicability cutoff and unchanged ground truth** to attribute improvement to the fix. Preserve the original cases and record the new run/commit/row lineage separately. If a schedule, product or effective date changed, report source drift and a separate current-state result; do not call the cases paired. A changed scoring rule starts a new series or is replayed separately on both frozen outputs; it is not credited as data improvement.
6. Keep the finding open until its cause fix, scoped output validation and durable regression/replay evidence exist, or record the specific unresolved blocker. A merged PR or increased support score alone does not settle the miss. Later fresh weekly draws provide new measurement; a repair retest or repeat of W43 is not a new random sample and is never pooled as independent evidence. James's only recurring check remains the same 50-institution weekly batch.

## 6. Explain the historical discrepancy without inventing attribution

| Evidence | What it supports | What it does not establish |
| --- | --- | --- |
| [#1923](https://github.com/Gilmore3088/FeeInsight.com/issues/1923): Oct 18 `92/148` and `146/231` | Reported live-check proportions **62.16%** and **63.20%** | A random population estimate, known cluster probabilities, or a row-by-row reconciliation with Oct 13 |
| [Oct 13 checkpoint](../project/checkpoints/2026-10-13.md): `199/200 = 99.5%`; five-audit `944/1000 = 94.4%` | Historical automated stored-copy results; product-page evidence misses fell from 19 to zero under the new rule | That the corresponding data were fixed, or that the rule change explains the entire gap across different draws/dates |
| [Fresh audit](../../src/lib/agents/deming/fresh-audit.ts), [source trace](../../src/lib/agents/hamilton/source-check.ts) | It samples published dollar rows, uses stored normalized text and overlaps the checks used by publication; it cannot count absent fees | Independent confirmation of the current official schedule, complete conditions/effective dates or missing-fee recall |
| Live findings [#1908](https://github.com/Gilmore3088/FeeInsight.com/issues/1908), [#1910](https://github.com/Gilmore3088/FeeInsight.com/issues/1910), [#1911](https://github.com/Gilmore3088/FeeInsight.com/issues/1911), [#1912](https://github.com/Gilmore3088/FeeInsight.com/issues/1912), [#1915](https://github.com/Gilmore3088/FeeInsight.com/issues/1915) | Documented payroll/product/audience errors, repeats, superseded/future schedules and wrong classifications; concrete mechanisms the narrow support score may miss | Their prevalence in either historical draw or a numerical decomposition of the difference |
| [#629 key audit](https://github.com/Gilmore3088/FeeInsight.com/issues/629#issuecomment-6246011208), [#1862](https://github.com/Gilmore3088/FeeInsight.com/issues/1862) | Ten shortest keys contained wrong rows/documents; reference-key precision/recall is also not independent truth | That key errors caused the fresh-audit 99.5% figure, or that all answer keys have the observed error rate |

Different cohorts, times, current-versus-stored sources, eligibility, rates, conditions, names, missingness and scoring definitions explain why these are different measurements. Shared validators and stored documents are proven structural limitations; how many historical misses each limitation caused is **unquantified**. Do not attribute the whole discrepancy to staleness, a particular classifier or a sampling imbalance without matched-row evidence.

The original `/mnt/project-files/hamilton-redesign/release-matrix-oct18.md` and Oct 18 CSVs referenced by the issues were not available in the local repository; connected Drive searches did not locate them. Preserve their issue-reported counts as secondary evidence. Other issue text says 65.2%, and the existing local weekly guide attributes 65.2% to a nonrandom 15-institution/224-row baseline. These labels are not silently reconciled into `146/231` or treated as the same denominator. No raw historical probabilities or revised verdicts are invented.

A later, separate local receipt is `Weekly Review/results/2026-W43/catalog-audit-20261018T232500-0700/REVIEW-REPORT.md` and its `combined-fee-review.csv`/`summary.json` in the primary workspace. Recalculation gives 50 institutions, 947 unique published fees (929 dollar/18 rate), 604 MATCH, 278 errors and 65 unresolved: `604/882 = 68.48%` conditional, `604/947 = 63.78%` known-right, logical range `63.78%–70.64%`. The 254 MISSING records are **absent categories**, not an expected-fee denominator; the 62 extra panel appearances are shared audience copies, not extra independent fees. W43 counts `BAD_NAME` as an error. Preserve that definition and its original score.

That report correctly claims no population confidence interval. The original W43 seed/draw timestamp and complete prior history are unavailable; its October 25 scheduled repeat is not a fresh independent draw. Do not attach this plan's confidence formula retroactively or relabel the later W43 score as the earlier 62–63% check. The local receipt records prior source checking; this documentation change has not re-fetched banks or re-adjudicated its labels.

## Acceptance and execution boundary

#1923 is satisfied by this written protocol: fixed 50-institution sample/strata, explicit error classes, denominators and confidence reporting, correction/retest rules, and an evidence-limited reconciliation of the scores. Closing it closes the **planning task**, not the live-data findings or launch gate. The existing untracked preparation/capture tools are evidence and a workflow reference; this PR neither imports nor changes them and does not claim the new statistical reporting/ledger fields are already automated. Protocol execution must satisfy the prerequisites or report the stated limitation. There is no new scheduled task, runtime code, production action or additional James workload.
