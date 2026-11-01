import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isSwitchTooling, isTestSource, SWITCH_REPLAYS } from "./switch-replay";

/**
 * Plan step 4 (#2535): the inventory of every `*_LIVE` name in `src/`, generated into
 * `docs/project/switch-inventory.md` and checked by `switch-inventory.test.ts`, so a new switch
 * cannot land without a row. Read from the code only: production environment variables and
 * secrets are never read. A switch read from the environment is "unknown" in prod unless a
 * committed document records it being set (`DOCUMENTED_ENV_STATE`).
 *
 * Every column comes from the switch's own definition, so an unrelated edit (an import, a moved
 * line, a new day) never changes a row; only adding, flipping or moving a switch does.
 */

export const SWITCH_INVENTORY_PATH = "docs/project/switch-inventory.md";
const NAME = /\b[A-Z][A-Z0-9_]*_LIVE\b/g;
const RETIRE_AFTER_DAYS = 14;

export const NOT_REPLAYABLE =
  "no: the golden-set replay has no override for it (a sweep over live rows, a database step, or a value read inside its own module)";

/**
 * Environment switches whose prod value a committed document records. Never read from Vercel.
 * `reviewed` is the day the evidence was read for this inventory; the 14-day rule counts to it.
 */
export const DOCUMENTED_ENV_STATE: Readonly<Record<string, { on: boolean; since: string; reviewed: string; source: string }>> = {
  FEDERAL_BILLS_TRACKER_LIVE: { on: true, since: "2026-10-09", reviewed: "2026-11-01", source: "docs/project/findings/2026-10-09-congress-bills-flag-not-seen.md" },
  STATE_BILLS_TRACKER_LIVE: { on: true, since: "2026-10-08", reviewed: "2026-11-01", source: "docs/project/FINDINGS.md (Oct 8 entry)" },
};

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
  /** The golden-set replay scope (`SWITCH_REPLAYS`), or `NOT_REPLAYABLE`. */
  replay: string;
  retireCandidate: string;
  /** For `not_a_switch`: what the name is instead. */
  note: string | null;
}

export interface SwitchInventoryRow extends SwitchEntry {
  firstSeen: string;
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
    const replay = SWITCH_REPLAYS[name]?.scope ?? NOT_REPLAYABLE;
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

const HEADER = "| Name | Kind | Defined in | Code default | On in prod | First seen in src | Golden-set replay | Retire candidate |";
const NOT_A_SWITCH_HEADER = "| Name | Where | What it is |";

const cell = (value: string) => value.replace(/\|/g, "\\|");

/** The committed doc, rows sorted by name. `firstSeen` comes from git when a row is first written. */
export function renderInventory(rows: readonly SwitchInventoryRow[]): string {
  const switches = rows.filter(isSwitch);
  const others = rows.filter((row) => !isSwitch(row));
  const count = (pred: (row: SwitchInventoryRow) => boolean) => switches.filter(pred).length;
  const scopes = [...new Set(switches.map((row) => row.replay).filter(isReplayable))].sort()
    .map((scope) => `${count((row) => row.replay === scope)} ${scope}`).join(", ");
  return [
    "# Switch inventory",
    "",
    "Generated by `src/lib/agents/deming/switch-inventory.test.ts` (`SWITCH_INVENTORY_WRITE=1`), which fails when a",
    "`*_LIVE` name in `src/` has no row here or a row no longer matches the code. Do not edit by hand.",
    "Plan step 4 (#2535): a switch turns on only after its golden-set receipt passes",
    "(`src/lib/agents/deming/switch-gate.test.ts`; rule in `docs/project/DECISIONS.md`, 2026-11-01).",
    "",
    "How the columns are read:",
    "- **On in prod** comes from the code and committed docs only. A code constant is what `main` deploys.",
    "  An environment switch is unknown unless a committed doc records it being set; Vercel is never read.",
    "- **First seen in src** is the first commit whose diff adds the name under `src/` (`git log -S`).",
    "- **Golden-set replay**: `full` (every read on the replay path takes the override), `full on shadow cases`",
    "  (the regression members replay the PR head's own checks), `partial` (some reads keep the PR head's code",
    "  value; the receipt names them) or `no`. A `no` switch's receipt says \"not replayable\" and never passes;",
    "  it still needs its dry-run count and sample per the switch rule, and CI cannot block flipping it.",
    `- **Retire candidate**: the code default is on, or a doc records it on for ${RETIRE_AFTER_DAYS}+ days. Under the`,
    `  14-day rule (DECISIONS, 2026-11-01) a switch on ${RETIRE_AFTER_DAYS} days with no regression has its flag removed.`,
    "",
    `Switches: ${switches.length} (${count((r) => r.kind === "code_constant")} code constants, ${count((r) => r.kind === "code_constant_map")} constant map(s), ${count((r) => r.kind === "env")} environment). ` +
      `On by code default: ${count((r) => r.codeDefault === "on" || r.codeDefault === "on unless set off")}. Replayable on the golden set: ${count((r) => isReplayable(r.replay))} (${scopes}). ` +
      `Retire candidates: ${count((r) => r.retireCandidate.startsWith("yes"))}.`,
    "",
    HEADER,
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...switches.map((row) => `| ${[row.name, row.kind, `\`${row.definedAt}\``, row.codeDefault, row.prod, row.firstSeen, row.replay, row.retireCandidate].map(cell).join(" | ")} |`),
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

/** Reads back each switch row's first-seen cell from the committed doc. */
export function parseInventory(doc: string): Map<string, string> {
  const firstSeen = new Map<string, string>();
  for (const line of doc.split("\n")) {
    const cells = line.split(/(?<!\\)\|/).map((part) => part.trim());
    if (cells.length >= 10 && /^[A-Z][A-Z0-9_]*_LIVE$/.test(cells[1])) firstSeen.set(cells[1], cells[6]);
  }
  return firstSeen;
}

export const readInventoryDoc = (root: string = process.cwd()): string | null => {
  const path = join(root, SWITCH_INVENTORY_PATH);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};
