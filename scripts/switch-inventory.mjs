/**
 * Read-only audit (#2535): prints the switch inventory, every `*_LIVE` name in `src/` with its kind,
 * code default, prod state, first commit, golden-set replay and retire flag.
 *
 *   npm run switch-inventory                 # the full Markdown table on stdout
 *   npm run switch-inventory -- --missing    # facts lines to add for switches with no first-seen
 *
 * Reads the working tree and, for a switch whose line in switch-inventory-facts.ts records no
 * first commit, `git log -S` (no network, no database, no environment values). Writes nothing.
 * The table is computed each time instead of committed (finding
 * docs/project/findings/2026-11-02-switch-inventory-doc-conflicts.md).
 * Logic: src/lib/agents/deming/switch-inventory.ts. The TypeScript runs through jiti.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = fileURLToPath(new URL("../src/", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": src } });

function gitFirstSeen(name, shallow) {
  if (shallow) return "unknown (shallow clone)";
  try {
    const log = execFileSync("git", ["log", "--reverse", "--format=%ad %h", "--date=short", "-S", name, "HEAD", "--", "src"],
      { cwd: root, encoding: "utf8" });
    return log.split("\n")[0]?.trim() || "not yet committed";
  } catch (error) {
    return `unknown (git: ${error instanceof Error ? error.message.split("\n")[0] : error})`;
  }
}

function isShallow() {
  try {
    return execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim() === "true";
  } catch {
    return true;
  }
}

try {
  const inventory = await jiti.import("../src/lib/agents/deming/switch-inventory.ts");
  const shallow = isShallow();
  const looked = [];
  const rows = inventory.inventoryRows(inventory.scanSwitches(root), (name) => {
    const seen = gitFirstSeen(name, shallow);
    looked.push([name, seen]);
    return seen;
  });
  if (process.argv.includes("--missing")) {
    for (const [name, seen] of looked) process.stdout.write(`  ${name}: { firstSeen: "${seen}" },\n`);
  } else {
    process.stdout.write(inventory.renderInventory(rows));
  }
} catch (error) {
  console.error("switch inventory failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
