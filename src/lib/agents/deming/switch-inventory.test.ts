// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSwitchTooling, isTestSource, NOT_REPLAYABLE_REASONS, NOT_REPLAYABLE_REASONS_PATH, SWITCH_REPLAYS } from "./switch-replay";
import { SWITCH_FACTS, SWITCH_FACTS_PATH } from "./switch-inventory-facts";
import {
  factsEntryLines,
  inventoryRows,
  isSwitch,
  mapEntryLines,
  MISSING_REASON,
  readInventoryDoc,
  renderInventory,
  scanSwitches,
  summarizeInventory,
  SWITCH_INVENTORY_DOC_PATH,
} from "./switch-inventory";

/**
 * Plan step 4 (#2535): every `*_LIVE` name in `src/` has an inventory row, checked against the
 * code itself. The table is printed on demand (`npm run switch-inventory`), never committed, so a
 * switch PR touches no shared derived file (finding 2026-11-02-switch-inventory-doc-conflicts.md).
 * What is committed is the hand-kept facts file, one line per switch, and these invariants on it.
 */

const root = process.cwd();
// Reading every file in src/ takes a few seconds, more on a loaded CI shard.
const TIMEOUT_MS = 60_000;
const FIRST_SEEN = /^\d{4}-\d{2}-\d{2} [0-9a-f]{7,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

describe("switch inventory", () => {
  it("renders one row for every *_LIVE name in src/, with counts computed from the rows", () => {
    const entries = scanSwitches(root);
    const rows = inventoryRows(entries, () => "not recorded");
    const table = renderInventory(rows);
    const rowNames = table.split("\n").map((line) => line.match(/^\| ([A-Z][A-Z0-9_]*_LIVE) \|/)?.[1]).filter(Boolean);
    const switches = entries.filter(isSwitch);
    const others = entries.filter((entry) => !isSwitch(entry));
    expect(rowNames).toEqual([...switches, ...others].map((entry) => entry.name));
    expect(new Set(rowNames).size).toBe(rowNames.length);
    expect(summarizeInventory(entries)).toMatch(new RegExp(`^Switches: ${switches.length} \\(`));
    expect(table).toContain(summarizeInventory(entries));
  }, TIMEOUT_MS);

  it("takes first-seen and notes from the facts file, and asks git only for a switch with none", () => {
    const asked: string[] = [];
    const rows = inventoryRows([
      { name: "DASH_LIST_ROWS_LIVE", kind: "code_constant", definedAt: "a.ts", codeDefault: "on", prod: "on (code constant)", replay: "full", retireCandidate: "no", note: null },
      { name: "BRAND_NEW_SWITCH_LIVE", kind: "code_constant", definedAt: "b.ts", codeDefault: "off", prod: "off (code constant)", replay: "full", retireCandidate: "no", note: null },
    ], (name) => { asked.push(name); return "2026-11-02 abcdef0"; });
    expect(rows[0].firstSeen).toBe(SWITCH_FACTS.DASH_LIST_ROWS_LIVE.firstSeen);
    expect(rows[1].firstSeen).toBe("2026-11-02 abcdef0");
    expect(asked).toEqual(["BRAND_NEW_SWITCH_LIVE"]);
  });

  it("keeps the facts file to one well-formed line per current switch", () => {
    const switches = new Map(scanSwitches(root).filter(isSwitch).map((entry) => [entry.name, entry]));
    const { names, spread } = factsEntryLines(readFileSync(join(root, SWITCH_FACTS_PATH), "utf8"));
    expect(spread, "facts entries must open and close on one line, so parallel PRs edit different lines").toEqual([]);
    expect(names.filter((name, i) => names.indexOf(name) !== i), "a switch named on two facts lines (two versions kept by a merge)").toEqual([]);
    expect(names.length, "every facts entry is read from its own line").toBe(Object.keys(SWITCH_FACTS).length);
    expect(names, "facts entries sorted by name (a union merge of two lines added at one spot can leave them swapped: reorder them)").toEqual([...names].sort());
    expect(names.filter((name) => !switches.has(name)), "facts lines for a name that is no longer a switch: delete them").toEqual([]);
    for (const [name, facts] of Object.entries(SWITCH_FACTS)) {
      if (facts.firstSeen != null) expect(facts.firstSeen, `${name} firstSeen`).toMatch(FIRST_SEEN);
      if (!facts.prod) continue;
      expect(switches.get(name)?.kind, `${name}: documented prod state is only for an environment switch`).toBe("env");
      expect([facts.prod.since, facts.prod.reviewed].every((day) => DAY.test(day)), `${name} prod dates`).toBe(true);
      expect(facts.prod.reviewed >= facts.prod.since, `${name}: reviewed before since`).toBe(true);
      expect(facts.prod.source.length, `${name}: prod state needs its committed source`).toBeGreaterThan(0);
    }
  }, TIMEOUT_MS);

  it("keeps NOT_REPLAYABLE_REASONS to one line per switch, sorted by name, in its own file", () => {
    const { names, spread } = mapEntryLines(readFileSync(join(root, NOT_REPLAYABLE_REASONS_PATH), "utf8"), "NOT_REPLAYABLE_REASONS");
    expect(spread, "reason entries must open and close on one line, so parallel PRs edit different lines").toEqual([]);
    expect(names.filter((name, i) => names.indexOf(name) !== i), "a switch with two reason lines (two versions kept by a merge)").toEqual([]);
    expect(names.length, "every reason is read from its own line").toBe(Object.keys(NOT_REPLAYABLE_REASONS).length);
    expect(names, "reasons sorted by name (a union merge of two lines added at one spot can leave them swapped: reorder them)").toEqual([...names].sort());
    expect(isSwitchTooling(NOT_REPLAYABLE_REASONS_PATH) && isSwitchTooling(SWITCH_FACTS_PATH)).toBe(true);
  });

  it("no switch tooling file defines a *_LIVE constant, so no switch hides from the scan", () => {
    const deming = join(root, "src/lib/agents/deming");
    const dryRuns = join(deming, "switch-dry-runs");
    const files = [
      ...readdirSync(deming).map((name) => `src/lib/agents/deming/${name}`),
      ...readdirSync(dryRuns).map((name) => `src/lib/agents/deming/switch-dry-runs/${name}`),
      ...readdirSync(join(root, "src/lib/data-store")).map((name) => `src/lib/data-store/${name}`),
    ].filter((path) => path.endsWith(".ts") && isSwitchTooling(path) && !isTestSource(path));
    expect(files).toEqual(expect.arrayContaining([SWITCH_FACTS_PATH, NOT_REPLAYABLE_REASONS_PATH,
      "src/lib/agents/deming/switch-replay.ts", "src/lib/agents/deming/switch-inventory.ts"]));
    const defining = files.filter((path) => /\b(?:const|let|var)\s+[A-Z][A-Z0-9_]*_LIVE\b/.test(readFileSync(join(root, path), "utf8")));
    expect(defining, "a switch defined in a tooling file is skipped by the inventory scan: define it in the code that reads it").toEqual([]);
  });

  it("reads a facts entry spread over lines, and both versions of a line a union merge kept", () => {
    const source = [
      "export const SWITCH_FACTS: Readonly<Record<string, SwitchFacts>> = {",
      '  A_LIVE: { firstSeen: "2026-10-01 abcdef0" },',
      '  B_LIVE: { firstSeen: "2026-10-02 abcdef1",',
      '    note: "x" },',
      '  A_LIVE: { firstSeen: "2026-10-01 abcdef0", note: "y" },',
      "};",
    ].join("\n");
    expect(factsEntryLines(source)).toEqual({ names: ["A_LIVE", "B_LIVE", "A_LIVE"], spread: ["B_LIVE", 'note: "x" },'] });
    const reasons = ["export const NOT_REPLAYABLE_REASONS: Readonly<Record<string, string>> = {",
      "  A_LIVE: `one; ${SYSTEM}`,", "  B_LIVE: `two", "    lines`,", "};"].join("\n");
    expect(mapEntryLines(reasons, "NOT_REPLAYABLE_REASONS")).toEqual({ names: ["A_LIVE", "B_LIVE"], spread: ["B_LIVE", "lines`,"] });
  });

  it("commits no derived table or counts in the explainer doc", () => {
    const doc = readInventoryDoc(root);
    expect(doc, `${SWITCH_INVENTORY_DOC_PATH} explains the printed inventory`).not.toBeNull();
    const derived = (doc ?? "").split("\n").filter((line) => /^\| [A-Z][A-Z0-9_]*_LIVE \|/.test(line) || /^Switches: \d+/.test(line));
    expect(derived, "the inventory table and counts are printed by `npm run switch-inventory`, never committed").toEqual([]);
    expect(doc).toContain("npm run switch-inventory");
  });

  it("classifies a constant, an environment switch and a name that is not a switch", () => {
    const entries = new Map(scanSwitches(root).map((entry) => [entry.name, entry]));
    expect(entries.get("DAILY_CAP_LINES_LIVE")).toMatchObject({ kind: "code_constant", codeDefault: "on", replay: "partial" });
    expect(entries.get("DASH_LIST_ROWS_LIVE")).toMatchObject({ kind: "code_constant", codeDefault: "on", replay: "full" });
    expect(entries.get("KNOX_HELD_NAME_RULES_LIVE")?.replay).toBe("full on shadow cases");
    expect(entries.get("KNOX_DISCONTINUED_TABLES_LIVE")).toMatchObject({ kind: "env", prod: expect.stringMatching(/^unknown/), replay: "full" });
    expect(entries.get("FEDERAL_BILLS_TRACKER_LIVE")?.retireCandidate).toMatch(/^yes: documented on since 2026-10-09/);
    expect(entries.get("RETENTION_LIVE")).toMatchObject({ kind: "code_constant_map" });
    expect(entries.get("ALREADY_LIVE")).toMatchObject({ kind: "not_a_switch", note: "a pattern constant, not a switch" });
    expect(entries.get("V8_LIVE")).toMatchObject({ kind: "not_a_switch", note: "a test fixture's name, not a switch" });
    expect(entries.get("CALL_PERIOD_PRUNE_LIVE")?.replay).toBe(`no: ${NOT_REPLAYABLE_REASONS.CALL_PERIOD_PRUNE_LIVE}`);
    expect(entries.get("BANDED_ZERO_TAKEDOWN_LIVE")?.replay).toBe("sweep");
    expect(entries.get("LIVE_NAME_REFRESH_LIVE")).toMatchObject({ kind: "env", codeDefault: "on unless set off", retireCandidate: "yes: code default on" });
  }, TIMEOUT_MS);

  it("every switch has a replay or a stated reason, and no reason is left for a replayable or missing switch", () => {
    const switches = scanSwitches(root).filter(isSwitch);
    const names = new Set(switches.map((entry) => entry.name));
    expect(switches.filter((entry) => entry.replay === MISSING_REASON).map((entry) => entry.name),
      "switches with no golden-set replay and no reason in NOT_REPLAYABLE_REASONS").toEqual([]);
    expect(Object.keys(NOT_REPLAYABLE_REASONS).filter((name) => SWITCH_REPLAYS[name] || !names.has(name)),
      "NOT_REPLAYABLE_REASONS lines for a switch that replays or no longer exists").toEqual([]);
  }, TIMEOUT_MS);
});
