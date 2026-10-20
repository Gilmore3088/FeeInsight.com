# Article pages as fee sources: three article rules, one used at publish

**Found:** 2026-10-17, Data quality lane (#1774). Read-only on prod.

## What happened

Seven live fees at six institutions were read from an article, learning or advice page, not a fee
schedule: TD Bank's /learning/ article ("The amount for overdraft fees varies, but $35 each
occurrence is common", on both TD records, 64718 and 65872), Axos's /insights/ article ("The NSF fee
is typically around $35", 87961), Security First Bank's 2022 blog post (100835), Keesler FCU's
/advice/ page about investing apps (a third-party app's $1 monthly fee, 62573) and SchoolsFirst
FCU's /advice/ article (87960, 139509).

## Why

The codebase had three article rules:

- Magellan's `isArticleLink` (`magellan/link-coverage.ts`): blogs, articles, news, insights, press
  releases, stories, learning and education centers; spares fee-document names and PDFs.
- Hamilton's `isArticlePage` (`hamilton/article-page.ts`): articles, blogs, posts, stories, news;
  used by publish, the live re-check and Deming's audit.
- Rosetta's `isArticleUrl` (`learning/fee-page.ts`): news, press, investor relations, blogs; used
  when scoring a page.

None knew `/learning/`, `/advice/` or a dated blog path, and Hamilton's did not know `/insights/`,
so Magellan refused Axos's insights article as a fee link while publish put its NSF "fee" live.
Knox's paid read had no article check at all.

## Fix

Magellan's rule is now the one rule for Magellan's link check, publish (the read's own link or its
document's), Hamilton's live re-check and Knox's paid read (`articleLinkSql`). It adds learning,
advice, post and story folders and dated blog paths. "/learn/" and "/resources/" stay out: banks
keep real fee pages there (/learn/fees, /resources/fee-schedule). So do "what-is" pages: McClain
Bank's /what-is-bounce-protection- is its own bounce-protection disclosure. A verified
row skipped as identical to a fee the article check took down is decided again, so the bank's own
copy of the fee goes live in its place.

Rosetta's `isArticleUrl` still stands on its own (it adds press and investor-relations folders for
page scoring); folding it in is left for its owner.

## Numbers (prod, Oct 17)

- Live fees the widened rule takes down: 7 at 6 institutions; every matched address was read by hand.
- Distinct stored document addresses it matches: 41 (16 more than before); all 16 new ones are
  articles, learning pages or one learning-folder loan-rates page.
- Publish rows in the last 14 days it would have refused: 22 (16 more than before).
- Knox paid reads in the last 14 days it would have stopped: 6 of 3,680.
- Fee links Magellan now treats as articles: 6 institutions (4 more), among them TD Bank, whose
  saved fee link is a /learning/ article.

**Agent lesson:** gutenberg/pr-1777-one-article-rule
