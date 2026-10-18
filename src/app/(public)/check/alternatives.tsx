import Link from "next/link";
import type { CityMarket } from "@/lib/data-store/city-market";
import { STATE_NAMES } from "@/lib/us-states";
import { SERIF } from "@/app/landing-shared";
import { ALTERNATIVES_SHOWN, hasLocalComparison, localOptionsLine, lowerLabel, money, type AlternativeList } from "./check-data";
import { FeeIcon } from "./check-result";

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

/** Where the visitor said they are, as the page resolved it. */
export type LocalStatus =
  | { kind: "none" }
  | { kind: "needs-state"; text: string }
  | { kind: "not-found"; text: string }
  | { kind: "no-fees"; city: string }
  | { kind: "found"; market: CityMarket; city: string; state: string; viaZip: string | null };

/** One fee's lower-priced institutions in the city, each a compact card with its price and the saving. */
function AlternativeFee({
  list,
  name,
  city,
  cityHref,
}: {
  list: AlternativeList;
  name: string;
  city: string;
  cityHref: string;
}) {
  const fee = lowerLabel(list.label);
  const shown = list.lower.slice(0, ALTERNATIVES_SHOWN);
  const floor = `${money(list.floor)}${list.floorAccount ? `, ${list.floorAccount}` : ""}`;
  const chip =
    list.publishing === 0
      ? "None publish it yet"
      : `${list.lower.length} of ${list.publishing} ${list.lower.length === 1 ? "is" : "are"} lower`;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
          <FeeIcon category={list.category} className="size-[18px] text-brick" />
          {list.label}
          {list.category === "monthly_maintenance" ? <span className="text-[13px] font-normal text-ink-muted">checking</span> : null}
        </h3>
        <span className="rounded-full bg-paper px-2.5 py-0.5 text-[12px] font-semibold text-ink-soft ring-1 ring-border">{chip}</span>
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">{name}&apos;s lowest: {floor}</p>
      {shown.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((alt, i) => (
            <li key={alt.id} className="fi-home-fade min-w-0" style={{ animationDelay: `${i * 60}ms` }}>
              <Link
                href={`/check?id=${alt.id}`}
                className="flex h-full min-h-11 flex-col rounded-xl border border-border bg-surface-0 p-3 shadow-fi-1 hover:border-ink"
              >
                <span className="text-[14px] font-medium leading-snug text-ink">{alt.name}</span>
                {alt.account && <span className="mt-0.5 text-[12px] leading-snug text-ink-muted">{alt.account}</span>}
                <span className="mt-auto flex items-baseline justify-between gap-2 pt-2">
                  <span className="font-mono text-[20px] font-semibold tabular-nums text-ink">{money(alt.amount)}</span>
                  <span className="rounded-full bg-below-market/10 px-2 py-0.5 text-[12px] font-semibold text-below-market">
                    {money(Math.round((list.floor - alt.amount) * 100) / 100)} less
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={`${cityHref}?fee=${list.category}&sort=low#compare`} className={`mt-1 inline-flex min-h-11 items-center text-[13px] ${LINK}`}>
        {list.lower.length > shown.length ? `Show all ${list.lower.length} in ${city}` : `Every ${fee} fee in ${city}`}
      </Link>
    </div>
  );
}

/** A plain GET form, so the choice works without JavaScript: `/check?id=…&near=…`. */
function LocationForm({ id, near }: { id: number; near: string }) {
  return (
    <form action="/check#alternatives-heading" method="get" className="mx-auto flex max-w-xl flex-col gap-2 sm:mx-0 sm:flex-row sm:items-end">
      <input type="hidden" name="id" value={id} />
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-left text-[13px] font-medium text-ink-soft">
        Your city and state, or ZIP code
        <input
          type="text"
          name="near"
          defaultValue={near}
          placeholder="Tampa, FL or 33602"
          maxLength={80}
          className="min-h-11 w-full rounded-lg border border-border bg-surface-0 px-3 text-[15px] font-normal text-ink placeholder:text-ink-muted focus:border-ink"
        />
      </label>
      <button type="submit" className="fi-btn fi-btn-secondary inline-flex min-h-11 items-center justify-center px-5">
        Compare prices
      </button>
    </form>
  );
}

/**
 * Lower-priced banks and credit unions where the visitor is. Nothing local appears until the
 * visitor names a city or ZIP: an institution's headquarters is not where every customer lives.
 */
export function LocalOptions({
  id,
  near,
  status,
  lists,
  fees,
  name,
  cityHref,
  headquarters,
}: {
  id: number;
  near: string;
  status: LocalStatus;
  lists: AlternativeList[];
  /** The fees compared, as words, from the institution's own rows ("monthly maintenance or overdraft"). */
  fees: string;
  name: string;
  cityHref: string | null;
  /** "Tallahassee, FL": offered as one choice, never assumed. */
  headquarters: string | null;
}) {
  const found = status.kind === "found" ? status : null;
  const place = found ? `${found.city}, ${found.state}` : null;
  const line = localOptionsLine(
    status.kind === "found" ? { kind: "found", place: `${status.city}, ${status.state}` } : status,
    lists,
    fees,
    name,
  );
  const showHeadquarters = headquarters && !found && near.trim() === "";
  return (
    <section aria-labelledby="alternatives-heading" className="border-t border-border pt-6">
      <h2
        id="alternatives-heading"
        className="text-center text-[28px] font-medium leading-[1.08] tracking-[-0.02em] text-ink sm:text-left sm:text-[36px]"
        style={SERIF}
      >
        {place ? `Compare local options in ${place}` : "Compare local options"}
      </h2>
      <p
        role={status.kind === "none" || found ? undefined : "status"}
        className="mt-2 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left"
      >
        {line}
      </p>
      <div className="mt-4">
        <LocationForm id={id} near={near} />
        {showHeadquarters && (
          <p className="mt-1 text-center text-[13px] text-ink-muted sm:text-left">
            <Link
              href={`/check?${new URLSearchParams({ id: String(id), near: headquarters }).toString()}#alternatives-heading`}
              className={`inline-flex min-h-11 items-center ${LINK}`}
            >
              Use its headquarters city, {headquarters}
            </Link>
          </p>
        )}
      </div>
      {found && cityHref && hasLocalComparison(lists) && (
        <>
          <div className="mt-6 space-y-6">
            {lists.map((list) => (
              <AlternativeFee key={list.category} list={list} name={name} city={found.city} cityHref={cityHref} />
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-snug text-ink-muted sm:mx-0 sm:text-left">
            Published fee schedules of banks and credit unions with a branch in {place} (FDIC Summary of Deposits and NCUA
            branch records), the same list as the {found.city} fee page.
            {found.viaZip ? ` ZIP code ${found.viaZip} is matched to ${found.city} through the same branch records.` : ""}{" "}
            <Link href={`/research/state/${found.state}`} className={LINK}>
              {STATE_NAMES[found.state] ?? found.state} fees
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
