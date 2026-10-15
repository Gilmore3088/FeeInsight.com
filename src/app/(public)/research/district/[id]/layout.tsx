import { notFound } from "next/navigation";
import { DISTRICT_NAMES } from "@/lib/fed-districts";

/**
 * An unknown Fed district answers 404 (#1165). The check sits in this layout, outside the
 * page's loading boundary: once a loading skeleton streams, the status is fixed at 200.
 */
export default async function DistrictLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!DISTRICT_NAMES[parseInt(id, 10)]) notFound();
  return children;
}
