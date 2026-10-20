import type { Metadata } from "next";
import { directoryMetadata, InstitutionsDirectory } from "./directory-page";

export const metadata: Metadata = directoryMetadata({});

/**
 * The plain directory, cached (ISR) and rendered at most once an hour (#1811). A request with
 * a search or filter in its query string is rewritten by the proxy to ./results, which
 * renders per request.
 */
export const revalidate = 3600;

export default function InstitutionsPage() {
  return <InstitutionsDirectory params={{}} />;
}
