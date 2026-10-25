/**
 * #1946: a footnote number set in superscript after a $0 price loses its formatting in the stored
 * text and is glued to the price: North State Bank's "$0³ or $10" is stored as "$03 or $10", and
 * Penn Community Bank's "$0¹" as "$01". Read as written, "$03" is a $3 price. No schedule prints a
 * whole-dollar price with a leading zero, so a "$0" followed by one or two digits, with no cents, no
 * thousands comma and no further digit, is a $0 price with its footnote: the footnote is dropped and
 * the price kept. "$0.50", "$05.00" and "$01,000" are left alone, and so is a zero-padded price whose
 * decimal point the PDF dropped ("$ 050 00", Civista Bank, is $50.00). Pure.
 */
const GLUED_FOOTNOTE_PRICE = /\$(\s?)0(\d{1,2})(?![\d.,]|\s\d{2}(?!\d))/g;

export function withGluedFootnotePrices(text: string): string {
  return text.includes("$") ? text.replace(GLUED_FOOTNOTE_PRICE, "$$$10") : text;
}
