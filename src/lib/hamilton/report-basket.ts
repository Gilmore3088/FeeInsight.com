import type { HamiltonIdentitySnapshot } from "./account-context";
import { readHamiltonIdentitySnapshot } from "./identity-display";
/**
 * The report basket: findings and tests a user adds from Position, Ask and
 * Test, which the Report page turns into the board brief. Kept in the
 * browser (per device) and sent with the generate request; the server
 * re-validates every item with sanitizeBasketItems before using it.
 */

export type ReportBasketSource = "Position" | "Ask" | "Test";

export interface ReportBasketItem {
  id: string;
  source: ReportBasketSource;
  title: string;
  detail: string;
  feeCategory: string | null;
  institutionId: string | null;
  addedAt: string;
  /** Original server-saved answer to revalidate when a report is generated. */
  savedAnalysisId?: string | null;
  identityContext?: HamiltonIdentitySnapshot;
}

export const REPORT_BASKET_KEY = "hamilton-report-basket-v1";
export const REPORT_BASKET_MAX = 12;
const CHANGE_EVENT = "hamilton-report-basket-change";
const SOURCES: ReportBasketSource[] = ["Position", "Ask", "Test"];

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Keeps only well-formed items, trimmed to safe lengths, newest last, at most 12. */
export function sanitizeBasketItems(raw: unknown): ReportBasketItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: ReportBasketItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = clip(e.id, 120);
    const title = clip(e.title, 200);
    const source = SOURCES.includes(e.source as ReportBasketSource) ? (e.source as ReportBasketSource) : null;
    if (!id || !title || !source || seen.has(id)) continue;
    seen.add(id);
    const feeCategory = clip(e.feeCategory, 60);
    const institutionId = clip(e.institutionId, 20);
    const snapshot = readHamiltonIdentitySnapshot(e.identityContext);
    const savedAnalysisId = clip(e.savedAnalysisId, 40);
    items.push({
      id,
      source,
      title,
      detail: clip(e.detail, 1200),
      feeCategory: /^[a-z0-9_]+$/.test(feeCategory) ? feeCategory : null,
      institutionId: snapshot ? (snapshot.researchInstitutionId === null ? null : String(snapshot.researchInstitutionId)) : /^\d+$/.test(institutionId) ? institutionId : null,
      ...(snapshot ? { identityContext: snapshot } : {}),
      ...(savedAnalysisId ? { savedAnalysisId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(savedAnalysisId) ? savedAnalysisId : null } : {}),
      addedAt: clip(e.addedAt, 40) || new Date(0).toISOString(),
    });
  }
  return items.slice(-REPORT_BASKET_MAX);
}

/** Items for one bank (or every item when no bank is chosen). */
export function basketItemsFor(items: ReportBasketItem[], institutionId: string | null | undefined): ReportBasketItem[] {
  if (!institutionId) return items;
  return items.filter((item) => item.institutionId === null || item.institutionId === String(institutionId));
}

// ─── Browser storage ──────────────────────────────────────────────────────────

let cachedRaw: string | null | undefined;
let cachedItems: ReportBasketItem[] = [];
const EMPTY: ReportBasketItem[] = [];

export function readBasket(): ReportBasketItem[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(REPORT_BASKET_KEY);
  } catch {
    return EMPTY;
  }
  // Same string, same array: lets useSyncExternalStore skip re-renders.
  if (raw === cachedRaw) return cachedItems;
  cachedRaw = raw;
  try {
    cachedItems = raw ? sanitizeBasketItems(JSON.parse(raw)) : EMPTY;
  } catch {
    cachedItems = EMPTY;
  }
  return cachedItems;
}

function writeBasket(items: ReportBasketItem[]): void {
  try {
    window.localStorage.setItem(REPORT_BASKET_KEY, JSON.stringify(items.slice(-REPORT_BASKET_MAX)));
  } catch {
    // Storage blocked (private mode): the basket simply doesn't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function addToBasket(item: Omit<ReportBasketItem, "addedAt">): void {
  const items = readBasket().filter((existing) => existing.id !== item.id);
  writeBasket([...items, { ...item, addedAt: new Date().toISOString() }]);
}

export function removeFromBasket(id: string): void {
  writeBasket(readBasket().filter((item) => item.id !== id));
}

export function subscribeToBasket(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Stable id for a finding so adding it twice doesn't duplicate it. */
export function basketItemId(...parts: Array<string | number | null | undefined>): string {
  const text = parts.filter((p) => p !== null && p !== undefined && p !== "").join("|");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `b${(hash >>> 0).toString(36)}`;
}
