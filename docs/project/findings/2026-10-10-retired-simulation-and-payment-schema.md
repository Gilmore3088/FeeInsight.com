# Retire the superseded simulation UI and archive misleading payment SQL

R08 / issue #983. The current `/pro/simulate` route imports the memo interface and
current fee-scenario engine. The retired component family has no external runtime
references (one explanatory comment in the shared engine names its former display).
Removed that isolated family and its two UI-only test files. Current calculation,
memo, scenario-action, and API tests remain.

A route contract guards the memo entry point, both saved-scenario URL aliases,
user-scoped saved lookup, API preservation, and the answer-key gate. This is not
removal of the simulation feature or its saved data. No page layout was changed.

The old `001-payments.sql` is preserved verbatim under `docs/archive/legacy-payment-schema/`
with a do-not-execute warning. The canonical migration directory is unchanged.
Static reference review and tests are evidence of repository behavior, not a live
production data certification.
