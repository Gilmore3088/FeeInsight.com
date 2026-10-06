/**
 * Shared report sections: agency releases ("developments") and confirmed fee changes.
 *
 * Every line is an agency's own release (title, date, link) or a price change the bank's
 * own schedules bear out. A section with nothing to show says so and why.
 */

import { dataTable, emptyNotice, escapeHtml, footnote, releaseList } from "../index";
import type { ReleaseListGroup } from "../index";
import { formatAmount } from "@/lib/format";
import {
  AGENCY_LABELS,
  DEVELOPMENT_KIND_LABELS,
  DEVELOPMENT_KIND_ORDER,
  itemsNamingState,
  type DevelopmentItem,
  type DevelopmentsBlock,
  type FeeChangesBlock,
  type StateRegulatorRef,
} from "@/lib/report-assemblers/developments";

/** Releases listed per kind before "N more". */
const ITEMS_PER_KIND = 6;
/** Fee changes listed before "N more". */
const CHANGE_ROWS = 15;
/** A feed older than this many days is called out as stale. */
const STALE_FEED_DAYS = 7;

function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function agencies(codes: string[]): string {
  return codes.map((c) => AGENCY_LABELS[c] ?? c).join(", ");
}

function paragraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

function groups(items: DevelopmentItem[], perKind: number): ReleaseListGroup[] {
  return DEVELOPMENT_KIND_ORDER.map((kind) => {
    const ofKind = items.filter((i) => i.kind === kind);
    const more = ofKind.length - perKind;
    return {
      title: `${DEVELOPMENT_KIND_LABELS[kind]} (${ofKind.length})`,
      items: ofKind.slice(0, perKind).map((i) => ({
        date: shortDate(i.date),
        source: agencies(i.agencies),
        title: i.title,
        href: i.link,
      })),
      note: more > 0 ? `${count(more, "more release", "more releases")} of this kind in the window.` : undefined,
    };
  });
}

function feedLine(block: DevelopmentsBlock, now: string): string {
  const agencyList = block.by_agency.map((a) => `${AGENCY_LABELS[a.agency] ?? a.agency} ${a.count}`).join(", ");
  const fetched = block.last_fetched ? block.last_fetched.slice(0, 10) : null;
  const ageDays = fetched ? (Date.parse(now) - Date.parse(fetched)) / 86_400_000 : null;
  const stale =
    fetched && ageDays !== null && ageDays > STALE_FEED_DAYS
      ? ` The release feed last updated ${longDate(fetched)}; anything released after that is not listed.`
      : "";
  return `Source: press releases from the Federal Reserve, FDIC, OCC and CFPB, ${longDate(block.window_start)} to ${longDate(block.window_end)}${agencyList ? ` (${agencyList})` : ""}. A joint release is listed once with each agency named. Calendar notices are left out.${stale}`;
}

function kindSummary(items: DevelopmentItem[]): string {
  return DEVELOPMENT_KIND_ORDER.map((k) => ({ k, n: items.filter((i) => i.kind === k).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${DEVELOPMENT_KIND_LABELS[x.k].toLowerCase()}`)
    .join("; ");
}

/** National: every release in the window, grouped by kind. */
export function developmentsContent(block: DevelopmentsBlock | null | undefined, generatedAt: string): string {
  if (!block) return emptyNotice("Agency releases were not read for this report, so this section is empty.");
  if (block.items.length === 0) {
    return emptyNotice(
      `No Federal Reserve, FDIC, OCC or CFPB releases are stored between ${longDate(block.window_start)} and ${longDate(block.window_end)}${block.last_fetched ? `; the release feed last updated ${longDate(block.last_fetched)}` : ""}.`,
    );
  }
  return [
    paragraph(
      `${count(block.items.length, "release", "releases")} from the four federal banking agencies in the last ${block.window_days} days: ${kindSummary(block.items)}.`,
    ),
    releaseList(groups(block.items, ITEMS_PER_KIND)),
    footnote(feedLine(block, generatedAt)),
  ].join("\n");
}

/** State: releases naming the state, the state regulator, then the federal releases. */
export function stateDevelopmentsContent(
  block: DevelopmentsBlock | null | undefined,
  stateName: string,
  regulator: StateRegulatorRef | null | undefined,
  generatedAt: string,
): string {
  const parts: string[] = [];
  if (block && block.items.length > 0) {
    const naming = itemsNamingState(block.items, stateName);
    parts.push(
      naming.length > 0
        ? releaseList([
            {
              title: `Releases naming ${stateName} (${naming.length})`,
              items: naming.map((i) => ({ date: shortDate(i.date), source: agencies(i.agencies), title: i.title, href: i.link })),
            },
          ])
        : paragraph(
            `None of the ${count(block.items.length, "federal agency release", "federal agency releases")} in the last ${block.window_days} days names ${stateName}. The federal rules, guidance and enforcement below apply to ${stateName} institutions as they do everywhere.`,
          ),
    );
  }

  if (regulator) {
    const bank = regulator.website_url ? `${regulator.agency_name} (${regulator.website_url})` : regulator.agency_name;
    const cu = regulator.credit_union_agency_name
      ? ` State-chartered credit unions answer to the ${regulator.credit_union_website_url ? `${regulator.credit_union_agency_name} (${regulator.credit_union_website_url})` : regulator.credit_union_agency_name}.`
      : "";
    parts.push(
      paragraph(
        `State-chartered banks in ${stateName} are supervised by the ${bank}.${cu} We do not yet collect state regulator bulletins or orders, so state actions are not listed here.`,
      ),
    );
  } else {
    parts.push(paragraph(`We have no ${stateName} banking regulator on file and do not yet collect state regulator bulletins, so state actions are not listed here.`));
  }

  if (!block) {
    parts.push(emptyNotice("Federal agency releases were not read for this report."));
  } else if (block.items.length === 0) {
    parts.push(
      emptyNotice(
        `No Federal Reserve, FDIC, OCC or CFPB releases are stored between ${longDate(block.window_start)} and ${longDate(block.window_end)}.`,
      ),
    );
  } else {
    parts.push(releaseList(groups(block.items, 4)));
    parts.push(footnote(feedLine(block, generatedAt)));
  }
  return parts.join("\n");
}

/** Confirmed price changes at the same banks; `stateCode` narrows to one state. */
export function feeChangesContent(block: FeeChangesBlock | null | undefined, scope: { stateCode?: string; label: string }): string {
  if (!block) return emptyNotice("Fee changes were not read for this report, so this section is empty.");
  const changes = scope.stateCode ? block.changes.filter((c) => c.state_code === scope.stateCode) : block.changes;
  const window = `${longDate(block.window_start)} and this report`;
  const unconfirmed =
    !scope.stateCode && block.not_confirmed > 0
      ? ` ${count(block.not_confirmed, "recorded change was", "recorded changes were")} left out because the bank's newest schedule does not bear it out.`
      : "";
  if (changes.length === 0) {
    return emptyNotice(
      `No confirmed fee price change at ${scope.label} institutions between ${window}.${unconfirmed} A change counts only when the bank's newest schedule states the new price and no longer states the old one.`,
    );
  }
  const up = changes.filter((c) => c.direction === "up").length;
  const down = changes.length - up;
  const rows = changes.slice(0, CHANGE_ROWS).map((c) => ({
    date: shortDate(c.changed_at),
    institution: c.institution_name,
    state: c.state_code ?? "",
    fee: c.display_name,
    was: formatAmount(c.old_amount),
    now: formatAmount(c.new_amount),
  }));
  const more = changes.length - rows.length;
  return [
    paragraph(
      `${count(changes.length, "confirmed price change", "confirmed price changes")} at ${scope.label} institutions between ${window}: ${up} up, ${down} down. Each is the same bank's own schedule before and after, not a shift in which banks are counted.${unconfirmed}`,
    ),
    dataTable({
      columns: [
        { key: "date", label: "Date" },
        { key: "institution", label: "Institution" },
        ...(scope.stateCode ? [] : [{ key: "state", label: "State" }]),
        { key: "fee", label: "Fee" },
        { key: "was", label: "Was", align: "right" as const },
        { key: "now", label: "Now", align: "right" as const },
      ],
      rows,
      caption: more > 0 ? `Newest ${rows.length} of ${changes.length}` : undefined,
    }),
  ].join("\n");
}
