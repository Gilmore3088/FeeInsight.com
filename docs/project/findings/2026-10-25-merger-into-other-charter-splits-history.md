# 2026-10-25: A merger into a different charter split a bank's history between BankFind and FFIEC

**Lesson:** A regulator identifier is today's, not history's: when a bank merges into a different
charter, the FDIC certificate and the Fed RSSD can come from different predecessors. Attach past
filings by the certificate that filed as that RSSD that quarter (the FFIEC POR file), not by
today's certificate.

**What happened:** Tracing #1925 (read-only, 2026-10-25) found two banks whose pre-merger quarters
are different institutions in the two financial feeds (#2625):

| Institution | Merger | BankFind (today's certificate) | FFIEC (RSSD) |
|---|---|---|---|
| 254 Emigrant Bank (cert 57083, RSSD 137915) | 2023-10-01 | 2023-09-30 assets $47,834K: Plus International Bank's own filing | $6,412,660K: old Emigrant, cert 12054 |
| 2923 Kendall Bank (cert 8110, RSSD 366854) | 2025-01-31 | 2024-12-31 assets $49,970K: the small charter's own filing | $159,171K: old Kendall, cert 16471 |

Since each merger the two feeds agree. Hamilton's trend reads use the BankFind series, so a
year-over-year figure for Kendall would show a jump of more than threefold (49,970 to 159,171 or
more) that never happened, while the
public institution page (FFIEC first) shows the bank customers know. Deming's filings reconcile
flagged the pre-merger quarters as `identity_suspect` and could not label the merger quarter: the
surviving certificate shows the merger as structure events 713 (offices acquired in a merger) and
510 (main office change) on one date, not the 810 it looked for.

**Cause:** both registry loaders attached every past quarter by today's identifier.
`fdic-financials.ts` joined BankFind rows to `institution_sources.cert_number`, so cert 57083's
pre-merger quarters (the small charter's) became Emigrant's, and the predecessor certs 12054 and
16471, which no institution holds today, were counted as unmatched. `ffiec-call-detail.ts` attaches
by RSSD, which carried the bigger predecessor.

**Fix (process, not rows):**
- FFIEC loader (`ffiec-call-detail.ts`, parser v6; `readFfiecPor` in `src/lib/regulatory/ffiec.ts`):
  reads the POR file's "FDIC Certificate Number" column (loose header match; a non-numeric cell is
  counted and refused, a blank or 0 left out) and stores it per bank and quarter as item
  `filing_fdic_cert` (code `POR_FDIC_CERT`, schedule `POR`, unit `count`). It is filing metadata in
  `FFIEC_FILING_METADATA_KEYS`, so `queryData` refuses it and no reader sums or serves it. No
  migration.
- FDIC loader (`fdic-financials.ts`, parser v2, `assignFdicRows`): for each quarter with stored POR
  certificates, a row whose certificate matches no institution but which POR names as an
  institution's filing certificate is attached to that institution (`raw_json.attached_via =
  'ffiec_por_cert'`, `filing_cert`, `current_cert`) and its unmatched copy is removed. A row whose
  certificate matches an institution whose report that quarter POR says was filed under another
  certificate is that other charter's own filing: it is kept unmatched (`raw_json.detached_via`),
  and the institution's stale row under it is removed unless the POR-named row replaces it in the
  same load. The POR-named filer wins because POR says which certificate filed as that RSSD. A POR
  certificate that another institution holds today, or that two institutions share, is ignored as
  a link disagreement, not a merger. With no POR certificate stored (before 2023 Q1, or the FFIEC
  quarter not loaded yet), rows attach by today's certificate as before.
- Order: the FFIEC loader makes the FDIC partition for a quarter due again when its POR shows a
  bank filing under a certificate that is not today's (`markFdicQuarterForPorCerts`), unless that
  FDIC quarter was already loaded with the same count, so which loader runs first does not matter.
  The FDIC parser version is recorded on each partition but not registered as a replay selector:
  that would reload every quarter back to 2010, and only 2023 Q1 on can change.
- Deming (`filings-reconcile.ts` v3, `mergerDates`): a 713 and a 510 on one date mark a merger
  quarter, besides an 810 with no office.

**Expected live effect (by reasoning and a read-only proxy, not measured after deploy):** an
unmatched BankFind row from 2023 Q1 on whose assets equal an institution's stored FFIEC assets for
that quarter, while the institution's own BankFind row differs, finds exactly these two banks:
254 with cert 12054 (2023-03-31 to 2023-09-30, 3 quarters) and 2923 with cert 16471 (2023-03-31 to
2024-12-31, 8 quarters). Those 11 quarters should move to the predecessor's filing, and the small
charters' 11 own quarters should become unmatched rows. Six other single-quarter asset coincidences
in the proxy are unmatched certificates whose assets equal the institution's own BankFind row; POR
names the institution's own certificate there, so nothing changes.

**Not settled:** BankFind history before 2023 Q1 (FFIEC detail starts there) still attaches by
today's certificate, so 254's and 2923's older quarters remain the small charters'. Which history
counts as the bank's (the predecessor's, as chosen here and as the public page shows, or history
from the merger only) is with James on #2625. Hamilton readers still need a series-break rule for
older history (#2625's second checklist line).

**Guard:** `src/lib/agents/magellan/registry/registry.test.ts` (Emigrant and Kendall attach, the
conflict rule, the fallback, the due-again mark), `src/lib/regulatory/ffiec.test.ts` (POR
certificate parse), `src/lib/agents/magellan/registry/public-data-loaders.test.ts` (certificate row
written apart from the lines), `src/lib/agents/deming/filings-reconcile.test.ts` (713 + 510 merger
quarter), `src/lib/data-catalog/query-data.test.ts` (refused as a measure). Agent lessons:
magellan/issue-2625-identifier-is-todays-not-historys, deming/issue-2625-merger-into-other-charter.
