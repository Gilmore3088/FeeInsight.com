// @vitest-environment node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSwitch,
  parseInventory,
  readInventoryDoc,
  renderInventory,
  scanSwitches,
  SWITCH_INVENTORY_PATH,
  type SwitchInventoryRow,
} from "./switch-inventory";

/**
 * Plan step 4 (#2535): `docs/project/switch-inventory.md` has a row for every `*_LIVE` name in
 * `src/`, and each row matches the code. A new switch, a flipped default or a moved definition
 * fails here until the doc is regenerated in the same PR:
 * `SWITCH_INVENTORY_WRITE=1 npx vitest run src/lib/agents/deming/switch-inventory.test.ts`
 * (needs full git history for the first-seen column; a shallow clone writes "unknown").
 */

const root = process.cwd();
const write = process.env.SWITCH_INVENTORY_WRITE === "1";
// Reading every file in src/ takes a few seconds, more on a loaded CI shard.
const TIMEOUT_MS = 60_000;

function firstSeen(name: string, asOf: string): string {
  try {
    if (execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim() === "true") return "unknown (shallow clone)";
    const log = execFileSync("git", ["log", "--reverse", "--format=%ad %h", "--date=short", "-S", name, "HEAD", "--", "src"], { cwd: root, encoding: "utf8" });
    return log.split("\n")[0]?.trim() || `${asOf} (this change)`;
  } catch {
    return "unknown";
  }
}

describe("switch inventory", () => {
  it("has a row for every *_LIVE name in src/, matching the code", () => {
    const doc = readInventoryDoc(root);
    const parsed = doc ? parseInventory(doc) : { asOf: null, firstSeen: new Map<string, string>() };
    const asOf = write || !parsed.asOf ? new Date().toISOString().slice(0, 10) : parsed.asOf;
    const entries = scanSwitches(root, asOf);
    const rows: SwitchInventoryRow[] = entries.map((entry) => ({
      ...entry,
      // A row keeps its first-seen cell; only a new switch is looked up in git.
      firstSeen: !isSwitch(entry) ? "" : parsed.firstSeen.get(entry.name) ?? (write ? firstSeen(entry.name, asOf) : "missing"),
    }));
    const expected = renderInventory(rows, asOf);
    if (write) writeFileSync(join(root, SWITCH_INVENTORY_PATH), expected);

    const missing = rows.filter((row) => isSwitch(row) && !parsed.firstSeen.has(row.name)).map((row) => row.name);
    expect(doc, `${SWITCH_INVENTORY_PATH} is missing: generate it with SWITCH_INVENTORY_WRITE=1`).not.toBeNull();
    expect(missing, "switches with no inventory row: regenerate the doc with SWITCH_INVENTORY_WRITE=1").toEqual([]);
    expect(write ? expected : doc, "the inventory no longer matches the code: regenerate it with SWITCH_INVENTORY_WRITE=1").toBe(expected);
  }, write ? 600_000 : TIMEOUT_MS);

  it("classifies a constant, an environment switch and a name that is not a switch", () => {
    const entries = new Map(scanSwitches(root, "2026-11-01").map((entry) => [entry.name, entry]));
    expect(entries.get("DAILY_CAP_LINES_LIVE")).toMatchObject({ kind: "code_constant", codeDefault: "off", replay: "partial" });
    expect(entries.get("KNOX_DISCONTINUED_TABLES_LIVE")).toMatchObject({ kind: "env", prod: expect.stringMatching(/^unknown/), replay: "full" });
    expect(entries.get("FEDERAL_BILLS_TRACKER_LIVE")?.retireCandidate).toMatch(/^yes: documented on since 2026-10-09/);
    expect(entries.get("RETENTION_LIVE")).toMatchObject({ kind: "code_constant_map" });
    expect(entries.get("ALREADY_LIVE")).toMatchObject({ kind: "not_a_switch", note: "a pattern constant, not a switch" });
    expect(entries.get("V8_LIVE")).toMatchObject({ kind: "not_a_switch", note: "a test fixture's name, not a switch" });
    expect(entries.get("CALL_PERIOD_PRUNE_LIVE")?.replay).toMatch(/^no: /);
    expect(entries.get("LIVE_NAME_REFRESH_LIVE")).toMatchObject({ kind: "env", codeDefault: "on unless set off", retireCandidate: "yes: code default on" });
  }, TIMEOUT_MS);
});
