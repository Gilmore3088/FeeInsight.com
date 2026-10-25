import type { sql } from "./connection";

type Db = typeof sql;
const readyConnections = new WeakSet<object>();

/** Only cache success: deploying compatible code before the migration is safe. */
export async function compactCallStorageReady(db: Db): Promise<boolean> {
  if (readyConnections.has(db)) return true;
  const [row] = await db<{ ready: boolean }[]>`
    SELECT to_regprocedure('public.upsert_call_report_item_batch(text,date,text,bigint,jsonb)') IS NOT NULL
      AND to_regclass('public.call_report_item_facts') IS NOT NULL AS ready
  `;
  if (row?.ready === true) readyConnections.add(db);
  return row?.ready === true;
}

export async function callItemFactsRelation(db: Db): Promise<string> {
  return await compactCallStorageReady(db) ? "call_report_item_facts" : "institution_call_report_items";
}

/** Every field is bound. The server function retains the original conservative identity joins. */
export async function writeCompactCallItems(db: Db, args: {
  source: "ffiec" | "ncua"; reportDate: string; url: string; runId: number | null;
  rows: ReadonlyArray<Record<string, unknown>>;
}): Promise<number> {
  let written = 0;
  for (let at = 0; at < args.rows.length; at += 5000) {
    const [row] = await db<{ written: number | string }[]>`
      SELECT public.upsert_call_report_item_batch(${args.source},${args.reportDate}::date,${args.url},
        ${args.runId},${JSON.stringify(args.rows.slice(at,at+5000))}::jsonb) AS written
    `;
    written += Number(row?.written ?? 0);
  }
  return written;
}
