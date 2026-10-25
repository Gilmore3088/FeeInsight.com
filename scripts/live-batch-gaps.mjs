/**
 * Read-only audit (#2066): would an existing loop have caught each miss of the weekly live check?
 *
 * The weekly live check (data-quality/weekly-live-batch/) gives the accuracy score. This tags each
 * miss in a week's per-fee results with the step that caused it and what the pipeline did about it:
 *   - caught_routed: an error row (`pipeline_feedback`, wrong or missed, not a record) is on the fee,
 *     and a reader of the cause step's agent reads it (`feedbackRowRead` and `FEEDBACK_KINDS`, #2062);
 *   - caught_not_routed: an error row is on the fee, but no reader of that agent reads any of them;
 *   - not_caught: no error row is on the fee, or the fee was missing (only answer-key banks check
 *     for a missing fee): a gap, which gets a planted case (`deming/planted-errors.ts`) and an issue;
 *   - unresolved: the result row names no fee id and no single live fee matches its name and amount.
 *
 * Two steps, because the production read runs through the read-only SQL tool, never from here:
 *   node scripts/live-batch-gaps.mjs sql <results.csv> <as-of YYYY-MM-DD>      prints one SELECT
 *   node scripts/live-batch-gaps.mjs tag <results.csv> <found.json> <out.csv>  writes the tags
 * `found.json` is the SELECT's single `found` value: [[row, fee_id, ["kind|stage|check|t", ...]], ...]
 * where `t` marks the takedown sync's extract row. Writes nothing but `out.csv`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The step each verdict of the weekly check blames, and the agent that runs it. */
export const CAUSE_STEP = {
  WRONG_DOCUMENT: "discover",
  STALE_SOURCE: "discover",
  WRONG_AMOUNT: "extract",
  WRONG_CATEGORY: "extract",
  BAD_NAME: "extract",
  WRONG_AUDIENCE: "extract",
  NOT_A_FEE: "extract",
  MISSING: "extract",
};
export const STEP_OWNER = { discover: "magellan", read: "rosetta", extract: "knox", verify: "darwin", publish: "hamilton" };
export const TAGS = ["caught_routed", "caught_not_routed", "not_caught", "unresolved"];

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  return body.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""])));
}

export function toCsv(rows) {
  if (rows.length === 0) return "";
  const header = Object.keys(rows[0]);
  const cell = (value) => (/[",\n\r]/.test(String(value ?? "")) ? `"${String(value).replace(/"/g, '""')}"` : String(value ?? ""));
  return [header.join(","), ...rows.map((row) => header.map((name) => cell(row[name])).join(","))].join("\n") + "\n";
}

/** The misses of a week's results: every judged row that did not match, with its fee id when the notes give one. */
export function liveBatchMisses(rows) {
  return rows.flatMap((row, index) => {
    if (!(row.verdict in CAUSE_STEP)) return [];
    const id = /record_id=(\d+)/.exec(row.notes ?? "")?.[1];
    const amount = Number(String(row.amount_on_site ?? "").split("/")[0].replace(/[^0-9.]/g, ""));
    return [{
      row: index,
      verdict: row.verdict,
      step: CAUSE_STEP[row.verdict],
      feeId: id ? Number(id) : null,
      institutionId: Number(row.institution_id),
      feeName: row.fee_name_on_site ?? "",
      amount: Number.isFinite(amount) && String(row.amount_on_site ?? "").match(/\d/) ? amount : null,
    }];
  });
}

const literal = (value) => (value == null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, "''")}'`);

/**
 * One read-only SELECT: each miss's fee (its id, or the single fee live at `asOf` at that bank
 * with that name and amount) and the distinct error rows on it. A missing fee has no row to look up.
 */
export function liveBatchGapSql(misses, asOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("as-of must be YYYY-MM-DD");
  const looked = misses.filter((miss) => miss.verdict !== "MISSING");
  if (looked.length === 0) return "SELECT '[]'::json AS found";
  // The name and amount are only needed to find a fee the row names no id for.
  const values = looked.map((miss) => miss.feeId != null
    ? `(${miss.row}, ${miss.feeId}::bigint, NULL::bigint, NULL::text, NULL::numeric)`
    : `(${miss.row}, NULL::bigint, ${miss.institutionId}, ${literal(miss.feeName)}, ${literal(miss.amount)}::numeric)`).join(",\n  ");
  return `-- Read-only: weekly live-check misses and the error rows on their fees (#2066).
WITH m(i, fee_id, institution_id, fee_name, amount) AS (VALUES
  ${values}
),
resolved AS (
  SELECT m.i, COALESCE(m.fee_id, (
    SELECT CASE WHEN COUNT(*) = 1 THEN MIN(fp.fee_published_id) END
      FROM published_fee_records fp
     WHERE fp.institution_id = m.institution_id
       AND lower(btrim(fp.fee_name)) = lower(btrim(m.fee_name))
       AND fp.amount IS NOT DISTINCT FROM m.amount
       AND fp.published_at < (${literal(asOf)}::date + 1)
       AND (fp.rolled_back_at IS NULL OR fp.rolled_back_at >= ${literal(asOf)}::date)
  )) AS fee_id
    FROM m
)
SELECT COALESCE(json_agg(json_build_array(r.i, r.fee_id, COALESCE((
  SELECT json_agg(DISTINCT f.kind || '|' || f.about_stage || '|' || COALESCE(f.check_name, '') || '|' ||
                  CASE WHEN f.dedupe_key LIKE 'hamilton.takedown:pub:%:extract' THEN 't' ELSE '' END)
    FROM pipeline_feedback f
   WHERE f.fee_published_id = r.fee_id AND f.signal IN ('wrong', 'missed')
), '[]'::json)) ORDER BY r.i), '[]'::json) AS found
  FROM resolved r`;
}

/** Tags one miss from the error rows found on its fee. `registry` is `learning/feedback-kinds.ts`. */
export function tagLiveBatchMiss(miss, found, registry) {
  if (miss.verdict === "MISSING") return { tag: "not_caught", rows: [] };
  if (!found || found.feeId == null) return { tag: "unresolved", rows: [] };
  const owner = STEP_OWNER[miss.step];
  const rows = found.rows.map((packed) => {
    const [kind, about_stage, check_name, mark] = packed.split("|");
    return { kind, about_stage, check_name: check_name || null, dedupe_key: mark === "t" ? `hamilton.takedown:pub:${found.feeId}:extract` : null };
  });
  const errors = rows.filter((row) => !("record" in (registry.FEEDBACK_KINDS[row.kind] ?? {})));
  if (errors.length === 0) return { tag: "not_caught", rows };
  const routed = errors.some((row) => {
    const entry = registry.FEEDBACK_KINDS[row.kind];
    return entry && "readers" in entry && entry.readers.some((file) => file.startsWith(`src/lib/agents/${owner}/`)) && registry.feedbackRowRead(row);
  });
  return { tag: routed ? "caught_routed" : "caught_not_routed", rows };
}

export function tagLiveBatch(rows, foundList, registry) {
  const found = new Map(foundList.map(([row, feeId, packed]) => [row, { feeId, rows: packed ?? [] }]));
  const misses = liveBatchMisses(rows);
  const tagged = misses.map((miss) => ({ ...miss, feeId: found.get(miss.row)?.feeId ?? miss.feeId, ...tagLiveBatchMiss(miss, found.get(miss.row), registry) }));
  const counts = Object.fromEntries(TAGS.map((tag) => [tag, tagged.filter((miss) => miss.tag === tag).length]));
  const byStep = {};
  for (const miss of tagged) {
    const key = `${miss.step}:${miss.tag}`;
    byStep[key] = (byStep[key] ?? 0) + 1;
  }
  return { tagged, counts, byStep, misses: tagged.length };
}

/** The scorecard's line: the gap count beside accuracy, so a quiet week reads zero, not unknown. */
export function gapLine(summary) {
  const { counts, misses } = summary;
  return `${misses} misses: ${counts.not_caught} not caught (gaps), ${counts.caught_not_routed} caught but not routed to the step that made them, ${counts.caught_routed} caught and routed, ${counts.unresolved} unresolved.`;
}

async function main([command, ...args]) {
  if (command === "sql") {
    const [csv, asOf] = args;
    process.stdout.write(`${liveBatchGapSql(liveBatchMisses(parseCsv(readFileSync(csv, "utf8"))), asOf)}\n`);
    return;
  }
  if (command === "tag") {
    const [csv, foundPath, out] = args;
    const registry = await import(new URL("../src/lib/agents/learning/feedback-kinds.ts", import.meta.url).href);
    const rows = parseCsv(readFileSync(csv, "utf8"));
    const summary = tagLiveBatch(rows, JSON.parse(readFileSync(foundPath, "utf8")), registry);
    const byRow = new Map(summary.tagged.map((miss) => [miss.row, miss]));
    writeFileSync(out, toCsv(rows.map((row, index) => ({
      ...row,
      cause_step: byRow.get(index)?.step ?? "",
      loop_tag: byRow.get(index)?.tag ?? "",
      fee_published_id: byRow.get(index)?.feeId ?? "",
      error_rows: (byRow.get(index)?.rows ?? []).map((r) => `${r.kind}@${r.about_stage}`).join(" "),
    }))));
    process.stdout.write(`${gapLine(summary)}\nBy step: ${JSON.stringify(summary.byStep)}\n`);
    return;
  }
  process.stderr.write("usage: live-batch-gaps.mjs sql <results.csv> <as-of> | tag <results.csv> <found.json> <out.csv>\n");
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(process.argv.slice(2));
