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

## Follow-up, Oct 25: the pages still came in upstream

Prod (read-only, Oct 25): no live fee matches the rule, but article pages kept arriving as
documents after #1777, because the step that let them in was Magellan's, not publish's. The
companion finder stored them as account pages by their link words (15 article companions on 8
institution records, TD on two, among them TD's two /learning/ pages and Keesler's advice article; Security First's 2022
blog post was stored again on Oct 18), and a read remembers the page it read, so the plain fetch
kept asking for SchoolsFirst FCU's advice article on Oct 18 and 19 instead of its saved link.
Knox's free read and Darwin then read and verified their fees again, and only publish refused
them. Magellan now applies the same rule there: the companion finder refuses such links, the
stored-companion review retires the 15 (no live fee), and the fetch sets aside a remembered
article for a saved link that is not one. Three banks whose saved link is itself an article
(Nelnet Bank, Fidelity, KEMBA) stay with the upgrade search.

**Agent lesson:** gutenberg/pr-1777-one-article-rule, magellan/issue-1774-article-never-a-source
