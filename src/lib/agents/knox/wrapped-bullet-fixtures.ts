/** Test-only, immutable official source bytes plus controlled precision variations. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import { layoutPageText, type PdfTextItem } from "@/lib/agents/rosetta/pdf-layout";

export const OFFICIAL_PDF_SHA256 = "4b8cf689fa4c3586fe08e8e4dbb1d351d7437b72375d674ee409e17227d27967";
export async function officialFeeDisclosure(): Promise<string> {
  const bytes = readFileSync(new URL("./__fixtures__/wrapped-bullets/schoolsfirst-fees-oct2026.pdf", import.meta.url));
  if (createHash("sha256").update(bytes).digest("hex") !== OFFICIAL_PDF_SHA256) throw new Error("Official regression fixture changed");
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

export function wrappedPair(options: { returned?: number; paid?: number; reverse?: boolean; leaders?: number } = {}): string {
  const leaders = ".".repeat(options.leaders ?? 100);
  const returned = ["• NSF — any payment instrument or payment method,", "including check, ACH or other electronic transaction presented",
    "against a non-sufficient funds (NSF) available balance and", `returned*${leaders}$${options.returned ?? 22}`].join("\n");
  const paid = ["• Standard Overdraft — any payment instrument or payment", "method, including check, ACH, debit card transactions or other",
    "electronic transaction presented against a non-sufficient funds", `(NSF) available balance and paid*${leaders}$${options.paid ?? 22}`].join("\n");
  return ["Statement of Fees", ...(options.reverse ? [paid, returned] : [returned, paid]),
    "*No more than three NSF or Overdraft fees are charged per share, per day."].join("\n");
}
