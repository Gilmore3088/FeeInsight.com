import { Unzip, UnzipInflate, strFromU8, unzipSync } from "fflate";

/**
 * Streaming xlsx rows, shared by the loaders whose workbooks inflate to hundreds of megabytes
 * (BLS OEWS metro file, World Bank RPW). Each worksheet is read row by row and never held as one
 * string; only the shared-strings table is inflated whole. Pure parsing: no DB access, no I/O.
 */

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return XML_ENTITIES[e] ?? m;
  });
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRowXml(rowXml: string, shared: string[]): string[] {
  const row: string[] = [];
  for (const cell of rowXml.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = cell[1];
    const body = cell[2] ?? "";
    const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1];
    const type = attrs.match(/\bt="([^"]+)"/)?.[1];
    let value = "";
    if (type === "inlineStr") value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
    else {
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (v !== undefined) value = type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
    }
    const at = ref ? columnIndex(ref) : row.length;
    while (row.length < at) row.push("");
    row[at] = value.trim();
  }
  return row;
}

const SHEET_PATH = /^xl\/worksheets\/sheet(\d+)\.xml$/i;

/**
 * Calls `onRow` for each row of the worksheets `pick` keeps (all of them by default; `pick` gets
 * the paths sorted by sheet number). Returns the worksheet paths read and the row count.
 */
export function streamXlsxSheets(
  bytes: Uint8Array,
  onRow: (row: string[], sheet: string) => void,
  pick: (sheets: string[]) => string[] = (all) => all,
): { sheets: string[]; rows: number } {
  const names: string[] = [];
  const sharedFiles = unzipSync(bytes, {
    filter: (f) => {
      names.push(f.name);
      return /^xl\/sharedStrings\.xml$/i.test(f.name);
    },
  });
  const sheets = pick(
    names.filter((n) => SHEET_PATH.test(n)).sort((a, b) => Number(a.match(SHEET_PATH)![1]) - Number(b.match(SHEET_PATH)![1])),
  );
  if (sheets.length === 0) return { sheets: [], rows: 0 };
  const shared: string[] = [];
  const sharedName = Object.keys(sharedFiles)[0];
  if (sharedName) {
    const xml = strFromU8(sharedFiles[sharedName]);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
    }
  }
  const wanted = new Set(sheets);
  let rows = 0;
  let failure: Error | null = null;
  const unzip = new Unzip((entry) => {
    if (!wanted.has(entry.name)) return;
    const sheet = entry.name;
    let carry = "";
    const decoder = new TextDecoder();
    const drain = (final: boolean) => {
      let end = carry.indexOf("</row>");
      while (end >= 0) {
        const start = carry.lastIndexOf("<row", end);
        if (start >= 0) {
          const open = carry.indexOf(">", start);
          rows += 1;
          onRow(parseRowXml(carry.slice(open + 1, end), shared), sheet);
        }
        carry = carry.slice(end + 6);
        end = carry.indexOf("</row>");
      }
      if (final) carry = "";
    };
    entry.ondata = (error, data, final) => {
      if (error) {
        failure ??= error;
        return;
      }
      try {
        carry += decoder.decode(data, { stream: !final });
        drain(final);
      } catch (err) {
        failure ??= err instanceof Error ? err : new Error(String(err));
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const CHUNK = 1 << 20;
  for (let at = 0; at < bytes.length; at += CHUNK) unzip.push(bytes.subarray(at, at + CHUNK), false);
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  return { sheets, rows };
}

/** Calls `onRow` for each row of the workbook's first sheet, streaming the sheet XML. */
export function streamXlsxRows(bytes: Uint8Array, onRow: (row: string[]) => void): { sheet: string | null; rows: number } {
  const r = streamXlsxSheets(bytes, (row) => onRow(row), (all) => all.slice(0, 1));
  return { sheet: r.sheets[0] ?? null, rows: r.rows };
}
