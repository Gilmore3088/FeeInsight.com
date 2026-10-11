/**
 * Shared report sections: agency releases ("developments") and confirmed fee changes.
 *
 * Every line is an agency's own release (title, date, link) or a price change the bank's
 * own schedules bear out. A section with nothing to show says so and why.
 */

import { dataTable, emptyNotice, escapeHtml, footnote, releaseList } from "../primitives";
import type { ReleaseListGroup } from "../primitives";
import { formatAmount } from "@/lib/format";
import { STATE_BILL_STAGE_LABELS, type StateNews } from "@/lib/data-store/state-news";
import {
  AGENCY_LABELS,
  DEVELOPMENTS_WINDOW_DAYS,
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

/** State items listed per group before "N more". */
const STATE_ITEMS_PER_GROUP = 6;

function stateGroup(title: string, items: ReleaseListGroup["items"], noun: [string, string]): ReleaseListGroup {
  const more = items.length - STATE_ITEMS_PER_GROUP;
  return {
    title: `${title} (${items.length})`,
    items: items.slice(0, STATE_ITEMS_PER_GROUP),
    note: more > 0 ? `${count(more, `more ${noun[0]}`, `more ${noun[1]}`)} stored.` : undefined,
  };
}

/**
 * The state's own items: its regulators' posts, its fee bills and press coverage of them.
 * A press story is labelled with its outlet and never as a regulator's release.
 */
export function stateNewsContent(news: StateNews | null | undefined, stateName: string, windowDays: number): string {
  if (!news) return emptyNotice(`${stateName} regulator posts, fee bills and press coverage were not read for this report.`);
  const groupsOut = [
    stateGroup(
      `${stateName} regulator posts`,
      news.regulator_posts.map((p) => ({ date: p.published_at ? shortDate(p.published_at) : "", source: "State regulator", title: p.title, href: p.link })),
      ["post", "posts"],
    ),
    stateGroup(
      `${stateName} fee bills`,
      news.bills.map((b) => ({
        date: b.stage_on ? shortDate(b.stage_on) : "",
        source: b.stage ? STATE_BILL_STAGE_LABELS[b.stage] ?? b.stage : "Bill",
        title: b.identifier ? `${b.identifier}: ${b.title}` : b.title,
        href: b.url,
      })),
      ["bill", "bills"],
    ),
    stateGroup(
      "In the news",
      news.press.map((s) => ({ date: s.published_at ? shortDate(s.published_at) : "", source: s.publisher ?? "Press", title: s.headline, href: s.link })),
      ["story", "stories"],
    ),
  ];
  const total = news.regulator_posts.length + news.bills.length + news.press.length;
  if (total === 0) {
    return emptyNotice(`No ${stateName} regulator posts or press stories from the last ${windowDays} days are stored, and no ${stateName} fee bill has had action in the last year.`);
  }
  const recentMissing = [news.regulator_posts.length === 0 ? "regulator posts" : "", news.press.length === 0 ? "press stories" : ""].filter(Boolean);
  const missing = [
    recentMissing.length > 0 ? `No ${stateName} ${recentMissing.join(" or ")} from the last ${windowDays} days are stored.` : "",
    news.bills.length === 0 ? `No ${stateName} fee bill has had action in the last year.` : "",
  ].filter(Boolean);
  return [
    releaseList(groupsOut),
    missing.length > 0 ? paragraph(missing.join(" ")) : "",
    footnote(
      `Source: the ${stateName} banking and credit union regulators' own news pages; bills in the ${stateName} legislature whose text names a bank or credit union fee (Open States); and press stories naming ${stateName} or one of those bills (Google News). Press stories are the outlet's reporting, not the regulator's. Posts and stories from the last ${windowDays} days; bills with action in the last year.`,
    ),
  ].join("\n");
}

/** State: releases naming the state, the state regulator and its own items, then the federal releases. */
export function stateDevelopmentsContent(
  block: DevelopmentsBlock | null | undefined,
  stateName: string,
  regulator: StateRegulatorRef | null | undefined,
  generatedAt: string,
  stateNews?: StateNews | null,
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
    const collected =
      stateNews === undefined ? " We do not yet collect state regulator bulletins or orders, so state actions are not listed here." : "";
    parts.push(paragraph(`State-chartered banks in ${stateName} are supervised by the ${bank}.${cu}${collected}`));
  } else if (stateNews === undefined) {
    parts.push(paragraph(`We have no ${stateName} banking regulator on file and do not yet collect state regulator bulletins, so state actions are not listed here.`));
  }
  if (stateNews !== undefined) parts.push(stateNewsContent(stateNews, stateName, DEVELOPMENTS_WINDOW_DAYS));

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
