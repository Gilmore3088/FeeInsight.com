# 2026-11-02: a free allowance's "per statement" was read as the fee's unit

**Lesson:** A unit word inside a free allowance names the period the free items are counted in, not
the unit the price is charged by. "Copies of Checks (per statement; 2 free per statement cycle) |
$2.00" is $2 a copy with two free each cycle, but the unit reader read it as $2 a statement. One
price that names two units ("$5.00/statement or document copy") was read as the first unit.

**What happened:** under the switch rule (DECISIONS 2026-10-20), `OWN_UNIT_REFILE_LIVE` was sampled
on Nov 2: 20 of its re-files, ordered by `md5('sw-2026-11-02:' || fee_published_id)`, each checked
against the newest stored text of the fee's document. 19 matched. Live 98831 (inst 237, doc 20764,
check_image, "Money Order (per check) & Copies of Checks", $2.00) would have moved from per_item to
per_statement. The bank's line is "Money Order (per check) & Copies of Checks (per statement; 2 free
per statement cycle) | $2.00": a money order is $2 a check, and a check copy is $2 after two free
copies a statement cycle. Reading the other 7 per-statement re-files found two more of the same
kind: 65324 ("$5.00/statement or document copy") and 134768 ("Statement/Document Copies (per
statement/document) $5"), priced per statement or per document, not per statement.

**Cause:** `specialUnitAfterPrice` (`src/lib/fee-unit.ts`) took the first unit word after "per" in
the name's parenthetical (`specialUnitInName`) or after the price. It did not look at the rest of
that clause, so a free allowance's period passed as the unit. Its check for a second unit
("per page or per document") needed "or"/"and" and a second "per", so "/statement or document" and
"statement/document" passed too. Knox's own-unit pass and Darwin's own-unit re-check share the reader,
so both new reads and the live re-file had the error.

**Fix:**
- Knox v155: `specialUnitAfterPrice` reads no unit when the clause that holds it (to its parenthesis
  or cell) grants free items per that same unit ("2 free per statement cycle", "one free per
  statement", "first 2 free per statement"). A free count of the unit keeps it: "$2.00/Page, First 2
  pages free" and "$0.50 per page (first 10 pages free)" stay per page. A second unit after "/",
  "or" or "and", written bare or with "per", names no single unit.
- Darwin's own-unit check goes to v2, so its counts are read under the new reader.

**Dry run (prod, read-only, Nov 2, whole document text, the check's own verdict run locally on
every candidate):** 1,889 candidates. Per-event re-files go from 758 at 582 banks to 755 at 580
(per_page 686, per_document 64, per_statement 5). The three dropped are 98831, 65324 and 134768,
and nothing new comes in. Those three stay per_item, as they are live today. The Nov 2 02:01 ledger
pass on the deployed code counted 871 per-event re-files over 2,003 candidates; the candidate set
read 1.5 hours later was 114 rows smaller, so the two counts are not over the same rows.

**Re-sample after the fix:** all 5 remaining per-statement re-files ("$5.00 (each statement)",
"$5.00 per statement.", "Statement Copy | $2.00 per statement", twice "STATEMENT PRINTOUT/COPY (per
statement) | $6.00") and a fresh 20 under the same seed, skipping rows already judged. All 25 match
the bank's whole line. One sampled document has a newer copy (16601 to 40815), which prints the same line.

**Agent lesson:** knox/issue-2248-free-allowance-is-no-unit, darwin/issue-2248-sample-the-refile-against-the-whole-line

**Guard:** `src/lib/fee-unit.test.ts` (98831's line verbatim, the kept free-count shapes, the two-unit lines)
