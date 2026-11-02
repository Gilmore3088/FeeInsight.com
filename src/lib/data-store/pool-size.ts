/**
 * Connections one server instance opens to the database (DATABASE_POOL_MAX, default 5).
 * Read by the connection pool and by the public read cache, which keeps some of them free
 * for a page's own reads (recompute-lanes.ts).
 */
export function databasePoolMax(raw: string | undefined = process.env.DATABASE_POOL_MAX): number {
  const configured = Number(raw ?? 5);
  return Number.isInteger(configured) && configured > 0 ? configured : 5;
}
