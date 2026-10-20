# A combined "Overdraft/NSF" line kept only one fee (Oct 19, 2026)

**Seen.** The round 2 live check (40 institutions, Oct 18) found 12 institutions with no NSF fee and
8 with no overdraft fee. At Bank of St. Francisville and Postal Family, one line priced both fees
and the page showed only one of them.

**Cause.** Knox has read such a line as two fees since v27 (the "twin" in `knox/specialists.ts`).
But the raw tier's unique index `raw_fee_observations_knox_agentic_dedup_idx` is (document,
lower(name), amount, audience), and the twin has the same name, price and audience as the first
fee. `insertCandidate`'s `ON CONFLICT` found the first row and dropped the twin without a trace.
Each later tier keys on the row below it (one verified row per raw row, one published row per
verified row), so nothing downstream could recover it. Unit tests passed because they checked
Knox's candidates, not the stored rows.

On prod (read-only, current copies, Oct 19):
- 101 live combined-name overdraft fees sat at banks with no NSF fee (strict name match);
- a loose match finds 245 live combined rows with no twin on their document (225 banks);
- 179 of those are at 167 banks with no live fee of the other category at all.

The twin's name test also missed "Non-sufficient funds (NSF) or Overdraft (OD)" and "Overdraft/Return
Item Fee".

**Fix (#2123, James chose "Migrate").**
- `line_share` joins the raw key (migration `20270110000065_raw_line_share.sql`). The twin writes
  `twin:<category>`; every other row keeps '' and behaves as before.
- The name test takes the bracketed abbreviations and "return(ed) item".
- Knox v82 re-reads a current copy once when it holds a combined overdraft or NSF row and no twin.

**Lesson.** A unique key that leaves out a field the pipeline treats as identity (here, category)
drops rows silently. Tests of an extraction rule should assert on the stored rows
(`reread.db.test.ts`), not only on the candidates.

**Agent lesson:** knox/pr-2126-store-each-twin
