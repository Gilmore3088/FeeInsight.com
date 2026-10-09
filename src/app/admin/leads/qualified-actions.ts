"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { executeAgentRun, startAgentRun } from "@/lib/agents/run-store";
import { leadQualifiedReady, setLeadQualified } from "@/lib/data-store/lead-qualified";

export interface LeadQualifiedState {
  status: "idle" | "saved" | "error";
  message: string;
}

/**
 * Marks a lead qualified (or clears the mark), recording who did it and when. Marking starts
 * CARNEGIE's free `growth-quote` step as a visible growth run, which drafts the quote email into
 * the /admin/growth queue; nothing sends. A marketing pause holds the run until it resumes.
 */
export async function setLeadQualifiedAction(_prev: LeadQualifiedState, formData: FormData): Promise<LeadQualifiedState> {
  const user = await requireAuth("edit");
  const id = Number(formData.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return { status: "error", message: "Lead not found." };
  const qualified = formData.get("qualified") === "1";
  if (!(await leadQualifiedReady())) {
    return { status: "error", message: "The qualified columns are missing: run migration 20270110000032 first." };
  }
  const changed = await setLeadQualified(id, qualified, user.username);
  revalidatePath("/admin/leads");
  if (!changed) return { status: "saved", message: qualified ? "Already marked qualified." : "Not marked qualified." };
  if (!qualified) return { status: "saved", message: "Qualified mark cleared." };

  try {
    const started = await startAgentRun({
      agent: "growth",
      kind: "workflow",
      title: `Quote draft for lead ${id}`,
      params: { source: "admin.leads.qualified", agent: "carnegie", lead_id: id },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: `growth:quote:lead:${id}:${new Date().toISOString().slice(0, 16)}`,
      steps: [{ key: "growth-quote", agent: "growth", title: "CARNEGIE: draft a quote email for each qualified lead" }],
    });
    if (!started.reused) await executeAgentRun(started.run.id, { maxSteps: 1 });
    return { status: "saved", message: `Marked qualified. Growth run #${started.run.id} drafts the quote into /admin/growth.` };
  } catch (error) {
    console.error("growth-quote run failed to start:", error);
    return { status: "saved", message: "Marked qualified. The quote draft run did not start; the daily growth loop shows it as due." };
  }
}
