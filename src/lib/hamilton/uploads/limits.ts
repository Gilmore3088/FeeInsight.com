/** Private financial-table imports, not the separate public-dataset XLSX loader. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 5_000; // Includes the header and blank records.
export const MAX_COLUMNS = 128;
export const MAX_TABLE_CELLS = 100_000; // Includes empty slots before sparse cells.
export const MAX_CELL_CHARS = 16_384;
export const MAX_TABLE_CHARS = 2_000_000;
export const MAX_ZIP_ENTRIES = 128;
export const MAX_XML_BYTES = 8 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
export const MAX_SHARED_STRINGS = 20_000;
export const MAX_SHARED_CHARS = 1_000_000;

export function invalidFile(): never {
  throw new Error("The file could not be read. Export the data as CSV or save a new, unencrypted XLSX file and try again.");
}

export function tableLimit(detail: string): never {
  throw new Error(`${detail} Export a smaller data range and upload it again. No rows have been saved.`);
}

export function workbookLimit(detail: string): never {
  throw new Error(`The expanded workbook exceeds the upload limits: ${detail} Export the data range as CSV and upload it again. No rows have been saved.`);
}
