import type Stripe from "stripe";
import { withTransaction, type sql } from "./connection";

export interface CheckoutIntent {
  id: string;
  user_id: number;
  customer_id: string;
  fingerprint: string;
  parameters: Stripe.Checkout.SessionCreateParams;
  session_id: string | null;
  state: "pending" | "open" | "review";
  created_at: Date | string;
}
export interface CheckoutIntentStore {
  tx: typeof sql;
  current(): Promise<CheckoutIntent | null>;
  reserve(input: Pick<CheckoutIntent, "id" | "customer_id" | "fingerprint" | "parameters">): Promise<CheckoutIntent>;
  session(id: string, sessionId: string): Promise<void>;
  retire(id: string): Promise<void>;
  review(id: string): Promise<void>;
}

/** All call sites take the user lock before the shared R02 customer billing lock. */
export function withCheckoutLock<T>(userId: number, action: (store: CheckoutIntentStore) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("Invalid checkout owner");
  return withTransaction(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`feeinsight:checkout:${userId}`}, 0))`;
    return action({
      tx,
      async current() {
        const [row] = await tx<CheckoutIntent[]>`
          SELECT id, user_id, customer_id, fingerprint, parameters, session_id, state, created_at
          FROM pro_checkout_intents WHERE user_id = ${userId} AND retired_at IS NULL`;
        return row ?? null;
      },
      async reserve(input) {
        const [row] = await tx<CheckoutIntent[]>`
          INSERT INTO pro_checkout_intents (id, user_id, customer_id, fingerprint, parameters)
          VALUES (${input.id}, ${userId}, ${input.customer_id}, ${input.fingerprint}, ${JSON.stringify(input.parameters)}::jsonb)
          RETURNING id, user_id, customer_id, fingerprint, parameters, session_id, state, created_at`;
        return row;
      },
      async session(id, sessionId) {
        await tx`UPDATE pro_checkout_intents SET session_id = ${sessionId}, state = 'open', updated_at = now()
          WHERE id = ${id} AND user_id = ${userId} AND retired_at IS NULL`;
      },
      async retire(id) {
        await tx`UPDATE pro_checkout_intents SET retired_at = now(), updated_at = now()
          WHERE id = ${id} AND user_id = ${userId} AND retired_at IS NULL`;
      },
      async review(id) {
        await tx`UPDATE pro_checkout_intents SET state = 'review', updated_at = now()
          WHERE id = ${id} AND user_id = ${userId} AND retired_at IS NULL`;
      },
    });
  });
}
