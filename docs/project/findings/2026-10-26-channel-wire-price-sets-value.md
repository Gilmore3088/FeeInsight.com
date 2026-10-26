# 2026-10-26: an online or phone wire price pulled the bank's wire value
**What happened:** many banks print a general wire price beside a channel-qualified one. Bank OZK
(institution 56) lists "Outgoing Wire (Domestic)" at $30 and "Outgoing Online Wire (Domestic)" at
$20; Texas Capital Bank (69) lists "Domestic Outbound Wires (Manual)" at $35 and "(Online)" at $12.
Statistics rule 11 takes the median of an institution's rows in a category and set aside only rows
priced for a named product, so these banks' wire values were $25 and $23.50: a blend of two
channels, not the price the bank states for a wire (#1912).

**Cause:** rule 11 (`fee-product.ts` `isProductException`) read only `account_product_type`. A
channel is in the fee name ("Online", "PIN", "Fax Request", "Repetitive"), never in the product, so
no channel row was ever an exception.

**Fix:**
- Statistics method 25 (rule 11): in the four wire categories, a row whose fee name names a channel
  or a set-up-in-advance wire is an exception (`wire-channel.ts` `namesWireChannel`, SQL twin
  `wireChannelSql`; `isProductException` takes the name as an optional third argument and
  `productExceptionSql` reads `fee_name` by default). It is set aside only when the bank states a
  general row in that category; with none, every row counts as before. Rows stay live and listed.
- Channel words: online, digital, mobile, internet, e-banking/EBANK, eBranch, electronic banking,
  electronically submitted, web/website, self-service, phone, telephone, fax, email, PIN, template,
  repetitive, recurring, standing. "In branch", "in person", "manual", "assisted", "representative",
  "teller", "non-recurring", "non-repetitive" and "not initiated online" name the standard channel,
  so a name that carries one is general even when it also names a channel ("Outgoing Domestic Wire
  (Phone/Branch)", "(In Person/By Fax/Email)").
- Left out: "treasury", "cash management" and "TM" (a business service: an audience matter for
  rule 6, not a channel; 13 live wire rows carry them, 10 marked "both" audience), "app" (abbreviates
  approval or application; "Mobile App" already says mobile), "module" (one vendor's word) and a bare
  "electronic" (a wire is an electronic transfer: "ELECTRONIC FUND TRANSFERS: Outgoing Consumer
  Domestic Wire" is a heading over the general price).
- `fee-revenue.ts`'s `eligible_fee_rows` now carries `fee_name`; every other reader already reads the
  catalog, which has it.

**Dry run** (prod, read-only, Oct 26, the final SQL twin through `institutionValueSql` over the
statistics row filter): 107 live wire rows name a channel. 76 institution values change:

| Category | Values that change | Up | Down | Mean change |
|---|---|---|---|---|
| wire_domestic_outgoing | 49 of 2,580 | 45 | 4 | +$4.43 |
| wire_intl_outgoing | 26 of 1,713 | 22 | 4 | +$5.25 |
| wire_domestic_incoming | 1 of 1,674 | 0 | 1 | -$1.00 |
| wire_intl_incoming | 0 of 461 | 0 | 0 | |

Samples: PNC (8) domestic outgoing, two Self-Service rows at $25 and two Agent-Assisted at $30,
$27.50 to $30; Bank OZK (56) $25 to $30; Texas Capital Bank (69) $23.50 to $35; Arvest (78)
international, "Outgoing Wire: PIN" $40 beside "Outgoing Wire: Branch" $60, $50 to $60; Unity Bank
(440) domestic, "Fax Request" $50 beside the general $25, $37.50 to $25. In 19 institution-category
groups every row names a channel, so nothing is set aside there.

Two of the nine values that fall rest on rows filed in the wrong category, not on this rule: Apl FCU
(5413) has "Foreign Wire Reject" ($25) under international outgoing, and Access FCU (4965) has
"Change of Personal Identification Number (PIN)Wire Transfers (incoming)" ($2) under domestic
incoming. They are categorisation errors for Darwin's category guard.

**Lesson:** a bank's wire value is its general wire price; an online, phone, fax, PIN or repetitive
wire price beside it is an exception, and "in branch" or "manual" is the general price.

**Agent lesson:** hamilton/issue-1912-channel-wire-is-an-exception
**Guard:** `src/lib/wire-channel.test.ts`, `src/lib/fee-product.test.ts`, `src/lib/data-store/fee-stats.test.ts`, `src/lib/data-store/product-exception-value.db.test.ts`
