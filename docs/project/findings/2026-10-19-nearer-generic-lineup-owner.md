# 2026-10-19: lineup correction crossed a printed generic account boundary

**What happened:** #2269's actual Oakwood source first gives the $5 Savings fee the
printed `SAVINGS ACCOUNT` owner. The normal lineup-correction sweep then proposes the
preceding `MONEY MARKET ACCOUNT`. The retained full PostgreSQL projection applied that
change to an isolated fixture while its verified savings hold remained unpublished.
This is an ownership defect, not a new canonical-category change or public leak claim.

**Cause:** The producer recognizes a generic account kind, but the legacy correction
fallback continued to an older branded/type heading. Its nearby context could likewise
cross that generic heading and borrow another account's opening deposit, balance or waiver.
The display helper's rejection of an unbranded name was then treated as replacement
permission. That helper also rejects some real specific names, including `The Virginian`.

**Fix:** Track the nearer printed account-kind position as a context boundary, stop
look-down at the next such heading, and prefer that existing source owner in the legacy
correction fallback. The branded display helper stays unchanged. A newly preferred generic
fallback cannot displace a specific retained owner merely because the display helper
rejects it; genuine generic-owner, fee-caption, link and tagline corrections still work.
The existing RNB tagline fixture now repairs to the printed `Personal Savings` owner
instead of NULL. No SQL/writer/selector, rules version, v2 correction fingerprint or epoch
changes. Settled correction attempts are not reopened and no historical repair is claimed.

An offline comparison of the dated 3,794 published-monthly raw inputs against 2,475
hash-valid saved current texts changes 14 known-field proposals (32 before, 23 after).
Those are proposal differences, not a current eligible/due count or applied changes.
The frame excludes held/unpublished and minimum-balance populations, omits stored
opening-deposit values, and contains 150 original-hash differences plus 32 missing
original hashes/excerpts. All 14 changed proposals match their original source hashes.
No production census or mutation was performed; future replay needs its own impact review.
Stopping an unsupported further correction is not recovery of an already wrong owner:
the frame's retired Statement Savings caption, fragmented Performance table labels and
retained Bonus Checking name remain separate ownership limits. This patch does not infer
those missing owners or certify every retained stored value.

**Lesson:** A generic account kind is still a printed ownership boundary. A display-name
filter is not evidence that the stored source owner is wrong.

**Guard:** `lineup-nearest-owner.test.ts` binds the actual Oakwood text hash and covers
both boundary directions, borrowed balance/waiver/opening context, generic/branded and
specific retained names, fee captions, ambiguous repeats and genuine neighbor corrections.
The existing `monthly-account-owners.db.test.ts` now asserts Savings ownership after both
full normal publication cycles while preserving the savings hold and zero public additions.
