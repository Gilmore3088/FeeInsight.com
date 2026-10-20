/**
 * LEI normalization with no imports, so FDIC, GLEIF and hold modules can share it without an
 * import cycle (gleif -> economy -> fdic -> gleif broke module evaluation in the Next build).
 */
const LEI_RE = /^[A-Z0-9]{18}[0-9]{2}$/;

export function normalizeLei(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  return LEI_RE.test(raw) ? raw : null;
}
