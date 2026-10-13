import { unstable_cache } from "next/cache";
import { sql } from "@/lib/data-store/connection";
import { readHoldGroups } from "@/lib/agents/darwin/held-queue";

/**
 * Darwin's held fees by reason, shared by /admin/darwin and Today's "Needs you". Holds move with
 * each verify and release step; ten minutes old is fresh enough, and the read takes about 3 s.
 */
export const getCachedHoldGroups = unstable_cache(() => readHoldGroups(sql), ["admin", "darwin-held-queue"], { revalidate: 600 });
