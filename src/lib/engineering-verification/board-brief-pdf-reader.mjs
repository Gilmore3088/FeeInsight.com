/** Separate credentialless PDF parser. No production source or parent oracle is mounted. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readInput, writeOutput, keys } from './board-brief-protocol.mjs';
const tool = createRequire('/toolchain/package.json');
async function main() {
  const input = await readInput();
  if (!keys(input, ['schema_version', 'cases']) || input.schema_version !== 1 || !Array.isArray(input.cases) || input.cases.length !== 2) throw new Error('Malformed isolated PDF input');
  const { getDocumentProxy } = await import(pathToFileURL(tool.resolve('unpdf')).href);
  const seen = new Set(), values = []; let items = 0, textBytes = 0;
  for (const row of input.cases) {
    if (!keys(row, ['id', 'kind', 'base64']) || !['HBB-PDF-DENSE', 'HBB-PDF-COMPACT'].includes(row.id) || seen.has(row.id) || row.kind !== 'pdf-bytes'
      || typeof row.base64 !== 'string' || row.base64.length > 2 * 1024 * 1024 || row.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.base64)) throw new Error('Malformed PDF byte frame');
    seen.add(row.id); const bytes = Buffer.from(row.base64, 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== row.base64 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid bounded PDF bytes');
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const pages = [];
    try {
      if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > 12) throw new Error('PDF page count outside bound');
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent(), projected = [];
        if (!Array.isArray(content.items) || content.items.length > 10000) throw new Error('PDF page item count outside bound');
        for (const item of content.items) {
          if (!Object.hasOwn(item, 'str') || !item.str.trim()) continue;
          const font = content.styles[item.fontName];
          if (!font || !Number.isFinite(font.ascent) || !Number.isFinite(font.descent)) throw new Error('PDF native font metrics unavailable');
          if (++items > 50000 || (textBytes += Buffer.byteLength(item.str)) > 1024 * 1024) throw new Error('PDF text count outside bound');
          projected.push({ text: item.str, transform: [...item.transform], width: item.width, height: item.height, fontAscent: font.ascent, fontDescent: font.descent });
        }
        pages.push({ width: viewport.width, height: viewport.height, items: projected });
      }
    } finally { await document.destroy(); }
    values.push({ id: row.id, kind: 'pdf', pages });
  }
  writeOutput({ schema_version: 1, cases: values });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write('SETUP_FAILURE: ' + String(error?.message ?? 'PDF parser failed').slice(0, 1024) + '\n'); process.exitCode = 1; });
