"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { addHandFoundLink } from "@/lib/agents/magellan/operator-schedules";

export interface HitListLinkState {
  ok: boolean;
  message: string;
}

/** Stores a pasted schedule link as hand-found; the next tick's priority run picks it up. */
export async function addHitListLink(institutionId: number, url: string): Promise<HitListLinkState> {
  const user = await requireAuth("edit");
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const result = await addHandFoundLink({ institutionId, url, givenBy: `${user.username} on the hit list, ${stamp}` });
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/admin/magellan/hit-list");
  return { ok: true, message: "Saved. It runs on the next tick." };
}
