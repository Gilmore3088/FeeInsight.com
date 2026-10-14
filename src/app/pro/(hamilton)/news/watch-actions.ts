"use server";

/**
 * Regulatory Wire: watch or stop watching a state. Each call checks that the user is signed
 * in and has Pro (canAccessPremium) before touching their own rows; nothing here sends email.
 */

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { MAX_WATCHED_STATES, unwatchState, watchState } from "@/lib/data-store/wire-watch";
import { STATE_NAMES } from "@/lib/us-states";

export type WatchStateResult = { ok: true; watching: boolean } | { ok: false; error: string };

export async function setWatchedState(formData: FormData): Promise<WatchStateResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to watch a state." };
  if (!canAccessPremium(user)) return { ok: false, error: "Watching states is part of a Hamilton Pro subscription." };

  const code = String(formData.get("state") ?? "").trim().toUpperCase();
  if (!STATE_NAMES[code]) return { ok: false, error: "Choose a state to watch." };
  const watch = String(formData.get("watch") ?? "") === "1";

  const result = watch ? await watchState(user.id, code) : await unwatchState(user.id, code);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "limit"
          ? `You can watch up to ${MAX_WATCHED_STATES} states. Stop watching one first.`
          : "Your watched states could not be saved just now. Try again.",
    };
  }
  revalidatePath("/pro/news");
  revalidatePath("/pro/news/digest");
  return { ok: true, watching: watch };
}

/** The form action behind "Watch this state" (a plain form post, no client JavaScript). */
export async function watchStateFormAction(formData: FormData): Promise<void> {
  await setWatchedState(formData);
}
