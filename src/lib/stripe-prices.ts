import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import {
  PRO_PRODUCT_NAME,
  PRO_TIERS,
  proLookupKey,
  proPriceId,
  proTier,
  tierPriceUsd,
  type ProPlan,
  type ProTier,
} from "@/lib/pro-tiers";

/**
 * The Stripe price for a Pro tier and plan. The site sets the catalog up itself, so nobody
 * builds it by hand in the dashboard (James, 8 Oct 2026: "You can set up the stripe catalog").
 *
 * Order: the tier's Vercel variable if set; else the active price with the tier's lookup key;
 * else a new recurring price with that key on the "Fee Insight Pro" product. The lookup key
 * makes it idempotent, so a second call finds the first one's price. Existing prices are
 * never edited or archived, and nothing here charges anyone.
 */
export async function resolveProPriceId(tier: ProTier, plan: ProPlan, stripe: Stripe = getStripe()): Promise<string> {
  const fromEnv = proPriceId(tier, plan);
  if (fromEnv) return fromEnv;

  const lookupKey = proLookupKey(tier, plan);
  const existing = await findPriceByLookupKeys(stripe, [lookupKey]);
  if (existing) return existing.id;

  const productId = await findOrCreateProProductId(stripe);
  // A same-amount recurring price already on the product (say, from a dashboard attempt) is
  // reused as is rather than duplicated.
  const sameAmount = await stripe.prices.list({ product: productId, active: true, type: "recurring", limit: 100 });
  const reusable = sameAmount.data.find((price) => matchesTierAmount(price, tier, plan));
  if (reusable) return reusable.id;

  try {
    const created = await stripe.prices.create({
      product: productId,
      currency: "usd",
      unit_amount: tierPriceUsd(tier, plan) * 100,
      recurring: { interval: plan === "monthly" ? "month" : "year" },
      lookup_key: lookupKey,
      nickname: `${proTier(tier).assetsLabel}, ${plan}`,
      metadata: { pro_tier: tier, pro_plan: plan },
    });
    return created.id;
  } catch (err) {
    // Another request created it first and took the lookup key: use theirs.
    const raced = await findPriceByLookupKeys(stripe, [lookupKey]);
    if (raced) return raced.id;
    throw err;
  }
}

type PriceShape = Pick<Stripe.Price, "id" | "lookup_key" | "unit_amount" | "currency" | "recurring">;

/** True when a Stripe price is one of the tier's prices: its Vercel variable, lookup key or amount. */
export function isProTierPrice(price: PriceShape, tier: ProTier): boolean {
  return (["monthly", "annual"] as const).some(
    (plan) =>
      price.id === proPriceId(tier, plan) ||
      price.lookup_key === proLookupKey(tier, plan) ||
      matchesTierAmount(price, tier, plan),
  );
}

function matchesTierAmount(price: PriceShape, tier: ProTier, plan: ProPlan): boolean {
  return (
    price.currency === "usd" &&
    price.unit_amount === tierPriceUsd(tier, plan) * 100 &&
    price.recurring?.interval === (plan === "monthly" ? "month" : "year") &&
    (price.recurring?.interval_count ?? 1) === 1
  );
}

async function findPriceByLookupKeys(stripe: Stripe, lookupKeys: string[]): Promise<Stripe.Price | null> {
  const prices = await stripe.prices.list({ lookup_keys: lookupKeys, active: true, limit: 1 });
  return prices.data[0] ?? null;
}

async function findOrCreateProProductId(stripe: Stripe): Promise<string> {
  // A tier price already set up names the product to reuse.
  const allKeys = PRO_TIERS.flatMap((tier) => [proLookupKey(tier.key, "monthly"), proLookupKey(tier.key, "annual")]);
  const sibling = await findPriceByLookupKeys(stripe, allKeys);
  if (sibling) return typeof sibling.product === "string" ? sibling.product : sibling.product.id;

  const products = await stripe.products.list({ active: true, limit: 100 });
  const named = products.data.find((product) => product.name === PRO_PRODUCT_NAME);
  if (named) return named.id;
  return (await stripe.products.create({ name: PRO_PRODUCT_NAME })).id;
}
