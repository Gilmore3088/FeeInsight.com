import type { DataRoomCounts } from "@/lib/data-store/data-room";
import type { WorkPile } from "@/lib/admin-work-piles";

/**
 * The Data room's frame (#1122 step 5): three numbers for what we hold, and the data piles found
 * in the 2026-10-13 review, each with the way out the code gives it today. Pure. A null `counts`
 * means the read failed: every tile and pile says so instead of showing zero.
 */

export interface DataVital {
  label: string;
  value: string | null;
  note: string;
  href: string;
}

const count = (value: number) => value.toLocaleString("en-US");
const UNREADABLE = "Could not be read just now.";

export function dataRoomVitals(counts: DataRoomCounts | null): DataVital[] {
  return [
    {
      label: "Institutions with live fees",
      value: counts ? count(counts.liveInstitutions) : null,
      note: counts ? "with at least one published dollar fee" : UNREADABLE,
      href: "/admin/institutions",
    },
    {
      label: "Live dollar fees",
      value: counts ? count(counts.liveFees) : null,
      note: counts ? "rows in published_fee_catalog" : UNREADABLE,
      href: "/admin/fees/catalog",
    },
    {
      label: "Live rate fees",
      value: counts ? count(counts.liveRateFees) : null,
      note: counts ? "fees stated as a rate, never pooled with dollars" : UNREADABLE,
      href: "/admin/fees/catalog",
    },
  ];
}

export function dataRoomPiles(counts: DataRoomCounts | null): WorkPile[] {
  return [
    {
      key: "pro-institutions-below-minimum",
      title: "Pro institutions under 3 live fees",
      href: "https://github.com/Gilmore3088/FeeInsight.com/issues/1078",
      count: counts ? counts.proInstitutionsBelowMinimum : null,
      unit: "Pro accounts' own institutions",
      oldest: null,
      wayOut: "Atlas gives each a direct read run, again every 24 hours until it has 3 live fees (#1078).",
      ...(counts ? {} : { note: UNREADABLE }),
    },
    {
      key: "closed-institution-fees",
      title: "Live fees at closed institutions",
      href: "https://github.com/Gilmore3088/FeeInsight.com/issues/1200",
      count: counts ? counts.closedInstitutionFees : null,
      unit: counts ? `fees at ${count(counts.closedInstitutions)} inactive or closed institutions` : "fees",
      oldest: null,
      wayOut: "None yet: they stay live until James picks a takedown or a catalog filter (#1200).",
      ...(counts ? {} : { note: UNREADABLE }),
    },
    {
      key: "city-at-limit",
      title: "City names at the 15-character cut",
      href: "https://github.com/Gilmore3088/FeeInsight.com/issues/1213",
      count: counts ? counts.cityAtLimit : null,
      unit: "institutions; some are real 15-letter names",
      oldest: null,
      wayOut: "Atlas's daily city repair restores each credit union city NCUA's branch file extends; real 15-letter names stay (#1213).",
      ...(counts ? {} : { note: UNREADABLE }),
    },
  ];
}
