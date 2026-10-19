/** Test-only immutable official bytes. Downloaded via reviewed bounded source client2026-10-19. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import { layoutPageText, type PdfTextItem } from "../rosetta/pdf-layout";

export async function ancillaryOfficialText(kind: "safe" | "general"): Promise<string> {
  const file = kind === "safe" ? "usbank-safe-debit-may2025.pdf" : "usbank-consumer-aug2026.pdf";
  const expected = kind === "safe" ? "553045b35ff39d4ebd18124dd744be7f4a59583c0930f0573bc1bea9748c288e"
    : "427392956ddc39068635e3f99111ac5fdf0df638fc5e52fee77314574da6082b";
  const bytes = readFileSync(new URL(`./__fixtures__/ancillary-products/${file}`, import.meta.url));
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Official product fixture changed");
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: 16_777_216 });
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(layoutPageText(content.items.filter((item) => "str" in item) as PdfTextItem[]));
    }
    return pages.join("\n\n");
  } finally { await pdf.destroy(); }
}

export function ancillaryAccountText(product = "Everyday Debit Account", price = 5): string {
  return `${product} Pricing and Information\nAccount terms and fees\nSubject to miscellaneous fees in Consumer Pricing Information with the following exceptions:\nPersonal money order | $${price.toFixed(2)} each\nStop Payment | $30.00 per item\nDomestic Wire Transfer Outgoing | $20.00 per wire`;
}
