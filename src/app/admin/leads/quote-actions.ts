"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/constants";
import { checkInstitutionReport, describeQuoteCheck } from "@/lib/custom-report/quote-check";
import { findInstitutionIdByName } from "@/lib/data-store/custom-report-market";
import {
  getInstitutionLabel,
  getReportPaymentLead,
  markQuoteSent,
  saveReportQuote,
} from "@/lib/data-store/report-payments";
import { sendReportQuoteEmail } from "@/lib/email/report-payment";
import { createPayToken, payPath } from "@/lib/leads/pay-link";
import { formatUsd, institutionIdFromUseCase, isReportRequestSource, parseQuoteCents } from "@/lib/leads/report-payment";

export interface ReportQuoteState {
  status: "idle" | "saved" | "error";
  message: string;
  payUrl?: string;
}

function payUrlFor(leadId: number): string | null {
  const token = createPayToken(leadId);
  return token ? `${SITE_URL.replace(/\/$/, "")}${payPath(token)}` : null;
}

function parseId(value: FormDataEntryValue | null): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * James types the price for an institution report request. The quote is saved only when
 * the institution's report passes the same check as the request email ("ready to quote"),
 * so a paid link never opens a report built on thin data. Gives the private pay link.
 */
export async function setReportQuoteAction(_prev: ReportQuoteState, formData: FormData): Promise<ReportQuoteState> {
  await requireAuth("edit");
  const id = parseId(formData.get("id"));
  if (!id) return { status: "error", message: "Lead not found." };
  const cents = parseQuoteCents(formData.get("price"));
  if (cents === null) return { status: "error", message: "Type a price in dollars, e.g. 300." };

  const lead = await getReportPaymentLead(id);
  if (!lead) return { status: "error", message: "Lead not found." };
  if (!lead.paymentColumns) {
    return { status: "error", message: "The payment columns are missing: run migration 20270110000002 first." };
  }
  if (lead.paidAt) return { status: "error", message: "This request is already paid." };
  if (!isReportRequestSource(lead.source)) return { status: "error", message: "Only institution report requests can be quoted." };

  const institutionId =
    parseId(formData.get("institution_id")) ??
    lead.quoteInstitutionId ??
    institutionIdFromUseCase(lead.useCase) ??
    (lead.company ? await findInstitutionIdByName(lead.company) : null);
  if (!institutionId) return { status: "error", message: "No institution matched: type its institution ID." };
  const institution = await getInstitutionLabel(institutionId);
  if (!institution) return { status: "error", message: `Institution ${institutionId} was not found.` };

  const check = await checkInstitutionReport({ institutionId, institutionName: null });
  if (check.status !== "ready") {
    return { status: "error", message: `Not quoted. ${describeQuoteCheck(check, SITE_URL)}` };
  }

  const payUrl = payUrlFor(id);
  if (!payUrl) return { status: "error", message: "No pay link: CUSTOM_REPORT_LINK_SECRET is not set." };
  if (!(await saveReportQuote(id, cents, institutionId))) return { status: "error", message: "The quote was not saved." };

  revalidatePath("/admin/leads");
  return { status: "saved", message: `Quoted ${formatUsd(cents)} for ${institution.name}.`, payUrl };
}

/** Emails the saved quote and pay link to the requester. Only when James clicks it. */
export async function sendReportQuoteAction(_prev: ReportQuoteState, formData: FormData): Promise<ReportQuoteState> {
  await requireAuth("edit");
  const id = parseId(formData.get("id"));
  const lead = id ? await getReportPaymentLead(id) : null;
  if (!id || !lead) return { status: "error", message: "Lead not found." };
  if (lead.paidAt) return { status: "error", message: "This request is already paid." };
  if (!lead.quoteCents || !lead.quoteInstitutionId) return { status: "error", message: "Save a price first." };
  const institution = await getInstitutionLabel(lead.quoteInstitutionId);
  const payUrl = payUrlFor(id);
  if (!institution || !payUrl) return { status: "error", message: "No pay link could be made." };

  const result = await sendReportQuoteEmail({ email: lead.email, institution: institution.name, cents: lead.quoteCents, payUrl });
  if (result.status !== "sent") {
    return { status: "error", message: `Not sent: ${result.status === "failed" ? result.error : result.reason}`, payUrl };
  }
  await markQuoteSent(id);
  revalidatePath("/admin/leads");
  return { status: "saved", message: `Quote emailed to ${lead.email}.`, payUrl };
}
