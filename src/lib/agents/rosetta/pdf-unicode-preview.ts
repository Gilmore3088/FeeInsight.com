import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { layoutPageText, type PdfTextItem } from "./pdf-layout";
import { createTesseractEngine, tesseractLangPath, toGray, type OcrEngine } from "./ocr";
import { assertPdfTextIntegrity, PdfTextIntegrityError } from "./pdf-text-integrity";
import { applyUnicodeWordRepairs, pdfWordRuns, proposeUnicodeWords, type UnicodeWordRepair } from "./pdf-unicode-words";

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const DPI = [240, 300] as const;
const MAX_PIXELS = 9_000_000;

function damaged(text: string): boolean {
  try { assertPdfTextIntegrity(text); return false; }
  catch (error) { if (error instanceof PdfTextIntegrityError) return true; throw error; }
}

export interface UnicodePreviewPage {
  page: number;
  repairs: UnicodeWordRepair[];
  unresolved: string[];
  renderings: Array<{ dpi: number; width: number; height: number; graySha256: string }>;
}

export interface PdfUnicodePreview {
  method: "full_page_letter_witness_v1";
  /** This is an offline proposal, never a persisted-text or publication receipt. */
  disposition: "review_required";
  sourceSha256: string;
  /** Null only for an explicitly injected test/analysis engine. */
  localModelSha256: string | null;
  originalText: string;
  originalTextSha256: string;
  proposedText: string;
  proposedTextSha256: string;
  /** Only means the scoped Unicode-loss guard passes; it does not verify fees. */
  complete: boolean;
  pages: UnicodePreviewPage[];
  incumbent: null | { beforeSha256: string; proposedSha256: string | null; proposedText: string | null };
}

/**
 * Offline source-stage preview. Render the original glyph outlines, read each
 * damaged page twice, and fill only lost internal letters witnessed in its cell.
 * All known text, prices, punctuation and layout remain byte-for-byte unchanged.
 * No DB, vault, source fetch, provider, reader receipt or fee writer is involved.
 * Deliberately not imported by read.ts: production still refuses damaged text.
 */
export async function previewPdfUnicodeRepair(bytes: Uint8Array, options: {
  expectedSourceSha256: string;
  incumbent?: { text: string; sha256: string; sourceSha256: string };
  signal?: AbortSignal;
  timeoutMs?: number;
  engineFactory?: () => OcrEngine;
}): Promise<PdfUnicodePreview> {
  if (bytes.byteLength > 20_000_000 || !bytes.byteLength) throw new Error("Unicode preview PDF exceeds byte limit or is empty");
  const sourceSha256 = hash(bytes);
  if (sourceSha256 !== options.expectedSourceSha256) throw new Error("Unicode preview source hash mismatch");
  if (options.incumbent && options.incumbent.sourceSha256 !== sourceSha256) throw new Error("Unicode preview incumbent belongs to different source bytes");
  if (options.incumbent && hash(options.incumbent.text) !== options.incumbent.sha256) throw new Error("Unicode preview incumbent hash mismatch");
  const model = tesseractLangPath();
  if (!options.engineFactory && !model.local) throw new Error("Unicode preview requires a local OCR model; network fallback is forbidden");
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error("Invalid Unicode preview timeout");
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timeout = setTimeout(() => controller.abort(new Error("Unicode preview timed out")), timeoutMs);
  let destroy: (() => Promise<void>) | undefined;
  let cancelRender: (() => void) | undefined;
  let engine: OcrEngine | undefined;
  const check = () => { if (signal.aborted) throw signal.reason ?? new Error("Unicode preview cancelled"); };
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    cancelRender?.();
    void destroy?.().catch(() => undefined);
    void engine?.terminate().catch(() => undefined);
    rejectAbort(signal.reason ?? new Error("Unicode preview cancelled"));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    check();
    return await Promise.race([aborted, (async (): Promise<PdfUnicodePreview> => {
      const localModelSha256 = options.engineFactory ? null : hash(await readFile(join(model.langPath, "eng.traineddata.gz")));
      check();
      const { getDocumentProxy, createIsomorphicCanvasFactory } = await import("unpdf");
      // Load native graphics before raster parsing. unpdf's earlier text-only read
      // may have installed an empty DOMMatrix shim; missing-only injection fails.
      const canvas = await import("@napi-rs/canvas");
      check();
      if (typeof globalThis.DOMMatrix?.prototype?.translateSelf !== "function") {
        Object.defineProperty(globalThis, "DOMMatrix", { value: canvas.DOMMatrix, writable: true, configurable: true });
      }
      const CanvasFactory = await createIsomorphicCanvasFactory(async () => canvas);
      const factory = new CanvasFactory();
      check();
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { CanvasFactory, disableFontFace: true, maxImageSize: MAX_PIXELS });
      destroy = () => pdf.destroy();
      try {
        check();
        if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 150) throw new Error("Unicode preview exceeds PDF page limit");
        const pages: Array<{ items: PdfTextItem[]; text: string }> = [];
        let characters = 0, items = 0;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          check();
          const content = await (await pdf.getPage(pageNumber)).getTextContent();
          const textItems: PdfTextItem[] = [];
          for (const item of content.items) if ("str" in item) {
            items++; characters += item.str.length;
            if (items > 100_000 || characters > 1_000_000) throw new Error("Unicode preview exceeds text limit");
            textItems.push(item);
          }
          pages.push({ items: textItems, text: layoutPageText(textItems) });
        }
        if (pages.filter(page => damaged(page.text)).length > 2) throw new Error("Unicode preview exceeds two damaged pages; manual review required");
        const receipts: UnicodePreviewPage[] = [];
        const proposedPages: string[] = [];
        for (const [index, original] of pages.entries()) {
          check();
          if (!damaged(original.text)) { proposedPages.push(original.text); continue; }
          const page = await pdf.getPage(index + 1);
          const passes: Parameters<typeof proposeUnicodeWords>[1][number][] = [];
          const renderings: UnicodePreviewPage["renderings"] = [];
          for (const dpi of DPI) {
            check();
            const viewport = page.getViewport({ scale: dpi / 72 });
            const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
            if (!Number.isSafeInteger(width * height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error("Unicode preview exceeds raster limit");
            const target = factory.create(width, height);
            try {
              if (!target.context) throw new Error("Unicode preview canvas unavailable");
              const task = page.render({ canvas: target.canvas as unknown as HTMLCanvasElement,
                canvasContext: target.context as unknown as CanvasRenderingContext2D, viewport, background: "rgb(255,255,255)" });
              cancelRender = () => task.cancel();
              await task.promise;
              cancelRender = undefined;
              check();
              const pixels = target.context.getImageData(0, 0, width, height);
              const gray = toGray({ width, height, data: pixels.data, kind: 3 });
              if (!gray) throw new Error("Unicode preview grayscale unavailable");
              renderings.push({ dpi, width, height, graySha256: hash(gray.data) });
              check();
              engine ??= (options.engineFactory ?? createTesseractEngine)();
              const result = await engine.recognize(gray);
              check();
              passes.push({ runs: pdfWordRuns(original.items, viewport.transform), words: result.words });
            } finally { cancelRender = undefined; factory.destroy({ canvas: target.canvas }); }
          }
          const proposal = proposeUnicodeWords(original.text, [passes[0], passes[1]]);
          const proposed = applyUnicodeWordRepairs(original.text, proposal.repairs);
          if (proposed === null) throw new Error("Unicode preview failed letter conservation");
          proposedPages.push(proposed);
          receipts.push({ page: index + 1, ...proposal, renderings });
          page.cleanup();
        }
        const originalText = pages.map(page => page.text).join("\n\n");
        const proposedText = proposedPages.join("\n\n");
        const complete = !damaged(proposedText);
        // Historical previews preserve the incumbent's existing geometry, rather
        // than replacing it with a new layout or judging survival by fee counts.
        const incumbentText = options.incumbent && complete
          ? applyUnicodeWordRepairs(options.incumbent.text, receipts.flatMap(page => page.repairs)) : null;
        const incumbentProposal = incumbentText !== null && !damaged(incumbentText) ? incumbentText : null;
        return {
          method: "full_page_letter_witness_v1", disposition: "review_required", sourceSha256, localModelSha256,
          originalText, originalTextSha256: hash(originalText), proposedText, proposedTextSha256: hash(proposedText), complete,
          pages: receipts,
          incumbent: options.incumbent ? { beforeSha256: options.incumbent.sha256,
            proposedSha256: incumbentProposal === null ? null : hash(incumbentProposal), proposedText: incumbentProposal } : null,
        };
      } finally { await pdf.destroy(); destroy = undefined; }
    })()]);
  } finally {
    clearTimeout(timeout); signal.removeEventListener("abort", onAbort);
    await engine?.terminate();
  }
}
