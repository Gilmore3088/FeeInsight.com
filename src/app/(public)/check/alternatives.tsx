import Link from "next/link";
import { ALTERNATIVES_SHOWN, lowerLabel, money, type AlternativeList } from "./check-data";

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

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
  return (
    <figure className="min-w-0 rounded-xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-5">
      <figcaption className="text-[15px] font-semibold text-ink">{list.label}</figcaption>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft sm:mx-0 sm:text-left">
        {(() => {
          const kind = list.category === "monthly_maintenance" ? " for a checking account" : "";
          const floor = `${money(list.floor)}${list.floorAccount ? ` (${list.floorAccount})` : ""}`;
          return list.lower.length > 0
            ? `${list.lower.length} of ${list.publishing} list a lower price${kind} than ${name}'s lowest, ${floor}.`
            : `None of ${list.publishing} list a lower price${kind} than ${name}'s lowest, ${floor}.`;
        })()}
      </p>
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
        {list.lower.length > shown.length
          ? `Show all ${list.lower.length} in ${city}`
          : `Compare every ${fee} fee in ${city}`}
      </Link>
    </figure>
  );
}

export function Alternatives({
  lists,
  name,
  city,
  cityHref,
  stateHref,
  stateName,
  source,
}: {
  lists: AlternativeList[];
  name: string;
  city: string;
  cityHref: string;
  stateHref: string | null;
  stateName: string | null;
  source: string;
}) {
  const lower = new Set(lists.flatMap((l) => l.lower.map((alt) => alt.id))).size;
  const fees = lists.map((l) => lowerLabel(l.label)).join(" or ");
  const finding =
    lower === 0
      ? `No other bank or credit union with a branch in ${city} lists a lower ${fees} fee than ${name}'s lowest price.`
      : `${lower} ${lower === 1 ? "bank or credit union" : "banks and credit unions"} with a branch in ${city} ${lower === 1 ? "lists" : "list"} a lower ${fees} fee than ${name}'s lowest price.`;
  return (
    <section aria-labelledby="alternatives-heading" className="border-t border-border pt-6">
      <h2 id="alternatives-heading" className="text-center text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-left sm:text-[24px]">
        Alternatives near its headquarters in {city}
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">{finding}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {lists.map((list) => (
          <AlternativeFee key={list.category} list={list} name={name} city={city} cityHref={cityHref} />
        ))}
      </div>
      <p className="mt-3 text-[12px] leading-snug text-ink-muted sm:mx-0 sm:text-left">
        {source}{" "}
        {stateHref && stateName && (
          <Link href={stateHref} className={LINK}>
            {stateName} fees
          </Link>
        )}
      </p>
    </section>
  );
}
