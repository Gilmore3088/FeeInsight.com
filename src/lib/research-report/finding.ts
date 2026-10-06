import { getDisplayName } from "@/lib/fee-taxonomy";

/** One executive-summary finding on a research report, as a web page or a PDF. */
export interface Finding {
  key: string;
  /** The number that leads the finding, already formatted. */
  figure: string;
  headline: string;
  detail: string;
  /** Section anchor holding the exhibit behind the finding. */
  exhibit: string;
}

export function lowerName(category: string): string {
  // Mid-sentence form: drop the "(OD)" tag, lowercase words, keep acronyms like NSF and ATM.
  return getDisplayName(category)
    .replace(/\s*\(OD\)/, "")
    .split(" ")
    .map((w) => (/^[A-Z]{2,}/.test(w.replace(/[^A-Za-z]/g, "")) ? w : w.toLowerCase()))
    .join(" ");
}
