# Numerical matches do not establish answer confidence

Reviewed base: `1b5de13cd5b2e61ff6ca64047222b6c90888d39b`.

## Finding

`src/lib/hamilton/figure-check.ts` compares the magnitude of narrative dollar
amounts and percentages with a pool of payload values and arithmetic differences.
It does not bind a figure to an institution, fee category, reporting period,
source, or direction of change. `confidenceFromFigureCheck` nevertheless returned
`high` whenever every parsed figure matched that pool.

Synthetic reproductions (not claims about production answers): a $35 fee for Bank
B can qualify a statement that Bank A charges $35; the $25 difference between $35
and $10 can qualify as an actual fee; -10% can qualify as an increase of 10%; a fee
from 2024 can qualify in a statement about 2026. All four receive a numerical match.

## Containment in this patch

Never award high confidence solely from this check. Preserve low confidence for
unmatched figures. Use the existing medium rating for numerical matches and
number-free prose, with an explicit explanation that claims remain unverified.
This keeps the saved-answer schema compatible and applies at the existing browser,
server-save and memo-save call sites. No matching math, fee data, model prompts,
permissions or database schema is changed.

Regression tests cover the four false-attribution examples, valid numerical
matches, unsupported figures, qualitative prose and an inconsistent stored check.
The written-answer save test now checks the reduced rating and its limitation.

## Still required

This is containment, not a semantic fact checker or a consulting-readiness signoff.
Bind future validated claims to institution, category, unit, period, source and
explicit derivation. Dates, direction and attribution need their own checks.
Existing stored confidence ratings are not rewritten by this change. Other paths
that assign confidence independently must be audited separately.

The current Ask audit panel also needs its overbroad source/identity wording
corrected. The broader Hamilton work remains: account-versus-subject context,
peer-list intent with asset dates, one conversation composer, consistent answer
presentation and a durable admin correction workflow. Do not mark these complete
because this confidence patch has landed.
