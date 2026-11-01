/** The shadow lab never talks to a database; stop before any module opens a client. */
const DATABASE_ENV_KEYS = ["DATABASE_URL", "E2E_DATABASE_URL"] as const;

export function assertOfflineEnv(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const set = DATABASE_ENV_KEYS.filter((key) => Boolean(env[key]));
  if (set.length > 0) {
    throw new Error(`shadow lab runs offline: unset DATABASE_URL and E2E_DATABASE_URL (set: ${set.join(", ")})`);
  }
}
