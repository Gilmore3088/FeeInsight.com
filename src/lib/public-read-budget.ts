import { after } from "next/server";
import { createReadBudget } from "./read-deadline";

// Layout, metadata and page may share one React-cached promise but use separate budgets.
const retained = new WeakSet<Promise<unknown>>();

/** Keep only already-started work alive; no retries, queries or cancellation are introduced. */
function retainAbandonedRead(read: Promise<unknown>, label: string): void {
  if (retained.has(read)) return;
  try {
    after(async () => {
      try { await read; }
      catch (error) { console.error(`${label} abandoned read failed:`, error); }
    });
    retained.add(read);
  } catch (error) {
    console.error(`${label} abandoned read retention unavailable:`, error);
    void read.catch(error => { console.error(`${label} abandoned read failed:`, error); });
  }
}

/** Public server-render adapter; the budget itself remains independent of Next. */
export function createPublicReadBudget(totalMs: number, logPrefix: string) {
  return createReadBudget(totalMs, logPrefix, Date.now,
    (read, label) => retainAbandonedRead(read, `${logPrefix} ${label}`));
}
