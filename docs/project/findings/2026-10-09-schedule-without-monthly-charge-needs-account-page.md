# A fee schedule with no monthly charge needs the account page too

Found on 2026-10-09 during a UAT check of Security Federal Bank (722, SC).

- **What happened.** The bank's personal fee schedule (document 16682, 26 live fees) never states a monthly maintenance charge. The only monthly maintenance fees live for the bank came from its business fee schedule. A consumer comparison therefore showed business pricing as the bank's checking fee.
- **Why Magellan missed it.** Discovery stops once it holds a fee schedule. The monthly charges sit on the personal checking product page, `/personal/personal-checking/all-accounts.html`, and the search index shows Premium Checking at $15 below $2,500. Nothing looks for that page when the schedule lacks the fee.
- **Fix for now.** That page is added as a hand-found consumer companion (`OPERATOR_SCHEDULES`). The cloud can't reach the site, but Magellan's fetcher can, and blocked pages go to the paid fetch.
- **Lesson.** A consumer schedule with no `monthly_maintenance` row means the personal checking page is a missing source. Look for it before treating the bank as covered. Business-schedule monthly fees must never stand in for consumer ones.
