import type { StateNews } from "@/lib/data-store/state-news";
import { STATE_BILL_STAGE_LABELS } from "@/lib/data-store/state-news";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * The Regulatory Wire's state view: the chosen state's regulator posts, fee bills and press
 * coverage, each in its own labelled list so a newspaper story never reads as a release.
 */

interface StateWireProps {
  news: StateNews;
  states: string[];
  activeState: string | null;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}

interface Row {
  key: string;
  href: string | null;
  title: string;
  /** Small label before the date: the state, the bill's stage or the outlet. */
  meta: string[];
  flag?: string;
}

function List({ title, note, rows, empty }: { title: string; note: string; rows: Row[]; empty: string }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        {/* The shell sets h2 in the serif; these list labels match the federal view's sans labels. */}
        <h2
          className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-600"
          style={{ fontFamily: "var(--hamilton-font-sans)" }}
        >
          {title}
        </h2>
        <span className="text-[11px] [font-variant-numeric:tabular-nums] text-warm-600">{rows.length}</span>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-warm-600">{note}</p>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-warm-200 bg-white/70 px-4 py-6 text-center text-[12px] text-warm-600">{empty}</div>
      ) : (
        <ul className="divide-y divide-warm-200/50 overflow-hidden rounded-xl border border-warm-200 bg-white/70">
          {rows.map((row) => {
            const body = (
              <>
                <p className="text-[13px] font-medium leading-snug text-warm-900 group-hover:text-terra">{row.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-warm-600">
                  {row.flag ? (
                    <span className="font-semibold uppercase tracking-wider text-[#A93D25]">{row.flag}</span>
                  ) : null}
                  {row.meta.filter(Boolean).map((m, i) => (
                    <span key={i} className="[font-variant-numeric:tabular-nums]">
                      {m}
                    </span>
                  ))}
                </p>
              </>
            );
            return (
              <li key={row.key}>
                {row.href && /^https?:\/\//i.test(row.href) ? (
                  <a
                    href={row.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block px-4 py-3 no-underline transition-colors hover:bg-warm-100/80"
                  >
                    {body}
                  </a>
                ) : (
                  <div className="px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function StateWire({ news, states, activeState }: StateWireProps) {
  const where = activeState ? stateName(activeState) : "any state";
  const showState = !activeState;
  const options = activeState && !states.includes(activeState) ? [...states, activeState].sort() : states;

  const posts: Row[] = news.regulator_posts.map((p) => ({
    key: p.link,
    href: p.link,
    title: p.title,
    flag: p.fee_related ? "Fees" : undefined,
    meta: [showState ? stateName(p.state_code) : "", shortDate(p.published_at)],
  }));
  const bills: Row[] = news.bills.map((b) => ({
    key: `${b.state_code}-${b.identifier ?? b.title}`,
    href: b.url,
    title: b.identifier ? `${b.identifier}: ${b.title}` : b.title,
    meta: [
      showState ? stateName(b.state_code) : "",
      b.stage ? STATE_BILL_STAGE_LABELS[b.stage] ?? b.stage : "",
      b.stage_on ? `last action ${shortDate(b.stage_on)}` : "",
    ],
  }));
  const press: Row[] = news.press.map((s) => ({
    key: s.link,
    href: s.link,
    title: s.headline,
    meta: [s.publisher ?? "Press", showState ? stateName(s.state_code) : "", shortDate(s.published_at)],
  }));

  return (
    <div className="mt-6">
      <form method="get" action="/pro/news" className="mb-5 flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value="states" />
        <label htmlFor="state-wire-state" className="text-[11px] font-medium text-warm-600">
          State
        </label>
        <select
          id="state-wire-state"
          name="state"
          defaultValue={activeState ?? ""}
          className="rounded-lg border border-warm-200 bg-white/70 px-2.5 py-1.5 text-[12px] text-warm-900"
        >
          <option value="">All states</option>
          {options.map((code) => (
            <option key={code} value={code}>
              {stateName(code)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-warm-900 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-warm-700"
        >
          Show
        </button>
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <List
          title="Regulator posts"
          note="The state banking and credit union regulators' own news. Posts about fees come first."
          rows={posts}
          empty={`No regulator posts stored for ${where} yet.`}
        />
        <List
          title="Fee bills"
          note="Bills in the state legislature whose text names a bank or credit union fee, from Open States."
          rows={bills}
          empty={`No fee bills stored for ${where} yet. Each state's bills are checked once a week.`}
        />
        <List
          title="In the news"
          note="Press stories about those bills or the state's bank fees, from Google News. The outlet's reporting, not the regulator's."
          rows={press}
          empty={`No press stories stored for ${where} yet.`}
        />
      </div>
    </div>
  );
}
