import type { Metadata } from "next";
import { DIRECTORY_METADATA, InstitutionsDirectory, type DirectoryParams } from "../directory-page";

export const metadata: Metadata = DIRECTORY_METADATA;

/**
 * The directory with a search, state, charter, page or fee filter. The proxy rewrites
 * /institutions?<filter> here (the address in the browser is unchanged), so the plain
 * directory stays cached while filtered views render per request. Their searches and state
 * summaries are cached reads (public-cached-reads.ts).
 */
export const dynamic = "force-dynamic";

export default async function InstitutionsResultsPage({ searchParams }: { searchParams: Promise<DirectoryParams> }) {
  return <InstitutionsDirectory params={await searchParams} />;
}
