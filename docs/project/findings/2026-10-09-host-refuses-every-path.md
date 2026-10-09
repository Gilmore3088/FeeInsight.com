# A bank whose host refuses every path we have

Found on 2026-10-09 while adding First Mid Bank & Trust (202, IL).

- **What happened.** The search index gave two disclosure PDFs. Both returned HTTP 404 to Magellan's fetcher:
  - `https://www.firstmid.com/wp-content/uploads/DepositDisclosures.pdf` (run 3345)
  - `https://www.firstmid.com/wp-content/uploads/Disclosures_Web.pdf` (run 3395, 08:57)

  At 09:22 the Mac session tried `www.firstmid.com` and `firstmid.com` with curl and with headless Chromium. Both hosts reset the connection. The cloud sandbox can't reach the site either.
- **State.** 202 is a coverage gap with no consumer schedule held. Its `OPERATOR_SCHEDULES` entry stays, so a later companion fetch picks the page up if the host opens again. The bank was not sent to the paid fetch: a 404 is not a block, and one bank does not justify the spend.
- **Lesson.** If every route we have (Vercel fetch, Mac curl, headless browser) is refused, mark the bank as a gap and move on. Don't retry it by hand.
