"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { isLeadStatus, LEAD_STATUS_LABELS } from "@/lib/leads/lead-status";

export interface LeadStatusState {
  status: "idle" | "saved" | "error";
  message: string;
}

export async function setLeadStatusAction(_prev: LeadStatusState, formData: FormData): Promise<LeadStatusState> {
  await requireAuth("edit");
  const id = Number(formData.get("id"));
  const status = formData.get("status");
  if (!Number.isInteger(id) || id <= 0 || !isLeadStatus(status)) {
    return { status: "error", message: "Pick a status." };
  }
  const updated = await sql`UPDATE leads SET status = ${status} WHERE id = ${id} RETURNING id`;
  if (updated.length === 0) return { status: "error", message: "Lead not found." };
  revalidatePath("/admin/leads");
  return { status: "saved", message: `Saved: ${LEAD_STATUS_LABELS[status]}` };
}
