import type { IndexEntry } from "./fee-index";

export interface MarketIndexEntry extends IndexEntry {
  national_median: number | null;
  national_p25: number | null;
  national_p75: number | null;
  national_institution_count: number;
  delta_pct: number | null;
}
