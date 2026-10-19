import { layoutPageText, type PdfTextItem } from "./pdf-layout";

export interface PdfTextExtraction { text: string; totalPages: number; pages?: string[] }

/** Rosetta's existing complete-document layout reader, also used for reference checks. */
export async function extractPdfDocumentText(bytes: Uint8Array, options: {
  signal?: AbortSignal; timeoutMs?: number; maxPages?: number; maxTextChars?: number; maxItems?: number;
} = {}): Promise<PdfTextExtraction> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("PDF text extraction timed out")), options.timeoutMs ?? 20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let destroy: (() => Promise<void> | void) | undefined;
  let rejectAbort: (error: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { void Promise.resolve(destroy?.()).catch(() => undefined); rejectAbort(signal.reason ?? new Error("PDF text extraction cancelled")); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) throw signal.reason;
    return await Promise.race([aborted, (async () => {
      const { getDocumentProxy } = await import("unpdf");
      if (signal.aborted) throw signal.reason;
      // pdf.js detaches its input; preserve source bytes for hashing/other readers.
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: 16_777_216 });
      destroy = () => pdf.destroy?.();
      try {
        if (signal.aborted) throw signal.reason;
        const totalPages = Number(pdf.numPages ?? 0);
        if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > (options.maxPages ?? 150)) {
          throw new Error(`PDF has too many or invalid pages for Rosetta text read: ${totalPages}`);
        }
        const pages: PdfTextItem[][] = [];
        let totalItems = 0, totalCharacters = 0;
        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
          if (signal.aborted) throw signal.reason;
          const content = await (await pdf.getPage(pageNumber)).getTextContent();
          const items: PdfTextItem[] = [];
          for (const item of content.items) if ("str" in item) {
            totalItems += 1; totalCharacters += item.str.length;
            if (totalItems > (options.maxItems ?? Infinity) || totalCharacters > (options.maxTextChars ?? Infinity)) {
              throw new Error("PDF text extraction exceeds reference limits");
            }
            items.push(item);
          }
          pages.push(items);
        }
        const pageTexts = pages.map(layoutPageText);
        return { text: pageTexts.join("\n\n"), totalPages, pages: pageTexts };
      } finally { await pdf.destroy?.(); destroy = undefined; }
    })()]);
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", onAbort); }
}
