# 2026-10-09: Business wire prices were shown as consumer wire prices
**What happened:** the public sample report (Ambler Savings Bank) showed 3Hill FCU's incoming
domestic wire at $20 (fee 28215). The schedule line is "Business Wire Transfer Incoming
(domestic) | $20.00", and 3Hill has no personal line next to it. About 40 live wire rows were
named for business, commercial or corporate accounts (read-only SQL, 2026-10-09).
**Cause:** the wire categories had no payer rule. NSF already excluded "business only".
**Fix:** guard v53 makes the four wire categories exclude a name that says business, commercial
or corporate and does not also say consumer, personal, retail or individual. "Business day" is
not a payer. Matching rows are flagged, get a 12h second look, then are archived. This PR.
**Lesson:** a consumer comparison needs the payer checked as well as the category.
