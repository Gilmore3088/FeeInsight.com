import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { focusCategoryFrom, InstitutionProfile, institutionProfileMetadata } from "../../profile-page";

/**
 * The profile opened on one fee (`/institution/[id]?fee=overdraft`, a consumer guide's "check
 * your own bank" link). The proxy rewrites that address here so the variant is cached like the
 * plain profile (#1811); the address in the browser keeps `?fee=`, and the canonical is the
 * plain profile. Only taxonomy categories are rewritten; any other value here is a 404.
 */
export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams(): { fee: string }[] {
  return [];
}

interface PageProps {
  params: Promise<{ id: string; fee: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return institutionProfileMetadata((await params).id);
}

export default async function InstitutionFeeFocusPage({ params }: PageProps) {
  const { id, fee } = await params;
  const focusFeeCategory = focusCategoryFrom(fee);
  if (!focusFeeCategory) notFound();
  return <InstitutionProfile id={id} focusFeeCategory={focusFeeCategory} />;
}
