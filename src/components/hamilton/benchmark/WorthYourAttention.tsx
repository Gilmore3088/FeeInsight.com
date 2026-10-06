import Link from "next/link";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { AttentionItem } from "@/lib/hamilton/briefing-observations";
import type { AuditTrail } from "@/lib/hamilton/audit-trail";
import { AuditPanel } from "@/components/hamilton/memo/memo";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;
const COUNT_WORDS = ["", "one thing", "two things", "three things"];

/**
 * The top of This month: overdraft first, then what the engine found unusual (a fee far from its
 * peers, competitors' changes, a move in service charge income), each with a way into My fees and
 * Try a price. It never says what to do about them.
 */
export function WorthYourAttention({
  observations,
  institutionId,
  trail,
}: {
  observations: AttentionItem[];
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
        Overdraft first, then what stood out against your peers and your state this month. Whether it matters depends on your goals; open one to look closer.
      </p>
      <ol className="mt-5 flex flex-col">
        {observations.map((o, i) => (
          <li key={o.id} className="grid gap-x-8 gap-y-2 border-t border-warm-300 py-5 md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span className="text-sm font-semibold text-terra-text">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex flex-col gap-3">
              <span className="text-xl leading-snug text-warm-900" style={SERIF}>
                {o.headline}
              </span>
              {o.feeCategory ? (
                <span className="flex gap-4 text-sm">
                  <Link
                    href={hrefWithInstitutionContext(`/pro/research?fee=${encodeURIComponent(o.feeCategory)}`, institutionId)}
                    className="text-terra-text underline"
                  >
                    Look closer
                  </Link>
                  <Link
                    href={hrefWithInstitutionContext(`/pro/simulate?fee=${encodeURIComponent(o.feeCategory)}`, institutionId)}
                    className="text-terra-text underline"
                  >
                    Try a price
                  </Link>
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-warm-700">
              {o.facts.map((f) => (
                <p key={f}>{f}</p>
              ))}
              {o.note ? <p className="text-terra-text">{o.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5">
        <AuditPanel trail={trail} />
      </div>
    </section>
  );
}
