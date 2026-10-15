import { notFound } from "next/navigation";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * An unknown state answers 404 for its city directory and every city under it (#1165). The
 * check sits in this layout, above every loading boundary below it: once a loading skeleton
 * streams, the status is fixed at 200. The directory page and its skeleton live in the
 * `(directory)` group so its skeleton does not wrap the city pages.
 */
export default async function CityStateLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  if (!STATE_NAMES[state.toUpperCase()]) notFound();
  return children;
}
