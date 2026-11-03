# 2026-11-03: A re-read that names a line's product differently goes live beside the old row

**Lesson:** A product name is the extraction's reading of a line, not part of the line's identity: two
reads of one printed line are one fee whatever product each carries, and the bank's page decides
whose product stays.

**What happened:** Re-read backlog dry runs 3 and 4 (Knox v169 and v170 over the oldest current texts
behind live fees, Nov 3) both found the same duplicate. When Knox re-read a page and its lineup named a
different product for a line (or none) than the live row of that line, the re-read would have gone live
as a new fee and the old row would have stayed:

- Polish & Slavic FCU, doc 41770 (older copy 16124): "Plus Business Checking (monthly, if average daily
  balance below $10,000) | $10.00" re-read under "Plus Business Checking", live #94866 under none;
  "Monthly Fee | $0.00" and "Minimum Balance Fee | $0.00" re-read under their heading
  "Savings/Checking Accounts", live #49397 and #49398 under none.
- Cvph Employees FCU, doc 41763 (older copy 32080): "Monthly Fee for Draft Checking Accounts…..$1.00"
  re-read under no product, live #141419 under "Demand Deposit Account", a rates heading further down
  the page.
- MutualOne Bank, doc 41984 (older copy 40689): "Monthly Service Charge | None" ($0) re-read under its
  heading "Free Business Checking Plus", live #73214 under none.
- Cambridge Savings Bank, doc 42199: live #104221 ($10) carries "Performance Plus", the heading of the
  $20 line above it. This is not the same shape: the page prints "Monthly Maintenance Service Charge |
  $10" twice, under Performance Checking and under the money market account, so two $10 fees are real.

**Cause:** Every identity check after Knox compares the product exactly. `decidePriorFee`
(`src/lib/agents/hamilton/publish.ts`) and `selectLivePublishedFees` read only the live rows of the
row's own product, so a re-read under another product found no live line and was "new". The exact and
page-copy collapses, the same-line read (#1876) and Darwin's stale-copy twin check
(`darwin/stale-copy-check.ts`) also need the same product, so nothing later closed the old row either.

**Fix:** `src/lib/agents/hamilton/product-split.ts`, one rule used by publish and by Darwin:

- A row and a live fee are one line read twice when they share the institution, category, variant and
  dollar amount, have different products, come from one page (the same document, or a copy of the same
  page in the same stream), and have the same stored line once punctuation is folded away
  ("Accounts…..$1.00" is "Accounts $1.00"). That line must print exactly once in the newer document's
  stored text and print the amount once (a $0 line may print no figure, "| None"), and the frequencies
  must not differ. A line printed once per account (Cambridge's $10) is a real per-product price and
  stays two rows.
- Whose product stays: a read from an older copy than the live fee never wins. Otherwise the product
  named on the line, or on the nearest heading above it, wins. A heading here is a short line with no
  price or table cell, within 12 non-blank lines of the fee. A product named nowhere above the line counts
  as none (Cvph's "Demand Deposit Account"). On a tie the newer read wins. "The newer read wins" on its
  own was wrong on 2 of 5 sampled live pairs: re-reads that had lost "Bank of Commerce Super NOW Account"
  and "Infinity Checking", the headings right above their lines.
- Publish: when the row would be new, `selectProductSplitTwin` reads the live rows of other products.
  If the row's product wins, the row supersedes the live row. A same-amount supersede now records no
  price change in `fee_change_records`. If the live row's product wins, the row is refused ("Same printed
  line as live fee #N under another product"). Counted each step as `product_split_check`.
- Darwin: `darwin/product-split-check.ts` reads the pairs already live, on one document or on an older
  copy and its current copy (`superseded_by_id`), with the same rule. The loser comes down on its second
  look as `same_line_duplicate: live fee #<kept>`, so Hamilton's same-line restore brings it back if the
  kept fee goes. A fee is never kept behind one the same pass takes down.
- Both sit behind `PRODUCT_SPLIT_MERGE_LIVE`, which is off. Publish and Darwin only count until a sampled
  dry run turns it on.

**Before and after (dry runs 3 and 4):** before, all six live rows above decide as "new" against the
re-read, so each line would go live twice. After, Polish & Slavic #94866, #49397 and #49398, Cvph #141419
and MutualOne #73214 each pair with their re-read, and in all five the re-read's product wins: the
re-read supersedes the live row and one row stays. Cambridge #104221 is left as it is (line printed
twice). Its wrong product is Knox's heading choice, which is still open.

**Dry-run count (prod, read-only, Nov 3):** 119 live pairs share a folded line, institution, category,
variant and amount under different products (103 on an older copy and its current copy, 16 on one
document). Of these, 71 meet the rule. 38 sit on two copies whose page keys differ, 7 have a line that
the current text does not print exactly once, and 3 do not print the price exactly once. With losers
counted once and none kept behind another loser, 65 live fees at 49 institutions would come down. In 46
the row with no product comes down behind a named one, in 11 one named product comes down behind
another, and in 8 a named product comes down behind a row with none. The line distances were measured
in SQL with the same heading rules, then fed to `findProductSplits`. Of 14 pairs checked by hand against
the stored text, all 14 were one printed line live twice. The kept product was right in 11. In one, "no
product" was kept over "Value Checking", but the line sits under "Classic Checking", so neither was
right. Two were unclear: "Checking" kept over none for a general "Below Minimum Balance fee", and none
kept over "First Class Checking", whose heading is not near the line.

**Not changed:** Knox's product choice itself, including Cambridge's heading pick. The 38 pairs whose
copies moved to another address are left alone.

**Guard:** `src/lib/agents/hamilton/product-split.test.ts`, `src/lib/agents/darwin/product-split-check.test.ts`, `src/lib/agents/darwin/product-split-check.db.test.ts`, `src/lib/agents/hamilton/publish.test.ts` ("merges a re-read of a live fee's line under another product")

**Agent lesson:** hamilton/publish-product-is-not-line-identity
