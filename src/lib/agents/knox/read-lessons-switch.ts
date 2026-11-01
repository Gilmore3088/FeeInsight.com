/**
 * The switch for Knox's read lessons (#2062, `read-lessons.ts`), in its own module so the feedback
 * registry (`learning/feedback-kinds.ts`) can say whether those kinds are read without importing Knox.
 */
export const KNOX_READ_LESSONS_SWITCH = "KNOX_READ_LESSONS_LIVE";

/** The switch reads on for "1" or "true", allowing for stray spaces, quotes and capitals. */
export function readLessonsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[KNOX_READ_LESSONS_SWITCH];
  if (raw == null) return false;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "1" || value === "true";
}
