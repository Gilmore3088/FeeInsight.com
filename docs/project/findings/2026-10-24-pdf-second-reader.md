# 2026-10-24: a PDF layout mistake had no second reading to disagree with it

**Lesson:** Read every PDF a second, independent way and compare which price each fee name gets; a
layout mistake no detector knows yet shows up as a name the two readings price differently.

**What happened:** before layout version 5, Rosetta read Oakwood Bank's fee PDF (document 17019,
#2219) across two stacked bullet lists. The stored text paired "Account Reconciliation" with
$15.00 per wire, "Wire Transfer Outgoing" with $35.00 per hour and "ATM/Debit Card Replacement"
with $30.00 per wire. Knox read those lines faithfully and the outgoing wire went live at $35.
Nothing in Rosetta could notice: the layout reader was the only reading, and each layout version
since v2 has added one detector for one more way a page can be set (prose columns, a dot-leader
list beside a table, stacked lists). A new page shape gets no detector until someone finds a wrong
fee on it. Bellco's wire rows (#1918, `pdf_layout` row grouping) are another case still open.

**Evidence the second reading works:** a plain text tool (pypdf, which ScrapeGraphAI uses for
PDFs) read the same bytes in the PDF's drawing order and paired all three fees correctly. pdf.js
gives the same drawing order with the line ends the file marks, so Rosetta needs no new
dependency.

**Fix:** `read.pdf_reader_agreement` v1 (`src/lib/agents/rosetta/pdf-reader-agreement.ts`).
`extractPdfDocumentText` builds each page's drawing-order text from the items it already has and
compares the fee pairs of the two readings: a name paired with a price on its own line, or a name
line directly above a price line (never inside a run of bare names, which is a label column whose
prices are drawn later). Amounts of $1,000 and up (balances, deposit minimums) and lines that open
in lower case (a wrapped sentence) are left out. A name both readings pair with no price in common
is a disagreement. Rosetta records the receipt on the read attempt as `detail.pdf_reader_agreement`
(`compared`, `disagreementCount`, up to 10 samples with the page and both prices).

**What it does not do:** it never changes the stored text, a reader version or a fee, and it does
not decide which reading is right. Holding or re-reading a flagged document is a later step, once
the receipts give a count of how many documents disagree.

**Measured locally (2026-10-24):** the stored pre-v5 Oakwood text against its PDF's drawing order
gives exactly the three moved prices. Today's reading of 9 bank PDFs (Oakwood, Northern Trust,
First United, SchoolsFirst, two U.S. Bank, TowneBank, Alliant, Beacon) gives 0 disagreements over
143 compared names. That is not a false-alarm rate for the whole vault; the receipts on live reads
will give one.

**Guard:** `src/lib/agents/rosetta/pdf-reader-agreement.test.ts`. Agent lesson:
rosetta/pdf-second-reading.
