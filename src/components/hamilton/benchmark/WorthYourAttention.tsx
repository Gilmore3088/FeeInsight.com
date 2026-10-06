import Link from "next/link";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { BriefingObservation } from "@/lib/hamilton/briefing-observations";
import type { AuditTrail } from "@/lib/hamilton/audit-trail";
import { AuditPanel } from "@/components/hamilton/memo/memo";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;
const COUNT_WORDS = ["", "one thing", "two things", "three things"];

/**
 * The top of the Briefing: the fees where the bank sits furthest from its benchmark, as
 * observations with a way into Research and Model. It never says what to do about them.
 */
export function WorthYourAttention({
  observations,
  institutionId,
  trail,
}: {
  observations: BriefingObservation[];
  institutionId: string | null;
  trail: AuditTrail;
}) {
  const count = COUNT_WORDS[observations.length] ?? `${observations.length} things`;
  return (
    <section className="rounded-lg border border-warm-300 bg-warm-50 p-6 text-warm-800">
      <h2 className="text-2xl text-warm-900 sm:text-3xl" style={SERIF}>
        I found {count} worth your attention
      </h2>
      <p className="mt-1 text-sm text-warm-600">
        Where your published fees sit furthest from the middle of your peers. Whether that matters depends on your goals; open one to look closer.
      </p>
      <ol className="mt-5 grid gap-4 md:grid-cols-3">
        {observations.map((o, i) => (
          <li key={o.feeCategory} className="flex flex-col gap-2 border-t-2 border-warm-900 pt-3">
            <span className="text-xs font-semibold text-terra-text">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-lg leading-snug text-warm-900" style={SERIF}>
              {o.headline}
            </span>
            <span className="text-sm text-warm-700">{o.detail}</span>
            <span className="mt-auto flex gap-3 pt-1 text-sm">
              <Link
                href={hrefWithInstitutionContext(`/pro/research?fee=${encodeURIComponent(o.feeCategory)}`, institutionId)}
                className="text-terra-text underline"
              >
                Research
              </Link>
              <Link
                href={hrefWithInstitutionContext(`/pro/simulate?fee=${encodeURIComponent(o.feeCategory)}`, institutionId)}
                className="text-terra-text underline"
              >
                Model a price
              </Link>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5">
        <AuditPanel trail={trail} />
      </div>
    </section>
  );
}
