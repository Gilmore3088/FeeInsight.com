# 2026-10-09: account names read from page text, and business fees in mixed schedules

**What happened:** The whole-record sample of 50 live fees (`audits/whole-record-sample-2026-10-09.md`)
found 3 records wrong on account or audience while their amounts were right:
- 101346 (ND, FIBT) published under the product "Learn more about Advantage Checking", a link label
  read as the account heading (raw 443152, document 23278).
- 100423 (WY, RNB) published under "For all customers with savings needs…", a tagline read as the
  account name (raw 437696, document 23073).
- 101925 (TX, Prosperity 61) "Business ATM/Debit Transactions, off premises" published as a consumer
  fee, read from one disclosure that lists consumer and business fees together.

**Cause:**
- Knox's lineup (`knox/lineup.ts`) took any short line before a fee block as the account name. It
  did not drop link lead-ins ("Learn more about", "Open a", "Features of") or a lower-case sentence,
  and the stored-row correction (`knox.lineup_correct` v1) only replaced a name when the page had a
  better heading, so a tagline with no heading above it stayed.
- Hamilton's business-schedule check (`hamilton/business-schedule.ts`) only knew a business fee from
  the document address (`/business-fee-schedule.pdf`). A mixed disclosure at a neutral address passed,
  so a fee whose own name starts "Business" or "Commercial" went live beside the consumer fee. On
  9 Oct 113 live fees were named that way from neutral addresses; 57 sat beside a consumer fee in
  the same category at the same bank, 101925 among them.

**Fix:** this PR.
- Knox lineup: link lead-ins and lower-case sentences are not account names; `knox.lineup_correct`
  v2 re-reads every stored copy, rewrites "Learn more about Advantage Checking" to "Advantage Checking",
  and clears a page sentence to no product when the page has no heading. Each change is a logged
  `lineup_corrected` row in `pipeline_feedback`, no deletes.
- Hamilton: a fee named "Business …" or "Commercial …" counts as business ("Corporate" does not: a
  corporate check is the official check a consumer buys). It goes through the same second look: flagged
  `takedown_pending` first, archived 12h later only if the consumer fee is still live, restored if the
  consumer fee goes. Only a business document teaches Magellan `wrong_document`; a mixed schedule is
  not a wrong link, so its lesson is the second look's `takedown_confirmed`, which Knox reads.

**Lesson:** a right amount is not a right record. Check the product and audience fields against the
page the way the amount is checked, and treat a field filled from page prose as unproven.
