/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown invalidates
 * the public read cache its reads carry (#1811). This route renders what a signed-out reader
 * sees and reads no session, so a crawl is served from cache. A signed-in reader is sent to
 * signed-in/page.tsx by the proxy instead (viewer-variant.ts). A render with a failed read
 * is cached for a minute (`shortenPageLife`, as the homepage).
 */
export const revalidate = 3600;

import { DistrictReport } from "./district-report";

export { generateMetadata } from "./district-report";

/** Nothing is rendered at build time; each district renders on its first visit, then from cache. */
export function generateStaticParams() {
  return [];
}

export default async function DistrictReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DistrictReport id={id} user={null} />;
}
