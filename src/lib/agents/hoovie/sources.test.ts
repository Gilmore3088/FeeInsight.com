import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REGISTRY_SOURCES } from "@/lib/agents/magellan/registry/index";
import { HOOVIE_SOURCES, hoovieSourceContract } from "./sources";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const LIB = join(process.cwd(), "src", "lib");
const REGISTRY = join(LIB, "agents", "magellan", "registry");

/** Source text with comments removed, so a table or key named only in prose does not count. */
function code(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/**
 * The loader's registry module and every registry module it imports, directly or not: shared
 * writers such as `economy.ts` (upsertAreaStats) and `identity.ts` (upsertIdentityLinks) live there.
 */
function registryModules(loader: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [loader];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    const text = code(join(REGISTRY, `${name}.ts`));
    seen.set(name, text);
    for (const match of text.matchAll(/from\s+"\.\/([a-z0-9-]+)"/g)) queue.push(match[1]);
  }
  return seen;
}

/** Tables the SQL in these modules inserts into, updates or deletes from. */
function writtenTables(modules: Iterable<string>): Set<string> {
  const tables = new Set<string>();
  for (const text of modules) {
    for (const match of text.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?"?([a-z_][a-z_0-9]*)"?/gi)) {
      tables.add(match[1].toLowerCase());
    }
  }
  return tables;
}

/** The registry modules plus the `@/lib/regulatory` modules they import, where keys are usually read. */
function keyReadingCode(modules: Map<string, string>): string {
  const texts = [...modules.values()];
  const regulatory = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/from\s+"@\/lib\/regulatory\/([a-z0-9-]+)"/g)) regulatory.add(match[1]);
  }
  for (const name of regulatory) texts.push(code(join(LIB, "regulatory", `${name}.ts`)));
  return texts.join("\n");
}

function migrationTables(): Set<string> {
  const tables = new Set<string>();
  for (const file of readdirSync(MIGRATIONS)) {
    if (!file.endsWith(".sql")) continue;
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const match of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) {
      tables.add(match[1].toLowerCase());
    }
  }
  return tables;
}

describe("Hoovie source contracts", () => {
  it("has exactly one contract per registry source, in registry order", () => {
    expect(HOOVIE_SOURCES.map((c) => c.source)).toEqual(REGISTRY_SOURCES.map((s) => s.source));
  });

  it("names a key for every keyed API and none elsewhere", () => {
    for (const contract of HOOVIE_SOURCES) {
      if (contract.connection === "keyed-api") expect(contract.envKey, contract.source).toMatch(/^[A-Z][A-Z0-9_]+$/);
      else expect(contract.envKey, contract.source).toBeUndefined();
    }
  });

  it("names optional keys as environment variables", () => {
    for (const contract of HOOVIE_SOURCES) {
      for (const key of contract.optionalEnvKeys ?? []) expect(key, contract.source).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  it("names the licence for every open-licence source", () => {
    for (const contract of HOOVIE_SOURCES.filter((c) => c.licence.status === "open-licence")) {
      expect(contract.licence.licenceName, contract.source).toBeTruthy();
    }
  });

  it("says what is unconfirmed for every held or unconfirmed licence", () => {
    for (const contract of HOOVIE_SOURCES.filter((c) => c.licence.status === "held" || c.licence.status === "terms-unconfirmed")) {
      expect(contract.licence.note, contract.source).toBeTruthy();
    }
  });

  it("gives every source a publisher and at least one grain", () => {
    for (const contract of HOOVIE_SOURCES) {
      expect(contract.publisher.trim(), contract.source).not.toBe("");
      expect(contract.grain.length, contract.source).toBeGreaterThan(0);
    }
  });

  it("writes only to tables the migrations create", () => {
    const known = migrationTables();
    const unknown = HOOVIE_SOURCES.flatMap((c) => c.tables.filter((t) => !known.has(t)).map((t) => `${c.source}: ${t}`));
    expect(unknown).toEqual([]);
  });

  it("names a registry loader module for every source", () => {
    const missing = HOOVIE_SOURCES.filter((c) => !existsSync(join(REGISTRY, `${c.loader}.ts`))).map((c) => `${c.source}: ${c.loader}`);
    expect(missing).toEqual([]);
  });

  it("names only tables its loader's SQL writes", () => {
    const unwritten = HOOVIE_SOURCES.flatMap((c) => {
      const written = writtenTables(registryModules(c.loader).values());
      return c.tables.filter((t) => !written.has(t)).map((t) => `${c.source} (${c.loader}): ${t}`);
    });
    expect(unwritten).toEqual([]);
  });

  it("names only keys its loader reads", () => {
    const unread = HOOVIE_SOURCES.flatMap((c) => {
      const text = keyReadingCode(registryModules(c.loader));
      const keys = [...(c.envKey ? [c.envKey] : []), ...(c.optionalEnvKeys ?? [])];
      return keys.filter((k) => !new RegExp(`["'\`]${k}["'\`]|env\\.${k}\\b`).test(text)).map((k) => `${c.source} (${c.loader}): ${k}`);
    });
    expect(unread).toEqual([]);
  });

  it("looks a contract up by source key", () => {
    const first = HOOVIE_SOURCES[0];
    expect(hoovieSourceContract(first.source)).toBe(first);
    expect(hoovieSourceContract("no-such-source")).toBeNull();
  });
});
