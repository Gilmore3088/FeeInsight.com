# The full fee-category detail passes Next's 2 MB cache limit for the largest categories

**Found:** 2026-10-16, building the /fees explorer (PR #1652) and the guides rebuild.

`getFeeCategoryDetailCached` caches every published row of a category with its conditions,
source address and breakdowns. For the largest categories the entry is over Next's 2 MB limit per
cache item: monthly maintenance came to 2,255,533 bytes and NSF to 2,298,344 bytes in a local
render against a recording of prod's rows. Next refuses the write ("items over 2MB can not be
cached") and logs an unhandled rejection, so every request re-runs the full read. The NSF guide
was one of those pages.

**Fix (guides):** guide pages read `getFeeCategoryGuideDetailCached`, which caches only what a
guide uses: the charter, size and state breakdowns and one value per institution. The /fees
explorer (#1652) reads its own lean rows (`getIndexRows`). Other readers of the full detail
(`/fees/[category]`) still pass the limit for these categories; trimming that read is open.
