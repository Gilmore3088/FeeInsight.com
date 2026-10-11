export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { IntelligenceWorkspace } from "@/components/hamilton/intelligence/IntelligenceWorkspace";
export const metadata: Metadata = { title: "Intelligence overview" };
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ research?: string; lens?: string; instId?: string }> }) {
  return <IntelligenceWorkspace overview params={await searchParams} />;
}
