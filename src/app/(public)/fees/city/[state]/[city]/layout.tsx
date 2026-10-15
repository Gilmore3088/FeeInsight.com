import { notFound } from "next/navigation";
import { loadCityInstitutions, titleCase } from "./city-lookup";

/**
 * A city with no institutions answers 404 (#1165). The check sits in this layout, outside the
 * page's loading boundary: once a loading skeleton streams, the status is fixed at 200. The
 * state is checked by the `[state]` layout above.
 */
export default async function CityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ state: string; city: string }>;
}) {
  const { state, city } = await params;
  const institutions = await loadCityInstitutions(titleCase(city), state.toUpperCase());
  if (institutions.length === 0) notFound();
  return children;
}
