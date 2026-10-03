import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, FileText, type LucideIcon } from "lucide-react";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getPublicInstitutionById } from "@/lib/data-store";
import { SubmitForm } from "./submit-form";

export const metadata = {
  title: "Submit a Fee Source",
  description: "Send us the published fee schedule for a bank or credit union so we can review it.",
};

interface PageProps {
  searchParams: Promise<{
    institution?: string;
    institutionId?: string;
    institutionName?: string;
    sourceUrl?: string;
    submitterRole?: string;
    notes?: string;
    source?: string;
    claim?: string;
  }>;
}

function parseInstitutionId(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function resolveInstitutionName(id: number | null, fallback: string): Promise<string> {
  if (fallback || !id) return fallback;
  try {
    const inst = await getPublicInstitutionById(id);
    return inst?.institution_name ?? "";
  } catch (error) {
    console.error("Submit-fees institution lookup failed:", error);
    return "";
  }
}

export default async function SubmitFeesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const institutionId = parseInstitutionId(params.institution) ?? parseInstitutionId(params.institutionId);
  const institutionName = await resolveInstitutionName(institutionId, params.institutionName ?? "");
  const isClaimFlow = params.claim === "1" || params.source === "claim";
  const backHref = institutionId ? `/institution/${institutionId}` : "/institutions";
  const backLabel = institutionId && institutionName ? `Back to ${institutionName}` : "Back";

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />
      <main className="overflow-x-hidden bg-[#FAF7F2] text-[#1A1815]">
        <div className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
          <Link
            href={backHref}
            className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#6B6255] transition-colors hover:text-[#A93D25]"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>

          <header className="fi-reveal mb-7 border-b border-[#D8CBB8] pb-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6B6255]">
                  {isClaimFlow ? "Claim or Validate" : "Add a Fee Source"}
                </p>
                <h1
                  className="mt-2 max-w-3xl break-words text-4xl font-normal leading-[1.02] text-[#1A1815] sm:text-5xl"
                  style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                >
                  {isClaimFlow ? "Claim or validate this profile." : "Send us the published fee schedule."}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#5A5347]">
                  {isClaimFlow
                    ? "Share the link to the official fee schedule and your role, and we will review the profile with your institution's context."
                    : "A link to the published fee schedule is all we need to start a review. Individual fees are optional and help reviewers move faster."}
                </p>
              </div>

              {institutionName && (
                <div className="border-y border-[#E0D7C9] bg-[#FDFBF8] px-3 py-3 lg:border-l lg:border-y-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6B6255]">
                    Institution
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-[#1A1815]">{institutionName}</p>
                </div>
              )}
            </div>
          </header>

          <div className="fi-reveal fi-reveal-delay-1 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <SubmitForm
              initialInstitutionId={institutionId}
              initialInstitutionName={institutionName}
              initialSourceUrl={params.sourceUrl ?? ""}
              initialSubmitterRole={isClaimFlow ? "institution_employee" : params.submitterRole}
              initialNotes={params.notes}
              claimFlow={isClaimFlow}
              profileHref={institutionId ? `/institution/${institutionId}` : null}
            />

            <aside className="min-w-0 border-l border-[#D8CBB8] pl-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6B6255]">
                What happens next
              </p>
              <div className="mt-4 space-y-4">
                <ReviewStep
                  icon={FileText}
                  title="Source received"
                  detail="The link is stored and queued for review."
                />
                <ReviewStep
                  icon={Clock3}
                  title="Fees checked"
                  detail="Each fee is checked against the published schedule before anything changes on the profile."
                />
                <ReviewStep
                  icon={CheckCircle2}
                  title="Profile updated"
                  detail="Once reviewed, verified fees appear on the profile and in benchmarks."
                />
              </div>
            </aside>
          </div>

          <div className="mt-10 max-w-2xl border-t border-[#E0D7C9] pt-5 text-sm leading-relaxed text-[#6B6255]">
            <p>
              By submitting, you confirm the fee information is publicly available from the
              institution&apos;s website or official documents. Submissions are rate limited.
            </p>
          </div>
        </div>
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}

function ReviewStep({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#C44B2E]" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#1A1815]">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-[#6B6255]">{detail}</p>
      </div>
    </div>
  );
}
