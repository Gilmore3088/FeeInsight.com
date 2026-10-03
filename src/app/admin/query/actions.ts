"use server";

import { requireAuth } from "@/lib/auth";
import { withTransaction } from "@/lib/data-store/connection";

const MAX_ROWS = 500;
const BLOCKED_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "ATTACH", "DETACH"];

export async function runQuery(
  query: string
): Promise<{ success: boolean; columns?: string[]; rows?: Record<string, unknown>[]; count?: number; error?: string; duration?: number }> {
  // Raw SQL against production: admins only (analysts and public accounts never).
  await requireAuth("manage_users");

  const trimmed = query.trim();
  if (!trimmed) return { success: false, error: "Empty query" };

  // Block write operations
  const upper = trimmed.toUpperCase();
  for (const kw of BLOCKED_KEYWORDS) {
    if (upper.startsWith(kw) || upper.includes(` ${kw} `) || upper.includes(`;${kw}`)) {
      return { success: false, error: `Write operations not allowed: ${kw}` };
    }
  }

  const start = performance.now();

  try {
    const rows = await withTransaction(async (tx) => {
      await tx.unsafe("SET TRANSACTION READ ONLY");
      return tx.unsafe(trimmed) as Promise<Record<string, unknown>[]>;
    });
    const duration = Math.round(performance.now() - start);

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const limited = rows.slice(0, MAX_ROWS);

    return {
      success: true,
      columns,
      rows: limited,
      count: rows.length,
      duration,
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
