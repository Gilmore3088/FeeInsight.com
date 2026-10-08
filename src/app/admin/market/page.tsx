import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";

/** The Market page was the fee catalog with a segment filter; that filter now lives in the catalog. */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ charter?: string; tier?: string; state?: string }>;
}) {
  await requireAuth("view");
  const params = await searchParams;
  const keep = new URLSearchParams();
  for (const key of ["charter", "tier", "state"] as const) {
    if (params[key]) keep.set(key, params[key]!);
  }
  const qs = keep.toString();
  redirect(qs ? `/admin/fees/catalog?${qs}` : "/admin/fees/catalog");
}
