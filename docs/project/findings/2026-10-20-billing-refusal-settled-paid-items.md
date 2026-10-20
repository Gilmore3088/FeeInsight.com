# 2026-10-20: a provider billing refusal settled paid work for good
**What happened:** #1056 asks whether the paid read picks up every scan that free OCR cannot read.
On prod (read-only, Oct 20), 5 texts at 5 banks are still `needs_ocr`, down from 22 on Oct 12.
- 3 are new (Oct 15 to 19). Each is eligible and waits for its state's next lane run, since the
  paid read runs inside state lanes.
- 1 (U-1st Community FCU) was refused on Oct 5 with "Your credit balance is too low", recorded
  `http_other`, and never selected again.
- 1 (Allegany First FCU) was refused by the content filter, which is a real answer about that
  document.
Across all paid passes, 145 items were settled the same way by the billing outages of Oct 5 and
Oct 9: 88 Darwin adjudications, 29 release reviews, 23 Knox paid extractions and that 1 scan.
**Cause:** the provider answers a billing refusal with HTTP 400. Each paid pass classifies any
non-429/5xx status as `http_other`, which its selector treats as settled. The budget and emergency
stops were handled as stops; a billing refusal was handled as an answer about the item.
**Fix:** this PR. `paidModelCall` (`agents/paid-pass.ts`) turns a billing refusal
(`isProviderLimitError`) into `ProviderCircuitOpenError`, which every paid pass now treats as a stop:
no attempt is recorded and the item stays queued. The Rosetta paid read and four Magellan paid steps
now include that error in their stop checks. The four paid selectors that settle items (Rosetta paid
read, Knox paid extraction, Darwin adjudication and release review) ignore attempts whose error text
is a billing refusal (`providerRefusalSql`), so the 145 items return to their queues under the
existing per-run limits and budget caps.
**Still open (on #1056):** cost per scan on the scorecard.
**Lesson:** a refusal that describes the account (billing, quota) must never be recorded as a fact
about the item. Only an answer about the item settles it.

**Agent lesson:** rosetta/issue-1056-billing-refusal-is-not-the-scan
