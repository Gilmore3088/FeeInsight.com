/**
 * Offline only: local captured PDF -> review JSON. No credentials or database.
 * node --import tsx scripts/rosetta-unicode-preview.ts PDF SHA256 OUTPUT [INCUMBENT_JSON]
 * INCUMBENT_JSON is { "text": "...", "sha256": "...", "sourceSha256": "..." }.
 * Refuses to overwrite OUTPUT. Incomplete proposals retain unresolved corruption.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { previewPdfUnicodeRepair } from "../src/lib/agents/rosetta/pdf-unicode-preview";

async function main(args: string[]) {
  const [pdf, expectedSourceSha256, output, incumbentFile] = args;
  if (args.length < 3 || args.length > 4 || !/^[a-f0-9]{64}$/.test(expectedSourceSha256 ?? "")) {
    throw new Error("usage: node --import tsx scripts/rosetta-unicode-preview.ts PDF SHA256 OUTPUT [INCUMBENT_JSON]");
  }
  const incumbent: unknown = incumbentFile ? JSON.parse(readFileSync(incumbentFile, "utf8")) : undefined;
  if (incumbent !== undefined && (typeof incumbent !== "object" || incumbent === null
    || !("text" in incumbent) || typeof incumbent.text !== "string"
    || !("sha256" in incumbent) || typeof incumbent.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(incumbent.sha256)
    || !("sourceSha256" in incumbent) || typeof incumbent.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(incumbent.sourceSha256))) {
    throw new Error("incumbent JSON must contain text, its exact sha256 and sourceSha256");
  }
  const result = await previewPdfUnicodeRepair(new Uint8Array(readFileSync(pdf)), {
    expectedSourceSha256, incumbent: incumbent as { text: string; sha256: string; sourceSha256: string } | undefined,
  });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(`${output}: review required; Unicode guard ${result.complete ? "passes" : "still fails"}; no saved source or fee changed\n`);
}

main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
