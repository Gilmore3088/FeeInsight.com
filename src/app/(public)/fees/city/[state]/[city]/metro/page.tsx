/**
 * The city page's metro view, cached like the city view (#1811). The proxy serves it for
 * /fees/city/<state>/<city>?area=metro; the address in the browser keeps the query string, and
 * the canonical stays the city page (generateMetadata is shared).
 */
export const revalidate = 3600;

import { CityReport } from "../city-report";

export { generateMetadata } from "../city-report";

export function generateStaticParams() {
  return [];
}

export default async function CityMetroFeePage({ params }: { params: Promise<{ state: string; city: string }> }) {
  const { state, city } = await params;
  return <CityReport state={state} city={city} area="metro" />;
}
