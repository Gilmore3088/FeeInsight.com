import { describe, expect, it } from "vitest";
import { assertPdfTextIntegrity, PdfTextIntegrityError } from "./pdf-text-integrity";

describe("PDF text integrity (#2598)", () => {
  it.each([
    "Wire Interna\uFFFDonal Transfer-Remote Outgoing ..$70.00*",
    "Wire transfer - Outgoing (domes\uFFFDc only) | $20",
    "automa\uFFFDc transfers per month",
    "Overdra\uFFFDs an NSF fee of $30.00",
    "compe\uFFFD\uFFFDveness",
    "Interna\u0000\uFFFD\u0000onal",
    "\uFFFDInternational wire | $70",
    "Transfer\uFFFD | $70",
    "Retrait é\uFFFDé | $2",
    "Wire | $7\uFFFD.00",
    "Wire | \uFFFD70.00",
  ])("refuses lost letters or numbers without inventing them: %s", (text) => {
    expect(() => assertPdfTextIntegrity(text, 2)).toThrow(PdfTextIntegrityError);
    expect(() => assertPdfTextIntegrity(text, 2)).toThrow("page 2");
  });

  it.each([
    "Wire International Transfer-Remote Outgoing | $70.00*",
    "Wire transfer – Domestic | $20.00",
    "Efﬁcient service | $3.00", // A real Unicode ligature still has its identity.
    "Réconciliation | $25.00",
    "• Transfer | $5.00",
    "\uFFFD Transfer | $5.00", // Isolated mark: no word/number was damaged.
    "Bill Pay \uFFFD\uFFFD\uFFFD Free",
    "Wire | $70.00*\n",
  ])("keeps intact text, prices, qualifiers and isolated marks: %s", (text) => {
    expect(() => assertPdfTextIntegrity(text)).not.toThrow();
  });
});
