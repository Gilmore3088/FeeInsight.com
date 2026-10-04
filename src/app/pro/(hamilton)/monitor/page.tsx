import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { fetchMonitorPageData } from "@/lib/hamilton/monitor-data";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { StatusStrip } from "@/components/hamilton/monitor/StatusStrip";
import { SignalFeed } from "@/components/hamilton/monitor/SignalFeed";
import { WatchlistPanel } from "@/components/hamilton/monitor/WatchlistPanel";
import { FloatingChatOverlay } from "@/components/hamilton/monitor/FloatingChatOverlay";

export const metadata: Metadata = { title: "Monitor" };

// No ISR — fresh signal data on every page load
export const dynamic = "force-dynamic";

export default async function MonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    const returnPath = params.instId
      ? `/pro/monitor?instId=${encodeURIComponent(params.instId)}`
      : "/pro/monitor";
    redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  }

  const { institution: selectedInstitution } = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: params.instId,
    intent: "monitor",
  });

  const data = await fetchMonitorPageData(user.id, {
    selectedInstitutionId: selectedInstitution?.id ?? null,
  });

  return (
    <>
      {/* Status strip — full width above content */}
      <StatusStrip status={data.status} />

      {/* Page content */}
      <div
        className="@container"
        style={{
          backgroundColor: "var(--hamilton-surface)",
          minHeight: "calc(100vh - 57px)",
        }}
      >
        {/* Page header */}
        <header style={{ marginBottom: "3rem" }}>
          <h1
            className="font-headline"
            style={{
              fontFamily: "var(--hamilton-font-serif)",
              fontSize: "3rem",
              fontStyle: "italic",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: "var(--hamilton-on-surface)",
              marginBottom: "0.5rem",
              lineHeight: 1.1,
            }}
          >
            Monitor
          </h1>
          <p
            style={{
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "1.125rem",
              color: "var(--hamilton-secondary, #5f5e5e)",
              maxWidth: "42rem",
              lineHeight: 1.5,
            }}
          >
            Continuous surveillance of high-priority counterparts and fee
            structures to preserve long-term recurring value.
          </p>
          <p
            style={{
              fontFamily: "var(--hamilton-font-sans)",
              fontSize: "0.8125rem",
              color: "var(--hamilton-text-tertiary)",
              maxWidth: "42rem",
              lineHeight: 1.5,
              marginTop: "0.75rem",
            }}
          >
            {data.monitoringScope.label}
          </p>
        </header>

        {/* 12-col grid: feed (7) + sidebar (5) — collapses to single column below @3xl */}
        <div className="grid grid-cols-1 gap-8 @3xl:grid-cols-[7fr_5fr] @3xl:gap-12">
          {/* Center column: signal feed */}
          <section>
            {/* Feed header row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "1rem",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--hamilton-font-sans)",
                  fontSize: "0.625rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.2em",
                  color: "var(--hamilton-text-tertiary)",
                  fontWeight: 600,
                }}
              >
                Insight Timeline
              </h2>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.625rem",
                  fontFamily: "var(--hamilton-font-sans)",
                  color: "var(--hamilton-primary)",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                }}
              >
                {/* Server-rendered snapshot: say when, and offer a refresh (nothing polls). */}
                Updated {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET
                <Link href={selectedInstitution ? `/pro/monitor?instId=${selectedInstitution.id}` : "/pro/monitor"} style={{ textDecoration: "underline" }}>
                  Refresh
                </Link>
              </span>
            </div>

            <SignalFeed
              signals={data.signalFeed}
              topAlert={data.topAlert}
              selectedInstitutionId={selectedInstitution?.id.toString() ?? null}
            />
          </section>

          {/* Right sidebar */}
          <aside>
            <WatchlistPanel
              entries={data.watchlist}
              refreshJobs={data.refreshJobs}
              selectedInstitution={selectedInstitution}
            />
          </aside>
        </div>
      </div>

      {/* Floating chat overlay — fixed position */}
      <FloatingChatOverlay institutionId={selectedInstitution?.id.toString() ?? null} />
    </>
  );
}
