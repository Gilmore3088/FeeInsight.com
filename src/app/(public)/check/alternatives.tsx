import Link from "next/link";
import type { CityMarket } from "@/lib/data-store/city-market";
import { STATE_NAMES } from "@/lib/us-states";
import { ALTERNATIVES_SHOWN, lowerLabel, money, type AlternativeList } from "./check-data";

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

/** Where the visitor said they are, as the page resolved it. */
export type LocalStatus =
  | { kind: "none" }
  | { kind: "needs-state"; text: string }
  | { kind: "not-found"; text: string }
  | { kind: "found"; market: CityMarket; city: string; state: string; viaZip: string | null };

/** One fee's lower-priced institutions in the city, named with their account and price. */
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
  const kind = list.category === "monthly_maintenance" ? " for a checking account" : "";
  const floor = `${money(list.floor)}${list.floorAccount ? ` (${list.floorAccount})` : ""}`;
  const line =
    list.publishing === 0
      ? `No other bank or credit union with a branch in ${city} publishes this fee${kind} yet.`
      : list.lower.length > 0
        ? `${list.lower.length} of ${list.publishing} list a lower price${kind} than ${name}'s lowest, ${floor}.`
        : `None of ${list.publishing} list a lower price${kind} than ${name}'s lowest, ${floor}.`;
  return (
    <figure className="min-w-0 rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-5">
      <figcaption className="text-[15px] font-semibold text-ink">{list.label}</figcaption>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft sm:mx-0 sm:text-left">{line}</p>
      {shown.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {shown.map((alt) => (
            <li key={alt.id}>
              <Link
                href={`/check?id=${alt.id}`}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-2 text-[14px] text-ink hover:text-brick"
              >
                <span className="min-w-0">
                  <span className="font-medium">{alt.name}</span>
                  {alt.account && <span className="block text-[12px] text-ink-muted">{alt.account}</span>}
                </span>
                <span className="font-mono tabular-nums">{money(alt.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={`${cityHref}?fee=${list.category}&sort=low#compare`} className={`mt-2 inline-flex min-h-11 items-center text-[13px] ${LINK}`}>
        {list.lower.length > shown.length ? `Show all ${list.lower.length} in ${city}` : `Compare every ${fee} fee in ${city}`}
      </Link>
    </figure>
  );
}

/** A plain GET form, so the choice works without JavaScript: `/check?id=…&near=…`. */
function LocationForm({ id, near }: { id: number; near: string }) {
  return (
    <form action="/check" method="get" className="mx-auto flex max-w-xl flex-col gap-2 sm:mx-0 sm:flex-row sm:items-end">
      <input type="hidden" name="id" value={id} />
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-left text-[13px] font-medium text-ink-soft">
        Your city and state, or ZIP code
        <input
          type="text"
          name="near"
          defaultValue={near}
          placeholder="Tampa, FL or 33602"
          maxLength={80}
          className="min-h-11 w-full rounded-lg border border-border bg-surface-0 px-3 text-[15px] font-normal text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
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
  name,
  cityHref,
  headquarters,
}: {
  id: number;
  near: string;
  status: LocalStatus;
  lists: AlternativeList[];
  name: string;
  cityHref: string | null;
  /** "Tallahassee, FL": offered as one choice, never assumed. */
  headquarters: string | null;
}) {
  const found = status.kind === "found" ? status : null;
  const place = found ? `${found.city}, ${found.state}` : null;
  const lower = new Set(lists.flatMap((l) => l.lower.map((alt) => alt.id))).size;
  const fees = lists.map((l) => lowerLabel(l.label)).join(" or ");
  const line = found
    ? lower === 0
      ? `No other bank or credit union with a branch in ${place} lists a lower ${fees} fee than ${name}'s lowest price.`
      : `${lower} ${lower === 1 ? "bank or credit union" : "banks and credit unions"} with a branch in ${place} ${lower === 1 ? "lists" : "list"} a lower ${fees} fee than ${name}'s lowest price.`
    : status.kind === "needs-state"
      ? /^[\d-]+$/.test(status.text)
        ? "Enter a five-digit ZIP code, or a city and state such as Tampa, FL."
        : `Add the state to “${status.text}”, for example Tampa, FL.`
      : status.kind === "not-found"
        ? `No bank or credit union branch is on record for “${status.text}”. Try a nearby city or another ZIP code.`
        : `Banks and credit unions with a branch in your city that list a lower ${fees} fee than ${name}.`;
  const showHeadquarters = headquarters && !found && near.trim() === "";
  return (
    <section aria-labelledby="alternatives-heading" className="border-t border-border pt-6">
      <h2 id="alternatives-heading" className="text-center text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-left sm:text-[24px]">
        {place ? `Compare local options in ${place}` : "Compare local options"}
      </h2>
      <p
        role={status.kind === "needs-state" || status.kind === "not-found" ? "status" : undefined}
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
      {found && cityHref && lists.length > 0 && (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
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
