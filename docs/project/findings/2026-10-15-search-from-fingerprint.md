# 2026-10-15: a search's starting address landed on the do-not-retry list
**What happened:** Magellan's second-document finder recorded each bank's search with the bank's
current fee link as its fingerprint. The learning core put every `wrong_document` /
`no_candidates` outcome on the playbook's do-not-retry list, so the current link read as a known
failure. Read-only on prod at 2026-10-15: 3,258 such entries on 2,819 playbooks (2,385
`wrong_document`, 873 `no_candidates`; versions 1 to 4), 1,763 of them on the profile's current
source. 18 of the 53 playbooks at the 50-entry cap held 20 of them, taking slots from real failures.
**Cause:** the do-not-retry list assumes the fingerprint is the input the strategy judged. For a
search, the outcome means "found nothing better from here", not "this input is wrong". The finder's
monthly recheck reads the attempt log, so the list entry was never needed.
**Fix:** #1494. `rememberInputFailure: false` on the attempt keeps it off the list and drops that
strategy's older entries on the bank's next search. No version bump, so nothing re-runs.
**Lesson:** before giving a strategy a fingerprint, ask whether its failure is a verdict on that
input. If it is not, keep it off the do-not-retry list.

**Agent lesson:** magellan/pr-1497-search-not-input-verdict
