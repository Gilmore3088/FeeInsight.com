# 2026-10-19: stale nonwire keys cannot negate positive own international wire scope

**What happened:** Root review found #2368 in the unwired #2278 final verification
helper. The current raw name and full source prove an international outgoing wire $45,
but both its old raw hint and selected final key are `minimum_balance`. Existing refile
rules preserve that key. A pure OLD-red returned `not_applicable` before reading the
positive source-owned clause. No production exposure or integrated verifier is claimed.

**Cause:** Two negative category values were treated as proof that source applicability
was irrelevant. A stale classification cannot negate a positive actual physical clause.

**Change:** A bound current source is inspected even when both keys are nonwire values.
Only literal own international wire/transfer wording identifies this additional uncertainty;
it never supplies a new price or category. Unrelated International Money Order remains
outside this wire policy. Ordinary unavailable-source behavior remains a separate limit.

**Lesson:** Applicability needs both the final existing decision and positive current source
facts; an early negative-key exit cannot certify that no affected facts exist.

**Guard:** Preserve the full Family PDF OLD-red and green pure controls, actual common
direct-verification stale-key proof, current raw hold/judgment races and ordinary controls.
The final writer consumes the shared held factual source context and original matcher;
caller source text and identity stamps are not source authority. No replay or history change.
