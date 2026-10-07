"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { NO_CATEGORY_LABEL, recordNameLabel } from "@/lib/agents/knox/label-queue";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";

const TAXONOMY_KEYS = new Set(Object.values(FEE_FAMILIES).flat());

/** Saves one name's label from the weekly queue. Changes how Knox files new reads only. */
export async function saveNameLabelAction(formData: FormData): Promise<void> {
  const user = await requireAuth("approve");
  const name = String(formData.get("name") ?? "").trim().slice(0, 300);
  const canonicalKey = String(formData.get("canonical_key") ?? "").trim();
  if (!name || (canonicalKey !== NO_CATEGORY_LABEL && !TAXONOMY_KEYS.has(canonicalKey))) {
    redirect(`/admin/knox/labels?message=${encodeURIComponent("Pick a category for that name.")}`);
  }
  await recordNameLabel(sql, { name, canonicalKey, actor: user.username });
  revalidatePath("/admin/knox/labels");
  redirect(`/admin/knox/labels?message=${encodeURIComponent(`Labelled "${name}". Knox uses it from the next extract.`)}`);
}
