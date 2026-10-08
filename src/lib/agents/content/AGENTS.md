# Growth content

The content workflows from the 3-month content plan (Oct 7, 2026), run as agent `growth` under the
marketing pause (`../growth/AGENTS.md`). Each one drafts LinkedIn
posts into the content queue (`content_drafts`, reviewed at `/admin/customers/content`).
Nothing here posts or sends: James approves a draft, posts it on the Fee Insight company page
himself, then marks it posted.

## Run (cron `/api/admin/crew/content`, Sundays 13:37 UTC)

1. `content-market-spread` (free, no model): W1. For this month's theme fees (`calendar.ts`), it
   finds the metro where local banks and credit unions differ most and drafts a caption plus
   the numbers for its card (`/api/admin/content/card/[id]`).
   - Statistics follow the `fee-stats.ts` contract: sourced rows only, one value per institution
     (overdraft at its highest tier), and $0 counts.
   - Picks the widest middle half (p25 to p75), then the widest full range.
   - Refuses a metro with fewer than 10 institutions or a spread under $10, and skips a metro and
     fee drafted in the last 8 weeks (skipped drafts included).
   - Every number in the caption must be one of the spread's own figures or the date
     (`unbackedNumbers`).

2. `content-fee-depth` (free, no model): W3, every other week (skips when one was drafted in
   the last 10 days). Takes the next use case from `USE_CASES` (pricing committee prep, a new
   account launch, a competitor review, a board question, an annual schedule review) and the
   metro with the most full schedules (15+ fee types), at least 10 of them, not featured in 8
   weeks. The card is a competitor grid: the 8 fees local institutions publish most, each with
   its lowest, median and highest local value (5+ institutions each). Use-case copy is fixed
   text with no numbers; the caption's numbers pass `unbackedNumbers`.

Cards for both are drawn in `cards.tsx` from the draft's stored facts.

## Rules

- Institutions are never named on a card or in a caption; posts name markets.
- Every caption ends with the free-report call to action, "Get a free fee report:" and a tagged
  feeinsight.com/reports link (`freeReportLink`), not a link to a Hamilton page.
- Wording: "lower" and "higher"; never advise a fee change; never say what Hamilton can't do.
- Brand: Fee Insight publishes (card header), the Bank Fee Index is the source (footer), and
  Hamilton is the product. Never write Fee Insight and Bank Fee Index side by side as one name.
- No fee-change ("fee moves") content: James, Oct 7 2026. Changes in the catalog mostly reflect
  fees being loaded and re-read, not price moves.
