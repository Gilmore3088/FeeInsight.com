import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SWITCH_FACTS, type DocumentedProdState } from "./switch-inventory-facts";
import { isSwitchTooling, isTestSource, MISSING_REASON, replayCell } from "./switch-replay";

/**
 * Plan step 4 (#2535): the inventory of every `*_LIVE` name in `src/`, computed from the code each
 * time and printed by `npm run switch-inventory`; `switch-inventory.test.ts` checks it. It is not
 * committed: a committed copy made every switch PR conflict with every other one (finding
 * 2026-11-02-switch-inventory-doc-conflicts.md). The facts the code cannot give (first commit,
 * documented prod state, notes) live one line per switch in `switch-inventory-facts.ts`.
 * Production environment variables and secrets are never read. A switch read from the
 * environment is "unknown" in prod unless a committed document records it being set.
 */

/** The hand-written explainer: how to print the inventory and how its columns are read. */
export const SWITCH_INVENTORY_DOC_PATH = "docs/project/switch-inventory.md";
const NAME = /\b[A-Z][A-Z0-9_]*_LIVE\b/g;
const RETIRE_AFTER_DAYS = 14;

export { MISSING_REASON };

/** Environment switches whose prod value a committed document records (`prod` in the facts file). */
export const DOCUMENTED_ENV_STATE: Readonly<Record<string, DocumentedProdState>> = Object.fromEntries(
  Object.entries(SWITCH_FACTS).flatMap(([name, facts]) => (facts.prod ? [[name, facts.prod]] : [])),
);

export type SwitchKind = "code_constant" | "code_constant_map" | "env" | "not_a_switch";

export interface SwitchEntry {
  name: string;
  kind: SwitchKind;
  /** The file that defines or reads it (no line number, so an unrelated edit does not move the row). */
  definedAt: string;
  /** Code default: "on" / "off" for a constant, each key for a map, "off unless set" for env. */
  codeDefault: string;
  /** Whether it is on in prod, as far as the code and committed docs say. */
  prod: string;
  /** The golden-set replay scope (`SWITCH_REPLAYS`), or `no: <reason>` (`NOT_REPLAYABLE_REASONS`), or `MISSING_REASON`. */
  replay: string;
  retireCandidate: string;
  /** For `not_a_switch`: what the name is instead. */
  note: string | null;
}

export interface SwitchInventoryRow extends SwitchEntry {
  firstSeen: string;
  /** The facts file's `note`, or "". */
  factNote: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}


interface SourceFile { path: string; text: string; test: boolean }

function readSources(root: string): SourceFile[] {
  return walk(join(root, "src")).sort().flatMap((abs) => {
    const path = relative(root, abs).split("\\").join("/");
    return isSwitchTooling(path) ? [] : [{ path, text: readFileSync(abs, "utf8"), test: isTestSource(path) }];
  });
}

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** Every distinct `*_LIVE` name in `src/`, classified from the code. */
export function scanSwitches(root: string = process.cwd()): SwitchEntry[] {
  const sources = readSources(root);
  const names = new Set<string>();
  for (const file of sources) for (const match of file.text.matchAll(NAME)) names.add(match[0]);
  const entries: SwitchEntry[] = [];
  for (const name of [...names].sort()) {
    const code = sources.filter((file) => !file.test && new RegExp(`\\b${name}\\b`).test(file.text));
    const constant = findFirst(code, new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::\\s*boolean)?\\s*=\\s*(true|false)\\b`));
    const map = constant ? null : findFirst(code, new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*\\{([^}]*)\\}`));
    const mapPairs = map ? [...map.match[1].matchAll(/(\w+)\s*:\s*(true|false)\b/g)].map((m) => [m[1], m[2] === "true"] as const) : [];
    const env = findFirst(code, new RegExp(`env(?:\\.${name}\\b|\\[\\s*["']${name}["']\\s*\\])|=\\s*["']${name}["']`));
    const replay = replayCell(name);
    if (constant) {
      const on = constant.match[1] === "true";
      entries.push({ name, kind: "code_constant", definedAt: constant.at, codeDefault: on ? "on" : "off",
        prod: on ? "on (code constant)" : "off (code constant)", replay,
        retireCandidate: on ? "yes: code default on" : "no", note: null });
      continue;
    }
    if (map && mapPairs.length > 0) {
      const on = mapPairs.filter(([, value]) => value).map(([key]) => key);
      const value = mapPairs.map(([key, v]) => `${key} ${v ? "on" : "off"}`).join(", ");
      entries.push({ name, kind: "code_constant_map", definedAt: map.at, codeDefault: value, prod: `${value} (code constant)`, replay,
        retireCandidate: on.length === mapPairs.length ? "yes: every key on" : on.length > 0 ? `partly: ${on.join(", ")} on` : "no", note: null });
      continue;
    }
    if (env) {
      // A reader that returns true for an unset variable defaults on (#2072 moved three that way).
      const readerText = code.find((file) => file.path === env.at)?.text ?? "";
      const defaultOn = /raw\s*==\s*null[^\n]*\)\s*return\s+true\b/.test(readerText);
      const documented = DOCUMENTED_ENV_STATE[name];
      const prod = documented
        ? `${documented.on ? "on" : "off"} per ${documented.source} (set ${documented.since}; current value not read)`
        : defaultOn ? "on unless the environment sets it off (override not read)" : "unknown (environment variable; not read)";
      const retire = defaultOn
        ? "yes: code default on"
        : documented?.on && daysBetween(documented.since, documented.reviewed) >= RETIRE_AFTER_DAYS
          ? `yes: documented on since ${documented.since}, ${RETIRE_AFTER_DAYS}+ days at ${documented.reviewed}`
          : documented?.on ? "not yet: documented on under 14 days" : "no: prod value unknown";
      entries.push({ name, kind: "env", definedAt: env.at, codeDefault: defaultOn ? "on unless set off" : "off unless set", prod, replay, retireCandidate: retire, note: null });
      continue;
    }
    const where = code[0] ?? sources.find((file) => new RegExp(`\\b${name}\\b`).test(file.text))!;
    const index = where.text.search(new RegExp(`\\b${name}\\b`));
    const declaration = where.text.slice(index).split("\n")[0];
    const alias = declaration.match(/=\s*([A-Z][A-Z0-9_]*_LIVE)\s*;/)?.[1];
    const note = where.test
      ? "a test fixture's name, not a switch"
      : alias ? `an alias of ${alias}, not a separate switch`
      : /=\s*\//.test(declaration) ? "a pattern constant, not a switch"
        : /=\s*\d/.test(declaration) ? "a numeric threshold, not a switch"
          : /=\s*\[|readonly\s+\w+\[\]/.test(declaration) ? "a list of fees kept live, not a switch"
            : "not a boolean or environment switch";
    entries.push({ name, kind: "not_a_switch", definedAt: where.path, codeDefault: "n/a", prod: "n/a",
      replay: "n/a", retireCandidate: "n/a", note });
  }
  return entries;
}

function findFirst(files: SourceFile[], pattern: RegExp): { at: string; match: RegExpMatchArray } | null {
  for (const file of files) {
    const match = file.text.match(pattern);
    if (match && match.index != null) return { at: file.path, match };
  }
  return null;
}

export const isSwitch = (entry: Pick<SwitchEntry, "kind">) => entry.kind !== "not_a_switch";
export const isReplayable = (replay: string) => !replay.startsWith("no") && replay !== "n/a";

const HEADER = "| Name | Kind | Defined in | Code default | On in prod | First seen in src | Golden-set replay | Retire candidate | Note |";
const NOT_A_SWITCH_HEADER = "| Name | Where | What it is |";

const cell = (value: string) => value.replace(/\|/g, "\\|");

/** The summary line, every count computed from the rows (never hand-kept, so it cannot go stale). */
export function summarizeInventory(rows: readonly SwitchEntry[]): string {
  const switches = rows.filter(isSwitch);
  const count = (pred: (row: SwitchEntry) => boolean) => switches.filter(pred).length;
  const scopes = [...new Set(switches.map((row) => row.replay).filter(isReplayable))].sort()
    .map((scope) => `${count((row) => row.replay === scope)} ${scope}`).join(", ");
  const missing = count((r) => r.replay === MISSING_REASON);
  return `Switches: ${switches.length} (${count((r) => r.kind === "code_constant")} code constants, ${count((r) => r.kind === "code_constant_map")} constant map(s), ${count((r) => r.kind === "env")} environment). ` +
    `On by code default: ${count((r) => r.codeDefault === "on" || r.codeDefault === "on unless set off")}. Replayable on the golden set: ${count((r) => isReplayable(r.replay))} (${scopes}); not replayable with a stated reason: ${count((r) => !isReplayable(r.replay) && r.replay !== MISSING_REASON)}${missing > 0 ? `; with NO REASON: ${missing}` : ""}. ` +
    `Retire candidates: ${count((r) => r.retireCandidate.startsWith("yes"))}.`;
}

/**
 * Joins the scanned entries with the facts file. `firstSeenOf` is asked only for a switch whose
 * facts line has no `firstSeen` (or that has no line): the printer asks git, a test a constant.
 */
export function inventoryRows(entries: readonly SwitchEntry[], firstSeenOf: (name: string) => string): SwitchInventoryRow[] {
  return entries.map((entry) => {
    if (!isSwitch(entry)) return { ...entry, firstSeen: "", factNote: "" };
    const facts = SWITCH_FACTS[entry.name];
    return { ...entry, firstSeen: facts?.firstSeen ?? firstSeenOf(entry.name), factNote: facts?.note ?? "" };
  });
}

/** The full table, rows sorted by name, as `npm run switch-inventory` prints it. */
export function renderInventory(rows: readonly SwitchInventoryRow[]): string {
  const switches = rows.filter(isSwitch);
  const others = rows.filter((row) => !isSwitch(row));
  return [
    "# Switch inventory",
    "",
    "Printed by `npm run switch-inventory` from the code and `src/lib/agents/deming/switch-inventory-facts.ts`;",
    `not committed. How each column is read: \`${SWITCH_INVENTORY_DOC_PATH}\`.`,
    "",
    summarizeInventory(rows),
    "",
    HEADER,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...switches.map((row) => `| ${[row.name, row.kind, `\`${row.definedAt}\``, row.codeDefault, row.prod, row.firstSeen, row.replay, row.retireCandidate, row.factNote].map(cell).join(" | ")} |`),
    "",
    `## Names that are not switches (${others.length})`,
    "",
    "They match `*_LIVE` but hold no on/off state; listed so the check covers every name.",
    "",
    NOT_A_SWITCH_HEADER,
    "| --- | --- | --- |",
    ...others.map((row) => `| ${[row.name, `\`${row.definedAt}\``, row.note ?? ""].map(cell).join(" | ")} |`),
    "",
  ].join("\n");
}

/** The facts file's entry keys in order, and any entry that does not open and close on one line. */
export function factsEntryLines(source: string): { names: string[]; spread: string[] } {
  const body = source.slice(source.indexOf("SWITCH_FACTS:"));
  const names: string[] = [];
  const spread: string[] = [];
  for (const line of body.split("\n")) {
    const key = line.match(/^\s+([A-Z][A-Z0-9_]*_LIVE)\s*:/)?.[1];
    if (!key) continue;
    names.push(key);
    if (!/^\s+[A-Z][A-Z0-9_]*_LIVE\s*:\s*\{.*\},\s*$/.test(line)) spread.push(key);
  }
  return { names, spread };
}

export const readInventoryDoc = (root: string = process.cwd()): string | null => {
  const path = join(root, SWITCH_INVENTORY_DOC_PATH);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};
