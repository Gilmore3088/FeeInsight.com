// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
const getDocumentProxy = vi.hoisted(() => vi.fn());
vi.mock("unpdf", () => ({ getDocumentProxy }));
import { extractPdfDocumentText } from "./pdf-document-text";
import { PdfTextIntegrityError } from "./pdf-text-integrity";
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
const item = (str: string) => ({ str, transform: [1,0,0,1,10,100], width: 20, height: 10, hasEOL: true });
const document = (items = [item("Consumer Fee Schedule")]) => ({ numPages: 1, destroy: vi.fn(async () => undefined),
  getPage: vi.fn(async () => ({ getTextContent: async () => ({ items }) })) });

describe("shared bounded PDF text parser", () => {
  it("keeps Rosetta layout output and original bytes intact", async () => {
    const pdf = document(); getDocumentProxy.mockResolvedValue(pdf);
    const bytes = new Uint8Array([1,2,3]);
    expect(await extractPdfDocumentText(bytes)).toMatchObject({ text: "Consumer Fee Schedule", totalPages: 1 });
    expect(bytes).toEqual(new Uint8Array([1,2,3])); expect(pdf.destroy).toHaveBeenCalled();
    expect(getDocumentProxy.mock.calls[0][0]).not.toBe(bytes);
  });
  it.each(["pages", "characters", "items"])("rejects excessive %s and destroys the parser", async (limit) => {
    const pdf = document([item("abc"),item("def")]); if (limit === "pages") pdf.numPages = 31;
    getDocumentProxy.mockResolvedValue(pdf);
    await expect(extractPdfDocumentText(new Uint8Array(), { maxPages:30,maxTextChars: limit === "characters" ? 4 : 100,
      maxItems: limit === "items" ? 1 : 100 })).rejects.toThrow();
    expect(pdf.destroy).toHaveBeenCalled();
  });
  it("cancels before parsing", async () => {
    await expect(extractPdfDocumentText(new Uint8Array(), { signal:AbortSignal.abort(new Error("cancelled")) })).rejects.toThrow("cancelled");
    expect(getDocumentProxy).not.toHaveBeenCalled();
  });
  it("rejects a corrupt Unicode map even when the two layout readings would agree", async () => {
    const pdf = document([item("Wire Interna\uFFFDonal Transfer-Remote Outgoing ..$70.00*")]);
    getDocumentProxy.mockResolvedValue(pdf);
    await expect(extractPdfDocumentText(new Uint8Array([1,2,3]))).rejects.toThrow(PdfTextIntegrityError);
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });
  it("checks words split across text items", async () => {
    const pdf = document([
      { ...item("Interna"), width: 35 },
      { ...item("\uFFFD"), transform: [1,0,0,1,45,100], width: 6 },
      { ...item("onal"), transform: [1,0,0,1,51,100] },
    ]);
    getDocumentProxy.mockResolvedValue(pdf);
    await expect(extractPdfDocumentText(new Uint8Array())).rejects.toThrow("page 1");
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled page and destroys its document", async () => {
    vi.useFakeTimers(); const pdf=document();pdf.getPage.mockImplementation(() => new Promise(() => undefined));getDocumentProxy.mockResolvedValue(pdf);
    const result=extractPdfDocumentText(new Uint8Array(),{ timeoutMs:10 });
    const assertion=expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(11);await assertion;expect(pdf.destroy).toHaveBeenCalled();
  });
});
