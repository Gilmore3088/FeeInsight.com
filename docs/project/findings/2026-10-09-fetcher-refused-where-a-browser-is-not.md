# Two fee links our fetcher can't open but a Mac can

Found on 2026-10-09, during Magellan batch 1. The Mac session tried both links signed out, using curl and headless Chromium.

- **Desert Financial FCU (8638).** `https://www.desertfinancial.com/globalassets/files/legal/fee-schedule.pdf`
  - Returns 200 to Mac curl and to Playwright.
  - Returns HTTP 403 to `fetch.http` from Vercel, on 2026-10-07 16:23, 10-08 16:13, 10-09 02:33 and 10-09 06:08.
  - The paid web fetch opened two of the bank's other PDFs (05:41 and 02:15). So the refusal is tied to our fetcher's user agent or IP, not to the file.
  - Switching the crawler user agent is James's call. This is one data point for that decision. It is not a pattern yet.
- **State Department FCU (4416).** `https://www.sdfcu.org/sites/default/files/pdf/fees.pdf`
  - The server sends an incomplete TLS chain. macOS curl completes the chain itself; Node's fetch fails.
  - The paid web fetch refused the URL (`url_not_allowed`, run at 05:10 on 2026-10-09).
  - The file is a scanned image, so Rosetta's OCR read would be needed after any fetch.
  - A fix that keeps full verification would read the server certificate's AIA "CA Issuers" URL, download that intermediate, and retry with it added to the trusted chain. That needs a TLS-level fetch path beside the shared `fetch`. This entry records it; nothing is built yet.
