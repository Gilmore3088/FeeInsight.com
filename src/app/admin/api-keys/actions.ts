"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { API_KEY_TIERS, createApiKey, revokeApiKey } from "@/lib/api-keys";

export interface CreateKeyState {
  key?: string;
  organizationName?: string;
  error?: string;
}

const createSchema = z.object({
  organization_name: z.string().trim().min(2).max(120),
  key_name: z.string().trim().max(80).optional(),
  tier: z.enum(API_KEY_TIERS),
});

export async function createApiKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  await requireAuth("manage_users");
  const parsed = createSchema.safeParse({
    organization_name: formData.get("organization_name"),
    key_name: formData.get("key_name") || undefined,
    tier: formData.get("tier"),
  });
  if (!parsed.success) {
    return { error: "Enter who the key is for (at least 2 characters) and pick an allowance." };
  }

  try {
    const { key } = await createApiKey({
      organizationName: parsed.data.organization_name,
      keyName: parsed.data.key_name || "Default",
      tier: parsed.data.tier,
    });
    revalidatePath("/admin/api-keys");
    return { key, organizationName: parsed.data.organization_name };
  } catch (error) {
    console.error("API key creation failed", error);
    return {
      error:
        "The key could not be saved. If this is the first key, run the api_key_tier_and_revocation migration in the Supabase SQL editor, then try again.",
    };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  await requireAuth("manage_users");
  const id = z.coerce.number().int().positive().safeParse(formData.get("key_id"));
  if (!id.success) return;
  await revokeApiKey(id.data);
  revalidatePath("/admin/api-keys");
}
