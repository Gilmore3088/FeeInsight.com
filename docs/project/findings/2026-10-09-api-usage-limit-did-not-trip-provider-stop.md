# The Console usage limit did not trip the provider stop, and the verdict score starved

Date: 2026-10-09. Thread: Darwin.

## What happened

At 08:11 UTC every Anthropic call began failing with a 400:
`You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.`
By 09:23 the attempt ledger held 23 `extract.paid`, 57 `verify.adjudicate` and 21
`verify.release_review` failures (`http_other`). Knox's paid extraction and Darwin's reviews
produced nothing, while `extract-paid` and `verify-paid` steps kept firing every five minutes
against the dead key, because the provider circuit's billing phrases
(`PROVIDER_CREDIT_ERROR_MARKERS`) knew only the credit-balance wording. The admin "Mark billing
resolved" button matched the same phrases, so once the limit is raised there would have been no
button to resume from.

Separately, UAT asked why `verify.verdict_score` had not recorded a chunk since 2026-10-08 13:13.
Not the schedule and not `DARWIN_RELEASE_ACTS`: scoring runs inside every `verify-paid` step and
records a chunk only when 20 key-decided verdicts on keyed banks have accumulated, per review and
per prompt version. The release review went v11 to v17 in a day and each version collected 13 to
18 keyed verdicts before the next bump; adjudicate v2 had 10. No version ever reached 20.

## Fix

- The usage-limit wording joins `PROVIDER_CREDIT_ERROR_MARKERS`, so the circuit engages the global
  provider stop and the step summaries say why; the stop reason names the matched phrase. The admin
  control's billing match and `classifyAgentFailure` take the same wording.
- A review version below the newest one seen gets no more verdicts, so its open chunk is now closed
  as a partial chunk (`partial: true`, with `decided`) instead of waiting forever. Full chunks are
  unchanged; a partial hit rate is read with its n.

## Lesson

A provider refusal that stops every call is a billing failure whatever the Console calls it; the
circuit matches the message text, so each new wording must be added when first seen. A metric gated
on a count per prompt version starves when the version moves faster than the count fills.
