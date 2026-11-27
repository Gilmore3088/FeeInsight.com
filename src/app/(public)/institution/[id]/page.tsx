import type { Metadata } from "next";
import { InstitutionProfile, institutionProfileMetadata } from "./profile-page";

/**
 * Cached (ISR) and generated on demand: each profile renders at most once a day, not on
 * every request (#1811). Fee focus is read on the client, not a separate cache key.
 */
export const revalidate = 86400;
export const dynamicParams = true;

export function generateStaticParams(): { id: string }[] {
  return [];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return institutionProfileMetadata((await params).id);
}

export default async function InstitutionProfilePage({ params }: PageProps) {
  return <InstitutionProfile id={(await params).id} />;
}
