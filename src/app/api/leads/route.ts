import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/data-store/connection";
import {
  EMAIL_ONLY_LEAD_NAME,
  LEAD_HONEYPOT_FIELD,
  buildCaptureAttribution,
  isEmailOnlySource,
  parseStateCode,
  placementForSource,
} from "@/lib/lead-capture";
import {
  REPORT_SOURCE,
  buildReportUseCase,
  notifyForLead,
  parseInstitutionId,
  parseSrc,
} from "./lead-notifications";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SOURCE = "website";
/** Placeholder name email-only forms store; never allowed to replace a real name. */
const NEWSLETTER_PLACEHOLDER_NAME = EMAIL_ONLY_LEAD_NAME;
const MAX_INSTITUTION_NAME_LENGTH = 160;
const NEW_LEAD_STATUS = "new";

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
    const name =
      cleanText(body.name) ?? (isEmailOnlySource(source) ? NEWSLETTER_PLACEHOLDER_NAME : null);
    const email = cleanText(body.email);
    const company = cleanText(body.company);
    const role = cleanText(body.role);
    const institutionId =
      source === REPORT_SOURCE || placement ? parseInstitutionId(body.institutionId) : null;
    const stateCode = placement ? parseStateCode(body.state) : null;
    const institutionName = placement
      ? cleanText(body.institutionName)?.slice(0, MAX_INSTITUTION_NAME_LENGTH) ?? null
      : null;
    const src = source === REPORT_SOURCE ? parseSrc(body.src) : null;
    const useCase = placement
      ? buildCaptureAttribution(placement, institutionId, stateCode)
      : source === REPORT_SOURCE
        ? buildReportUseCase(cleanText(body.use_case), institutionId, src)
        : cleanText(body.use_case);

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

    const [existing] = await sql`SELECT id FROM leads WHERE email = ${email}`;

    if (existing) {
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
        WHERE email = ${email}`;
      if (placement && useCase) {
        // Capture attribution accumulates too: a returning lead signing up from a new
        // placement keeps its earlier use_case and gains this placement's context.
        await sql`
          UPDATE leads SET use_case = use_case || '; ' || ${useCase}
          WHERE email = ${email}
            AND use_case IS NOT NULL
            AND position(${useCase} in use_case) = 0`;
      }
    } else {
      await sql`
        INSERT INTO leads (name, email, company, role, use_case, source)
        VALUES (${name}, ${email}, ${company}, ${role}, ${useCase}, ${source})`;
    }

    // Storage is done; email is best-effort and its status rides along for the client.
    const notifications = await notifyForLead({
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
