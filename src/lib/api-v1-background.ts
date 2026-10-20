import { after } from "next/server";

/**
 * Keep a v1 bookkeeping write alive after its response. Call with the existing,
 * already error-handled promise: the write still starts immediately and runs once.
 */
export function retainV1BackgroundTask(task: Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // Scripts and unit tests have no Next request context. The same handled task is
    // already running, so leave it alone rather than starting the write again.
  }
}
