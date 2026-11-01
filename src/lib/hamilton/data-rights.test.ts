/**
 * V5 T6 data rights (#1872, DECISIONS.md "No non-commercial data"): Hamilton never shows a row
 * from a source whose terms bar commercial use, or one held until its terms are read.
 *
 * Rows already loaded from struck sources stay on prod, so the guard is the reader: every query
 * in the app that reads a table holding such rows must apply the struck/held filter from
 * src/lib/data-store/struck-sources.ts (or the federal-only filter from news.ts). This sweep reads
 * every app file outside the loaders and fails on a reader that does not, so a new screen, report
 * or Ask tool cannot bring a struck source back. Readers pinned to one source whose licence is
 * public or open are listed with that source, and the source's licence is checked here too.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOOVIE_SOURCES } from "@/lib/agents/hoovie/sources";
import { HELD_REGISTRY_SOURCES } from "@/lib/agents/registry-scheduler";
import {
  HELD_SOURCES, STRUCK_AREA_SOURCES, STRUCK_ENFORCEMENT_AGENCIES, STRUCK_REG_ARTICLE_SOURCES, isHiddenRegArticleSource,
} from "@/lib/data-store/struck-sources";
import { FEDERAL_RELEASES_ONLY, STATE_NEWS_SOURCE_PATTERNS } from "@/lib/data-store/news";

const SRC = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Tables that still hold rows from struck or held sources, and the filters that hide them. */
const GUARDED: Record<string, RegExp> = {
  reg_articles: /STRUCK_REG_ARTICLE_SOURCES|HELD_REG_ARTICLE_PATTERN|HELD_SOURCES|STATE_NEWS_SOURCE_PATTERNS|FEDERAL_RELEASES_ONLY|isHiddenRegArticleSource/,
  institution_enforcement_actions: /STRUCK_ENFORCEMENT_AGENCIES/,
  area_statistics: /areaRowServedSql|servedSql/,
  fed_economic_indicators: /fedIndicatorServedSql|STRUCK_FRED_SERIES/,
};

/**
 * Readers that need no filter, each with why. A pinned source is checked against its licence
 * contract below.
 */
const EXEMPT: Record<string, { reason: string; pinnedSource?: string }> = {
  "app/admin/query/query-client.tsx#fed_economic_indicators": { reason: "staff-only SQL console text, not a customer reader" },
  "lib/data-store/struck-sources.ts#area_statistics": { reason: "the filter itself" },
  "lib/data-store/struck-sources.ts#fed_economic_indicators": { reason: "the filter itself" },
  "lib/data-store/local-economy.ts#area_statistics": { reason: "reads only BLS QCEW pay", pinnedSource: "bls-qcew" },
  "lib/data-store/registry-profile.ts#area_statistics": { reason: "reads only USDA county names", pinnedSource: "usda-rucc" },
  "lib/data-store/locations-gleif-aggregates.ts#area_statistics": { reason: "reads only AllThePlaces counts", pinnedSource: "alltheplaces" },
};

const files = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
  // Loaders write these tables; they are not readers a customer sees.
  .filter((f) => !f.startsWith("lib/agents/"));

const readers = files.flatMap((file) => {
  const text = readFileSync(path.join(SRC, file), "utf8");
  return Object.keys(GUARDED)
    .filter((table) => new RegExp(`(FROM|JOIN)\\s+(public\\.)?${table}\\b`).test(text))
    .map((table) => ({ file, table, text }));
});

describe("Hamilton data rights: struck and held sources never reach a reader (V5 T6, #1872)", () => {
  it("finds the readers it guards", () => {
    expect(readers.length).toBeGreaterThan(10);
    expect(readers.some((r) => r.file === "lib/hamilton/workspace/research.ts" && r.table === "reg_articles")).toBe(true);
  });

  it.each(Object.keys(GUARDED))("every reader of %s applies the struck/held filter or is exempt with a reason", (table) => {
    const unguarded = readers
      .filter((r) => r.table === table && !GUARDED[table].test(r.text) && !EXEMPT[`${r.file}#${table}`])
      .map((r) => r.file);
    expect(unguarded, "apply the filter from src/lib/data-store/struck-sources.ts, or add an EXEMPT entry with its reason").toEqual([]);
  });

  it("lists no exemption that is no longer a reader", () => {
    const live = new Set(readers.map((r) => `${r.file}#${r.table}`));
    expect(Object.keys(EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });

  it("each pinned exemption reads only its source, and that source's licence allows commercial display", () => {
    for (const [key, { pinnedSource }] of Object.entries(EXEMPT)) {
      if (!pinnedSource) continue;
      const file = key.split("#")[0];
      const text = readFileSync(path.join(SRC, file), "utf8");
      expect(text.includes(`'${pinnedSource}'`) || text.includes(`"${pinnedSource}"`), `${file} names ${pinnedSource}`).toBe(true);
      const contract = HOOVIE_SOURCES.find((s) => s.source === pinnedSource);
      expect(contract, `${pinnedSource} has a licence contract`).toBeDefined();
      expect(["public-domain", "open-licence"], `${pinnedSource} licence`).toContain(contract!.licence.status);
      expect(STRUCK_AREA_SOURCES).not.toContain(pinnedSource);
    }
  });

  it("every source held for unread terms is unscheduled and hidden from readers", () => {
    const held = HOOVIE_SOURCES.filter((s) => s.licence.status === "held").map((s) => s.source).sort();
    expect(held).toEqual([...HELD_SOURCES].sort());
    for (const source of held) expect(HELD_REGISTRY_SOURCES.has(source)).toBe(true);
    // Google News press rows are stored as reg_articles "news:XX".
    expect(isHiddenRegArticleSource("news:TX")).toBe(true);
    expect(STATE_NEWS_SOURCE_PATTERNS).toContain("news:%");
    expect(FEDERAL_RELEASES_ONLY).toContain("source NOT LIKE 'news:%'");
  });

  it("the regulator sites struck for non-commercial terms (NY, NC, FL) are hidden in posts and orders", () => {
    for (const state of ["NY", "NC", "FL"]) {
      expect(STRUCK_REG_ARTICLE_SOURCES).toContain(`state:${state}`);
      expect(isHiddenRegArticleSource(`state:${state}`)).toBe(true);
    }
    for (const state of ["NY", "NC"]) expect(STRUCK_ENFORCEMENT_AGENCIES).toContain(`STATE_${state}`);
    // A state whose terms allow reuse stays visible.
    expect(isHiddenRegArticleSource("state:NJ")).toBe(false);
  });

  it("no licence contract still marked loadable says its terms are non-commercial", () => {
    // A note may record that part of a source was struck; the status must then not be open or public.
    const offenders = HOOVIE_SOURCES.filter((s) =>
      (s.licence.status === "public-domain" || s.licence.status === "open-licence") &&
      /\b(non-?commercial|noncommercial|not for (private|commercial) gain|personal use only)\b/i.test(`${s.licence.licenceName ?? ""} ${s.licence.note ?? ""}`) &&
      !/struck|removed|replaced/i.test(s.licence.note ?? ""),
    ).map((s) => s.source);
    expect(offenders).toEqual([]);
  });
});
