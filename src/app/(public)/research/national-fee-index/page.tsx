/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown invalidates
 * the public read cache its reads carry (#1811). This route renders what a signed-out reader
 * sees (the headline categories) and reads no session, so a crawl is served from cache. A
 * signed-in reader is sent to signed-in/page.tsx by the proxy instead (viewer-variant.ts).
 */
export const revalidate = 3600;

import { NationalReport } from "./national-report";

export { metadata } from "./national-report";

export default function NationalFeeIndexPage() {
  return <NationalReport user={null} />;
}
