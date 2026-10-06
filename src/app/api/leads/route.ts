import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/data-store/connection";
import { SITE_URL } from "@/lib/constants";
import { checkInstitutionReport, describeQuoteCheck } from "@/lib/custom-report/quote-check";
import {
  EMAIL_ONLY_LEAD_NAME,
  LEAD_HONEYPOT_FIELD,
  NEWSLETTER_SOURCE,
  buildCaptureAttribution,
  isEmailOnlySource,
  parseStateCode,
  placementForSource,
} from "@/lib/lead-capture";
import { syncLeadToMailerLite } from "@/lib/email/mailerlite";
import {
  REPORT_SOURCE,
  buildBenchmarkUseCase,
  buildReportUseCase,
  isBenchmarkSource,
  parseBenchmarkRequest,
  notifyForLead,
  parseCompetitors,
  parseInstitutionId,
  parseSrc,
} from "./lead-notifications";
import { isRequestLead } from "@/lib/leads/lead-status";
import { knownReaderEmail } from "@/lib/leads/known-reader";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SOURCE = "website";
/** Placeholder name email-only forms store; never allowed to replace a real name. */
const NEWSLETTER_PLACEHOLDER_NAME = EMAIL_ONLY_LEAD_NAME;
const MAX_INSTITUTION_NAME_LENGTH = 160;
const NEW_LEAD_STATUS = "new";

/** leads.id is bigint, which the Postgres driver returns as a string. */
function parseLeadId(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function handlePOST(request: NextRequest) {
  try {
    const body = await request.json();
    // Bots fill the hidden honeypot; answer like a success and store nothing.
    if (cleanText(body[LEAD_HONEYPOT_FIELD])) {
      return NextResponse.json({ success: true });
    }

    const source = cleanText(body.source) ?? DEFAULT_SOURCE;
    const placement = placementForSource(source);
    const benchmark = isBenchmarkSource(source);
    const benchmarkScope = parseBenchmarkRequest(source, body.district);
    const name =
      cleanText(body.name) ??
      (isEmailOnlySource(source) || benchmark ? NEWSLETTER_PLACEHOLDER_NAME : null);
    // A confirmed reader asking for a free report isn't asked to type their email again:
    // the form sends none and the signed cookie from their confirm link supplies it.
    const email = cleanText(body.email) ?? (benchmark ? await knownReaderEmail(request).catch(() => null) : null);
    const company = cleanText(body.company);
    const role = cleanText(body.role);
    const institutionId =
      source === REPORT_SOURCE || placement ? parseInstitutionId(body.institutionId) : null;
    // The newsletter form may name a state too, for that state's monthly edition.
    const stateCode = placement || source === NEWSLETTER_SOURCE ? parseStateCode(body.state) : null;
    const institutionName = placement
      ? cleanText(body.institutionName)?.slice(0, MAX_INSTITUTION_NAME_LENGTH) ?? null
      : null;
    const src = source === REPORT_SOURCE || benchmark ? parseSrc(body.src) : null;
    // Optional on the institution report form: the requester's state and the competitors they want compared.
    const reportState = source === REPORT_SOURCE ? parseStateCode(body.state) : null;
    const competitors = source === REPORT_SOURCE ? parseCompetitors(body.competitors) : null;
    const useCase = placement
      ? buildCaptureAttribution(placement, institutionId, stateCode)
      : benchmarkScope
        ? buildBenchmarkUseCase(benchmarkScope, src)
        : source === REPORT_SOURCE
          ? buildReportUseCase(cleanText(body.use_case), institutionId, src, { stateCode: reportState, competitors })
          : source === NEWSLETTER_SOURCE && stateCode
            ? `state=${stateCode}`
            : cleanText(body.use_case);

    if (benchmark && !benchmarkScope) {
      return NextResponse.json({ error: "Pick a Fed district for the district report" }, { status: 400 });
    }

    if (!name || !email) {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400 },
      );
    }

    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 },
      );
    }

    // A request (report, contact, enterprise) is work owed, so each one gets its own row
    // with its own created_at and status, even from an email we already know. Folding it
    // into an older row hid it: the row kept its old date and company, so it never
    // showed up as a new request in /admin/leads.
    // A signup folds into the newest signup row for this email. Request rows are never
    // touched by a signup: appending capture sources to them changed their history and
    // could reopen an answered request.
    const known = await sql<{
      id: number | string;
      source: string | null;
      use_case?: string | null;
      email_confirmed_at?: string | Date | null;
      email_unsubscribed_at?: string | Date | null;
    }[]>`
      SELECT id, source, use_case, email_confirmed_at, email_unsubscribed_at FROM leads WHERE lower(email) = lower(${email}) ORDER BY created_at DESC, id DESC`;
    const existing = isRequestLead(source) ? undefined : known.find((row) => !isRequestLead(row.source));
    let leadId: number | null = null;

    if (existing) {
      leadId = parseLeadId(existing.id);
      // Fill gaps only: never overwrite a qualified lead's name/company/role/use_case,
      // and never let the newsletter placeholder replace a real name. Sources accumulate
      // as a comma-separated list (exact-member match, so "report" is not hidden by
      // "capture_report_sample"); status is set only when it was never set.
      const nameCandidate = name === NEWSLETTER_PLACEHOLDER_NAME ? null : name;
      await sql`
        UPDATE leads SET
          name = CASE
            WHEN name IS NULL OR name = '' OR name = ${NEWSLETTER_PLACEHOLDER_NAME}
              THEN COALESCE(${nameCandidate}, name)
            ELSE name
          END,
          company = COALESCE(company, ${company}),
          role = COALESCE(role, ${role}),
          use_case = COALESCE(use_case, ${useCase}),
          source = CASE
            WHEN source IS NULL OR source = '' THEN ${source}
            WHEN ${source} = ANY(string_to_array(source, ',')) THEN source
            ELSE source || ',' || ${source}
          END,
          status = COALESCE(status, ${NEW_LEAD_STATUS})
        WHERE id = ${existing.id}`;
      if ((placement || benchmarkScope || (source === NEWSLETTER_SOURCE && stateCode)) && useCase) {
        // Attribution accumulates too: a returning lead signing up from a new placement,
        // or asking for another free report, keeps its earlier use_case and gains this one.
        await sql`
          UPDATE leads SET use_case = use_case || '; ' || ${useCase}
          WHERE id = ${existing.id}
            AND use_case IS NOT NULL
            AND position(${useCase} in use_case) = 0`;
      }
    } else {
      const [inserted] = await sql`
        INSERT INTO leads (name, email, company, role, use_case, source)
        VALUES (${name}, ${email}, ${company}, ${role}, ${useCase}, ${source})
        RETURNING id`;
      leadId = parseLeadId(inserted?.id);
    }

    // An institution report is paid and quoted by James, so the requester gets nothing
    // automatic. James's email and the lead row say whether we can build it from live data.
    // When the local data is too thin, the request is answered at once: the row is Held
    // and the requester is told so, with their free Fed district report.
    let quoteCheck: string | null = null;
    let heldDistrict: number | null | undefined;
    if (source === REPORT_SOURCE) {
      const check = await checkInstitutionReport({ institutionId, institutionName: company });
      quoteCheck = describeQuoteCheck(check, SITE_URL);
      const held = check.status === "thin";
      if (held) heldDistrict = (check.rule?.state_code && STATE_TO_DISTRICT[check.rule.state_code]) || null;
      if (leadId !== null) {
        await sql`
          UPDATE leads SET use_case = CASE
            WHEN use_case IS NULL OR use_case = '' THEN ${quoteCheck}
            ELSE use_case || '; ' || ${quoteCheck}
          END,
          status = CASE WHEN ${held} AND status = ${NEW_LEAD_STATUS} THEN 'held' ELSE status END
          WHERE id = ${leadId}`;
      }
    }

    // A reader who already confirmed doesn't wait for another click: the new source and
    // state go to MailerLite now (the confirm sync does this for everyone else).
    const confirmed = existing && existing.email_confirmed_at && !existing.email_unsubscribed_at;
    if (confirmed && !isRequestLead(source)) {
      const sources = [...new Set([...known.map((row) => row.source ?? ""), source].join(",").split(",").map((s) => s.trim()).filter(Boolean))];
      const sync = await syncLeadToMailerLite({
        email,
        subscribed: true,
        source: sources.join(","),
        // Only a state picked on this form changes the reader's state group; a form with no
        // state leaves their group alone (an older row's state must not add a second one).
        state: stateCode,
      });
      if (sync.status === "failed") console.error("[api/leads] MailerLite sync failed", { error: sync.error });
    }

    // Storage is done; email is best-effort and its status rides along for the client.
    const notifications = await notifyForLead({
      leadId,
      name,
      email,
      company,
      role,
      useCase,
      source,
      institutionId,
      src,
      stateCode,
      institutionName,
      benchmarkScope,
      quoteCheck,
      heldDistrict,
      reportState,
      competitors,
    });

    return NextResponse.json(notifications ? { success: true, notifications } : { success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export const POST = withApiRoutePolicy("api.leads", "POST", handlePOST);
