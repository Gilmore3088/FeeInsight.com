import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { SWITCH_REPLAYS } from "./switch-replay";

/**
 * Plan step 4 (#2535): the inventory of every `*_LIVE` name in `src/`, generated into
 * `docs/project/switch-inventory.md` and checked by `switch-inventory.test.ts`, so a new switch
 * cannot land without a row. Read from the code only: production environment variables and
 * secrets are never read. A switch read from the environment is "unknown" in prod unless a
 * committed document records it being set (`DOCUMENTED_ENV_STATE`).
 */

export const SWITCH_INVENTORY_PATH = "docs/project/switch-inventory.md";
const NAME = /\b[A-Z][A-Z0-9_]*_LIVE\b/g;
const RETIRE_AFTER_DAYS = 14;

/** Replay entry points: the golden set's pipeline variant and its regression replayer. */
const REPLAY_ENTRIES = ["src/lib/agents/deming/shadow-lab/variants.ts", "src/lib/agents/deming/checkers.ts"];

/** Environment switches whose prod value a committed document records. Never read from Vercel. */
export const DOCUMENTED_ENV_STATE: Readonly<Record<string, { on: boolean; since: string; source: string }>> = {
  FEDERAL_BILLS_TRACKER_LIVE: { on: true, since: "2026-10-09", source: "docs/project/findings/2026-10-09-congress-bills-flag-not-seen.md" },
  STATE_BILLS_TRACKER_LIVE: { on: true, since: "2026-10-08", source: "docs/project/FINDINGS.md (Oct 8 entry)" },
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
  /** The golden-set replay: "full", "partial", or "no: <why>". */
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

const isTest = (path: string) => /\.test\.tsx?$|\/__fixtures__\//.test(path);
/** The inventory and gate themselves name switches; they define none. */
const isSwitchTooling = (path: string) => /^src\/lib\/agents\/deming\/switch-(inventory|replay|gate)(\.test)?\.ts$/.test(path);

interface SourceFile { path: string; text: string; test: boolean }

function readSources(root: string): SourceFile[] {
  return walk(join(root, "src")).sort().flatMap((abs) => {
    const path = relative(root, abs).split("\\").join("/");
    return isSwitchTooling(path) ? [] : [{ path, text: readFileSync(abs, "utf8"), test: isTest(path) }];
  });
}


/** Modules the replay runs, following value imports (type-only imports run nothing). */
export function replayPathModules(root: string, entries: readonly string[] = REPLAY_ENTRIES): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (/\.(ts|tsx)$/.test(candidate) && existsSync(join(root, candidate))) return candidate;
    }
    return null;
  };
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const text = readFileSync(join(root, path), "utf8");
    for (const match of text.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g)) {
      if (match[2]) continue;
      const next = resolve(path, match[3]);
      if (next && !seen.has(next)) queue.push(next);
    }
    for (const match of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
      const next = resolve(path, match[1]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** Every distinct `*_LIVE` name in `src/`, classified from the code. */
export function scanSwitches(root: string = process.cwd(), asOf: string): SwitchEntry[] {
  const sources = readSources(root);
  const onPath = replayPathModules(root);
  const names = new Set<string>();
  for (const file of sources) for (const match of file.text.matchAll(NAME)) names.add(match[0]);
  const entries: SwitchEntry[] = [];
  for (const name of [...names].sort()) {
    const code = sources.filter((file) => !file.test && new RegExp(`\\b${name}\\b`).test(file.text));
    const constant = findFirst(code, new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::\\s*boolean)?\\s*=\\s*(true|false)\\b`));
    const map = constant ? null : findFirst(code, new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*\\{([^}]*)\\}`));
    const mapPairs = map ? [...map.match[1].matchAll(/(\w+)\s*:\s*(true|false)\b/g)].map((m) => [m[1], m[2] === "true"] as const) : [];
    const env = findFirst(code, new RegExp(`env(?:\\.${name}\\b|\\[\\s*["']${name}["']\\s*\\])|=\\s*["']${name}["']`));
    const referencedOnPath = code.some((file) => onPath.has(file.path));
    const mapped = SWITCH_REPLAYS[name];
    const replay = mapped
      ? mapped.scope
      : referencedOnPath
        ? "no: a module the replay loads names it, but the replay has no override for it"
        : "no: its code is not on the golden-set replay path (Knox free read, Darwin verify, Hamilton publish gate, Deming regression replay)";
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
        : documented?.on && daysBetween(documented.since, asOf) >= RETIRE_AFTER_DAYS
          ? `yes: documented on since ${documented.since}, ${RETIRE_AFTER_DAYS}+ days`
          : documented?.on ? "not yet: documented on under 14 days" : "no: prod value unknown";
      entries.push({ name, kind: "env", definedAt: env.at, codeDefault: defaultOn ? "on unless set off" : "off unless set", prod, replay, retireCandidate: retire, note: null });
      continue;
    }
    const where = code[0] ?? sources.find((file) => new RegExp(`\\b${name}\\b`).test(file.text))!;
    const index = where.text.search(new RegExp(`\\b${name}\\b`));
    const declaration = where.text.slice(index).split("\n")[0];
    const note = where.test
      ? "a test fixture's name, not a switch"
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

const HEADER = "| Name | Kind | Defined in | Code default | On in prod | First seen in src | Age (days) | Golden-set replay | Retire candidate |";
const ageDays = (firstSeen: string, asOf: string) => {
  const date = firstSeen.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return date ? String(Math.round(daysBetween(date, asOf))) : "unknown";
};
const NOT_A_SWITCH_HEADER = "| Name | Where | What it is |";

const cell = (value: string) => value.replace(/\|/g, "\\|");

/** The committed doc, rows sorted by name. `firstSeen` comes from git at write time. */
export function renderInventory(rows: readonly SwitchInventoryRow[], asOf: string): string {
  const switches = rows.filter(isSwitch);
  const others = rows.filter((row) => !isSwitch(row));
  const count = (pred: (row: SwitchInventoryRow) => boolean) => switches.filter(pred).length;
  const replayable = count((row) => row.replay === "full" || row.replay === "partial");
  return [
    "# Switch inventory",
    "",
    `Generated ${asOf} by \`src/lib/agents/deming/switch-inventory.test.ts\` (\`SWITCH_INVENTORY_WRITE=1\`), which fails when a`,
    "`*_LIVE` name in `src/` has no row here or a row no longer matches the code. Do not edit by hand.",
    "Plan step 4 (#2535): a switch turns on only after its golden-set receipt passes",
    "(`src/lib/agents/deming/switch-gate.test.ts`; rule in `docs/project/DECISIONS.md`, 2026-11-01).",
    "",
    "How the columns are read:",
    "- **On in prod** comes from the code and committed docs only. A code constant is what `main` deploys.",
    "  An environment switch is unknown unless a committed doc records it being set; Vercel is never read.",
    "- **First seen in src** is the first commit whose diff adds the name under `src/` (`git log -S`).",
    "- **Golden-set replay**: `full` (every read on the replay path takes the override), `partial` (some",
    "  reads keep the code value; the receipt names them) or `no` with the reason. A `no` switch's receipt",
    "  says \"not replayable\" and never passes; it still needs its dry-run count and sample per the switch rule.",
    `- **Retire candidate**: the code default is on, or a doc records it on for ${RETIRE_AFTER_DAYS}+ days. This PR removes no flag.`,
    "",
    `Switches: ${switches.length} (${count((r) => r.kind === "code_constant")} code constants, ${count((r) => r.kind === "code_constant_map")} constant maps, ${count((r) => r.kind === "env")} environment). ` +
      `On by code default: ${count((r) => r.codeDefault === "on" || r.codeDefault === "on unless set off")}. Replayable on the golden set: ${replayable} (${count((r) => r.replay === "full")} full, ${count((r) => r.replay === "partial")} partial). ` +
      `Retire candidates: ${count((r) => r.retireCandidate.startsWith("yes"))}.`,
    "",
    HEADER,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...switches.map((row) => `| ${[row.name, row.kind, `\`${row.definedAt}\``, row.codeDefault, row.prod, row.firstSeen, ageDays(row.firstSeen, asOf), row.replay, row.retireCandidate].map(cell).join(" | ")} |`),
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

/** Reads back the committed doc: its date and each row's first-seen cell. */
export function parseInventory(doc: string): { asOf: string | null; firstSeen: Map<string, string> } {
  const asOf = doc.match(/^Generated (\d{4}-\d{2}-\d{2}) /m)?.[1] ?? null;
  const firstSeen = new Map<string, string>();
  for (const line of doc.split("\n")) {
    const cells = line.split(/(?<!\\)\|/).map((part) => part.trim());
    if (cells.length >= 11 &&/^[A-Z][A-Z0-9_]*_LIVE$/.test(cells[1])) firstSeen.set(cells[1], cells[6]);
  }
  return { asOf, firstSeen };
}

export const readInventoryDoc = (root: string = process.cwd()): string | null => {
  const path = join(root, SWITCH_INVENTORY_PATH);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};
