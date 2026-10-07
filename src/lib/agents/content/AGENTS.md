# Hamilton content

The content workflows from the 3-month content plan (Oct 7, 2026). Each one drafts LinkedIn
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

## Rules

- Institutions are never named on a card or in a caption; posts name markets.
- Wording: "lower" and "higher"; never advise a fee change; never say what Hamilton can't do.
- Brand: Fee Insight publishes (card header), the Bank Fee Index is the source (footer), and
  Hamilton is the product. Never write Fee Insight and Bank Fee Index side by side as one name.
- No fee-change ("fee moves") content: James, Oct 7 2026. Changes in the catalog mostly reflect
  fees being loaded and re-read, not price moves.
