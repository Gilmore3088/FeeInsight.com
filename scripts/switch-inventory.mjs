/**
 * Read-only audit (#2535): prints the switch inventory, every `*_LIVE` name in `src/` with its kind,
 * code default, prod state, first commit, golden-set replay and retire flag.
 *
 *   npm run switch-inventory                 # the full Markdown table on stdout
 *   npm run switch-inventory -- --missing    # facts lines to add for switches with no first-seen
 *   npm run switch-inventory -- --verify     # recorded first commits that differ from git (exit 1)
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

// A fixed hash length (FIRST_SEEN_ABBREV, 9) keeps a larger clone from printing 10 characters.
function gitFirstSeen(name, shallow, abbrev) {
  if (shallow) return "unknown (shallow clone)";
  try {
    const log = execFileSync("git", ["log", "--reverse", `--abbrev=${abbrev}`, "--format=%ad %h", "--date=short", "-S", name, "HEAD", "--", "src"],
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
    const seen = gitFirstSeen(name, shallow, inventory.FIRST_SEEN_ABBREV);
    looked.push([name, seen]);
    return seen;
  });
  if (process.argv.includes("--verify") && shallow) {
    process.stdout.write("cannot verify first commits on a shallow clone: run on a full clone\n");
    process.exitCode = 1;
  } else if (process.argv.includes("--verify")) {
    // A recorded first commit is kept over git when they differ (git is slow on full history and
    // CI is shallow); this reports every disagreement so a maintenance PR can correct the facts.
    const { SWITCH_FACTS } = await jiti.import("../src/lib/agents/deming/switch-inventory-facts.ts");
    let differ = 0;
    for (const [name, facts] of Object.entries(SWITCH_FACTS)) {
      const seen = facts.firstSeen ? gitFirstSeen(name, shallow, inventory.FIRST_SEEN_ABBREV) : null;
      if (seen == null || inventory.sameFirstSeen(facts.firstSeen, seen)) continue;
      differ += 1;
      process.stdout.write(`${name}: recorded ${facts.firstSeen}, git ${seen}\n`);
    }
    process.stdout.write(`${differ} recorded first commits differ from git\n`);
    if (differ > 0) process.exitCode = 1;
  } else if (process.argv.includes("--missing")) {
    for (const [name, seen] of looked) process.stdout.write(`  ${name}: { firstSeen: "${seen}" },\n`);
  } else {
    process.stdout.write(inventory.renderInventory(rows));
  }
} catch (error) {
  console.error("switch inventory failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
