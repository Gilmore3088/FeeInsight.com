# Guide coverage decisions

Which fee categories warrant a consumer guide, and which deliberately do not. Companion
to [`guides-remediation-plan-2026-08-15.md`](./guides-remediation-plan-2026-08-15.md),
item E-2.

Coverage is a deliberate editorial decision, not a percentage to maximise. A guide is
worth writing when a consumer meets the fee, can act on it, and would be worse off
guessing. Categories failing any of those three do not need one, and saying so is more
useful than leaving them looking like a gap.

## Current state

**32 of 65 taxonomy categories cited across 13 guides (49%).** The remaining 33 are
classified below. Recompute with the `guides.test.ts` catalog and `FEE_FAMILIES`; do not
hardcode the figure anywhere in the app (see E-5).

## Covered

| Guide | Categories |
| --- | --- |
| `overdraft-fees` | `overdraft`, `od_daily_cap`, `od_protection_transfer` |
| `nsf-fees` | `nsf`, `nsf_daily_cap`, `deposited_item_return`, `overdraft` |
| `atm-fees` | `atm_non_network`, `atm_international`, `balance_inquiry` |
| `wire-transfer-fees` | `wire_domestic_outgoing`, `wire_domestic_incoming`, `wire_intl_outgoing`, `wire_intl_incoming` |
| `monthly-maintenance-fees` | `monthly_maintenance`, `minimum_balance`, `paper_statement`, `dormant_account` |
| `foreign-transaction-fees` | `card_foreign_txn`, `atm_international` |
| `check-fees` | `cashiers_check`, `stop_payment`, `money_order`, `check_printing`, `counter_check` |
| `digital-banking-fees` | `ach_origination`, `ach_return`, `bill_pay`, `mobile_deposit`, `zelle_fee` |
| `account-closure-fees` | `early_closure`, `dormant_account`, `account_research` |
| `safe-deposit-fees` | `safe_deposit_box`, `notary_fee` |
| Professional guides | `overdraft`, `nsf`, `monthly_maintenance`, `atm_non_network`, `wire_domestic_outgoing` |

`minimum_balance` and `paper_statement` were the two named in the audit as the most
glaring omissions — they are the waiver mechanics the maintenance guide tells readers to
use — and both are now covered inside `monthly-maintenance-fees` rather than as separate
guides, because a reader meets them while solving the maintenance fee, not on their own.

## Warrants a guide — not yet written

Ordered by consumer impact.

| Category | Why it earns one |
| --- | --- |
| `card_replacement`, `rush_card` | Everyone loses a card eventually, the rush option is sold under time pressure, and the free alternative is rarely mentioned |
| `late_payment` | High incidence, high dollar value, and there are real waiver and grace-period levers a consumer can pull |
| `check_cashing` | Falls hardest on people without an account at the paying bank — the readers with the fewest alternatives |
| `card_dispute` | Consumers routinely do not know a dispute is a right rather than a favour; the Reg E and Reg Z angles matter |
| `continuous_od`, `od_line_of_credit` | Currently a paragraph inside the overdraft guide. Deserve their own treatment if the overdraft guide grows past its word band |
| `coin_counting`, `cash_advance` | Moderate incidence, clear avoidance advice |

## Deliberately not writing a consumer guide

Not gaps. Recorded so nobody re-derives the question.

| Categories | Why not |
| --- | --- |
| Mortgage Servicing — `mortgage_modification`, `mortgage_payoff`, `mortgage_lien_release`, `refinance_fee`, `reconveyance` | A different reader in a different transaction, mediated by a servicer and a closing process. Consumer advice here would be thin to the point of being misleading, and the fees are rarely comparison-shoppable |
| Retirement & IRA — `ira_administration`, `ira_termination`, `ira_distribution` | Overlaps investment and tax advice we are not positioned to give. Benchmark data is still published on the fee pages |
| Vehicle & Title — `vehicle_title`, `duplicate_title`, `dmv_filing` | Largely pass-through of state DMV charges. There is no meaningful consumer action beyond knowing the amount |
| `garnishment_levy`, `legal_process` | Charged during a legal action where the consumer has no choice and needs a lawyer, not a fee guide |
| `gift_card_purchase`, `prepaid_card_reload` | Adjacent products rather than account fees; a guide here would sit oddly beside the rest |
| `courier_delivery`, `document_reproduction`, `other_lending_fee`, `account_verification`, `check_image`, `night_deposit`, `estatement_fee`, `loan_origination`, `appraisal_fee` | Low incidence, situational, or no consumer lever. Covered by the fee index, which is the right surface for "what does this cost" without "what should I do about it" |

## Rule for adding one

Before writing a new guide, check three things. If any fails, the fee index entry is
enough.

1. **Incidence** — do ordinary consumers actually meet this fee?
2. **Agency** — is there something the reader can do about it?
3. **Data** — does `published_fee_catalog` carry enough observations for the guide's
   tokens to resolve? A guide whose figures render as em dashes should not ship, and
   `guides.test.ts` will fail it.

Every new guide must also clear the catalog invariants: 800–1,200 words, the mandated
sections, no hardcoded dollar figures, and no citation of a fee it does not declare.
