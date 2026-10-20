# A fee link a person sets was never fetched (2026-10-18)

**What happened.** James set Texas Capital's fee link (institution 69) to its current Personal
Banking Fee Schedule PDF in the admin and pressed Extract. Run 8472 (05:40 UTC) fetched the old
services-fees page again (doc 37585), so the 32 legacy-account fees stayed live (#1880).

**Why.** Magellan's fetch reads `institution_source_profiles.canonical_source_url` before
`institution_sources.fee_schedule_url` (`magellan/fetch.ts`, `fetchCandidate`). `setInstitutionFeeUrl`
and `bulkSetInstitutionFeeUrls` changed only `fee_schedule_url`, and the extract run's
`params.fee_schedule_url` was never passed to the fetch step.

**Fix (#1881).** The admin fee-link commands also set the profile's canonical URL. A run that names
a `fee_schedule_url` (admin Extract) fetches it when it is the bank's saved link (a remembered spelling of the same page, such as `?print=1`, is kept), and the fetch
then remembers that address itself unless a correction locks the profile.

**Not done, and why.** "Always prefer the saved link" was rejected. The profile's address is often
a deliberate variant of the saved link, such as `?print=1`, the address with `:443` dropped, or a PDF
the saved page links to. Read-only on Oct 18: 1,181 active banks have a saved link that differs
from the remembered one, and 840 of those differ by more than scheme, `www` or a trailing slash.
`fee_schedule_url` has no change timestamp, so which side is newer can't be told from the data.

**Agent lesson:** magellan/pr-1883-requested-link-fetched
