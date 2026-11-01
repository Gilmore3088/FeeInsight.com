import { DEFAULT_SWITCH_AUDIT_OPTIONS, type SwitchAuditOptions } from "./types";

/** The audit's command-line flags (`scripts/switch-dry-runs.ts`). Pure; an unknown flag throws. */

const NUMERIC_FLAGS: Readonly<Record<string, keyof SwitchAuditOptions>> = {
  "--sample": "sampleCap",
  "--row-cap": "rowCap",
  "--max-documents": "maxDocuments",
  "--accuracy-sample": "accuracySample",
};

export function parseSwitchAuditArgs(argv: readonly string[]): { json: boolean; options: SwitchAuditOptions } {
  const options: SwitchAuditOptions = { ...DEFAULT_SWITCH_AUDIT_OPTIONS };
  let json = false;
  for (let at = 0; at < argv.length; at += 1) {
    const [flag, inline] = argv[at].split("=", 2);
    if (flag === "--json") {
      json = true;
      continue;
    }
    const key = NUMERIC_FLAGS[flag];
    if (!key) throw new Error(`unknown flag ${argv[at]}; known: --json, ${Object.keys(NUMERIC_FLAGS).join(", ")}`);
    const raw = inline ?? argv[(at += 1)];
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} needs a whole number of 1 or more, got ${raw ?? "nothing"}`);
    options[key] = value;
  }
  return { json, options };
}
