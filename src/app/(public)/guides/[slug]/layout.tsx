import { notFound } from "next/navigation";
import { loadGuide } from "@/lib/guides/source";

/**
 * A missing guide, or a professional one (served gated at /guides/pro/[slug]), answers 404
 * (#1493). The check sits in this layout, above the page's loading skeleton: once a skeleton
 * streams, the status is fixed at 200.
 */
export default async function GuideLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = await loadGuide(slug);
  if (!guide || guide.audience !== "consumer") notFound();
  return children;
}
