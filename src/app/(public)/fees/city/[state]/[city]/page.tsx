/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown invalidates
 * the public read cache its reads carry (#1811). The page reads no session, cookies or search
 * params: ?area=metro is served by metro/page.tsx (the proxy rewrites it), and the table's
 * ?fee= and ?sort= are read in the browser.
 */
export const revalidate = 3600;

import { CityReport } from "./city-report";

export { generateMetadata } from "./city-report";

/** Nothing is rendered at build time; each city renders on its first visit, then from cache. */
export function generateStaticParams() {
  return [];
}

export default async function CityFeePage({ params }: { params: Promise<{ state: string; city: string }> }) {
  const { state, city } = await params;
  return <CityReport state={state} city={city} area="city" />;
}
