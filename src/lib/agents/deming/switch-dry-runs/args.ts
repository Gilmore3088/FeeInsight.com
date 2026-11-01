import { DEFAULT_SWITCH_AUDIT_OPTIONS, type SwitchAuditOptions } from "./types";

/** The audit's command-line flags (`scripts/switch-dry-runs.mjs`). Pure; an unknown flag throws. */

const NUMERIC_FLAGS: Readonly<Record<string, Exclude<keyof SwitchAuditOptions, "institutionIds">>> = {
  "--sample": "sampleCap",
  "--row-cap": "rowCap",
  "--max-documents": "maxDocuments",
  "--accuracy-sample": "accuracySample",
};

const wholeNumber = (flag: string, raw: string | undefined): number => {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} needs a whole number of 1 or more, got ${raw ?? "nothing"}`);
  return value;
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
    if (flag === "--institution") {
      // One institution id or several, comma-separated: sections 1 to 3 read only them.
      const raw = inline ?? argv[(at += 1)];
      options.institutionIds = (raw ?? "").split(",").map((id) => wholeNumber(flag, id.trim()));
      continue;
    }
    const key = NUMERIC_FLAGS[flag];
    if (!key) throw new Error(`unknown flag ${argv[at]}; known: --json, --institution, ${Object.keys(NUMERIC_FLAGS).join(", ")}`);
    options[key] = wholeNumber(flag, inline ?? argv[(at += 1)]);
  }
  return { json, options };
}
