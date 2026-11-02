/**
 * #1946: a footnote number set in superscript after a $0 price loses its formatting in the stored
 * text and is glued to the price: North State Bank's "$0³ or $10" is stored as "$03 or $10", and
 * Penn Community Bank's "$0¹" as "$01". Read as written, "$03" is a $3 price. No schedule prints a
 * whole-dollar price with a leading zero, so a "$0" followed by one or two digits, with no cents, no
 * thousands comma and no further digit, is a $0 price with its footnote: the footnote is dropped and
 * the price kept. "$0.50", "$05.00" and "$01,000" are left alone, and so is a zero-padded price whose
 * decimal point the PDF dropped ("$ 050 00", Civista Bank, is $50.00). Known gap: a glued footnote
 * followed by a period or comma ("$03, $10") is left as written, since "$05.00" looks the same. Pure.
 */
const GLUED_FOOTNOTE_PRICE = /\$(\s?)0(\d{1,2})(?![\d.,]|\s\d{2}(?!\d))/g;

export function withGluedFootnotePrices(text: string): string {
  return text.includes("$") ? text.replace(GLUED_FOOTNOTE_PRICE, "$$$10") : text;
}

/**
 * #2072: a page whose footnote marks lost their superscript glues them onto the word or price before
 * them. Oregon State CU's schedule prints "$5 per check2", "$1.50 per transaction2" and "third-party
 * fees5", and so also "Incoming wire ...... $152" for $15 with footnote 2 and "Stop payment for
 * cashier's check ...... $302" for $30. A whole price at a line's end whose last digit is a mark the
 * same page glues to a word at a line's end at least twice ("check2", "transaction2") is read without
 * that digit. The page's own marks are the evidence, so a page that never glues a mark to a word is
 * left as written, and so is a price with cents ("$15.002" is not touched). The reading is ambiguous
 * ("$152" can be $152), so callers use it only to withhold a judgment, never to state a price. Pure.
 *
 * Current-copy v6 (Nov 2, CURRENT_COPY_CONFIRM_LIVE sample, fee 99824): a footnote the page uses only
 * once is glued to no word, so "In-branch cash advance service fee …… $154" ($15, footnote 4) kept its
 * 4. On a page that already shows the habit (some mark glued to words at least twice), a digit the page
 * itself defines as a footnote, on a line that opens with the digit and a capitalised sentence ("4 Service
 * fee is charged on cash advances …", "1 � Following a three-month grace period …"), is a mark too.
 */
const WORD_MARK = /[a-z)](\d)[ \t]*$/gm;
const MARKED_WHOLE_PRICE = /(\$\s?\d+)(\d)(?=[ \t]*$)/gm;
const WORD_MARK_MIN = 2;
/** A footnote's own line: its digit, a space or an unreadable glyph, then a capitalised word. */
const FOOTNOTE_DEFINITION = /^[ \t]*(\d)[ \t]+(?:�[ \t]*)?[A-Z][a-z]/gm;

export function withoutGluedFootnoteMarks(text: string): string {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(WORD_MARK)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  const marks = new Set([...counts].filter(([, count]) => count >= WORD_MARK_MIN).map(([mark]) => mark));
  if (marks.size === 0) return text;
  for (const match of text.matchAll(FOOTNOTE_DEFINITION)) marks.add(match[1]);
  return text.replace(MARKED_WHOLE_PRICE, (whole: string, price: string, mark: string) => (marks.has(mark) ? price : whole));
}
