import { deflateSync } from "zlib";

/**
 * Test fixture: an image-only PDF, like a scanner makes. Text is drawn with a 5x7 bitmap
 * font into a grayscale raster (slightly blurred, as a scan is), stored as one Flate
 * image XObject per page, with no text objects at all. Upper-case letters, digits and
 * "$ . - |" only.
 */

const FONT: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110", D: "11100 10010 10001 10001 10001 10010 11100",
  E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 11001 10101 10011 10011 10001",
  O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 01010 01010 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 10001 01010 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10001 10001 10001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
  $: "00100 01111 10100 01110 00101 11110 00100", ".": "00000 00000 00000 00000 00000 01100 01100",
  "-": "00000 00000 00000 11111 00000 00000 00000", "|": "00100 00100 00100 00100 00100 00100 00100",
  " ": "00000 00000 00000 00000 00000 00000 00000",
};

export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Lines of text as a grayscale page image. */
export function rasterizeLines(lines: string[], scale = 3, blur = 1): Raster {
  const charWidth = 6 * scale;
  const lineHeight = 11 * scale;
  const margin = 10 * scale;
  const width = margin * 2 + Math.max(...lines.map((line) => line.length)) * charWidth;
  const height = margin * 2 + lines.length * lineHeight;
  const sharp = new Uint8Array(width * height).fill(255);
  lines.forEach((line, lineIndex) => {
    [...line.toUpperCase()].forEach((char, charIndex) => {
      (FONT[char] ?? FONT[" "]).split(" ").forEach((bits, row) => {
        [...bits].forEach((bit, column) => {
          if (bit !== "1") return;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              const y = margin + lineIndex * lineHeight + row * scale + dy;
              const x = margin + charIndex * charWidth + column * scale + dx;
              sharp[y * width + x] = 0;
            }
          }
        });
      });
    });
  });
  if (blur <= 0) return { width, height, data: sharp };
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -blur; dy <= blur; dy += 1) {
        for (let dx = -blur; dx <= blur; dx += 1) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
          sum += sharp[yy * width + xx];
          count += 1;
        }
      }
      data[y * width + x] = sum / count;
    }
  }
  return { width, height, data };
}

/** An image-only PDF: one page per raster, each page a single DeviceGray image. */
export function imageOnlyPdf(pages: Raster[]): Uint8Array {
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Buffer) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const latin = (text: string) => Buffer.from(text, "latin1");
  const objects: Buffer[] = [];
  const pageIds = pages.map((_, index) => 3 + index * 3);
  objects.push(latin("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(latin(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  pages.forEach((raster, index) => {
    const pageId = pageIds[index];
    // Fit the image on a letter page at 72/150 scale.
    const drawWidth = Math.min(540, raster.width * 0.48);
    const drawHeight = drawWidth * (raster.height / raster.width);
    const content = `q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} 36 ${(756 - drawHeight).toFixed(2)} cm /Im1 Do Q`;
    const image = deflateSync(Buffer.from(raster.data));
    objects.push(
      latin(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      ),
    );
    objects.push(latin(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    objects.push(
      Buffer.concat([
        latin(
          `<< /Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`,
        ),
        image,
        latin("\nendstream"),
      ]),
    );
  });
  push(latin("%PDF-1.4\n"));
  objects.forEach((object, index) => {
    offsets.push(length);
    push(Buffer.concat([latin(`${index + 1} 0 obj\n`), object, latin("\nendobj\n")]));
  });
  const xref = length;
  push(
    latin(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}

export function scannedFeePdf(lines: string[]): Uint8Array {
  return imageOnlyPdf([rasterizeLines(lines)]);
}
