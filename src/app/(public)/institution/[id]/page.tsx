import type { Metadata } from "next";
import { InstitutionProfile, institutionProfileMetadata } from "./profile-page";

/**
 * Cached (ISR) and generated on demand: each profile renders at most once an hour, not on
 * every request (#1811). `?fee=` requests are rewritten by the proxy to ./fee/[fee].
 */
export const revalidate = 3600;
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
  return <InstitutionProfile id={(await params).id} focusFeeCategory={null} />;
}
