import type { NextRequest } from "next/server";
import { sql } from "@/lib/data-store/connection";
import { READER_COOKIE, getSubscriptionTokenSecret, readReaderCookie } from "@/lib/email/subscription-token";

/**
 * The confirmed reader in this browser, from the cookie the confirm link sets. Only an
 * address that is still confirmed and not unsubscribed counts.
 */
export async function knownReaderEmail(request: NextRequest): Promise<string | null> {
  const email = readReaderCookie(request.cookies.get(READER_COOKIE)?.value, getSubscriptionTokenSecret());
  if (!email) return null;
  const [row] = await sql<{ id: number | string }[]>`
    SELECT id FROM leads
     WHERE lower(email) = ${email}
       AND email_confirmed_at IS NOT NULL
       AND email_unsubscribed_at IS NULL
     LIMIT 1`;
  return row ? email : null;
}
