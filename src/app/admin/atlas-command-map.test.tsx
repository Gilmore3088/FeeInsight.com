// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AtlasCommandCenter } from "@/lib/admin-command-center";
import type { AtlasStateLaneDispatch } from "@/lib/agents/state-lane-memory";
import { vi } from "vitest";
import { AtlasCommandMap } from "./atlas-command-map";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

function center(overrides: Partial<AtlasCommandCenter> = {}): AtlasCommandCenter {
  return {
    activeJobs: [],
    automation: {
      enabled: true,
      reason: null,
      changedBy: "system",
      changedAt: "2026-08-15T20:00:00.000Z",
      revision: 1,
    },
    provider: {
      provider: "anthropic",
      apiKeyConfigured: true,
      status: "ready",
      label: "Provider key configured",
      detail: "Provider calls are available.",
      lastCreditFailureAt: null,
    },
    trustReview: {
      sourceSubmissionsPending: 0,
      totalPending: 0,
    },
    ...overrides,
  } as unknown as AtlasCommandCenter;
}

function dispatch(overrides: Partial<AtlasStateLaneDispatch> = {}): AtlasStateLaneDispatch {
  return {
    schemaReady: true,
    generatedAt: "2026-08-15T20:00:00.000Z",
    totalLanes: 54,
    dueLanes: 0,
    runningLanes: 0,
    attentionLanes: 0,
    totalMissingUrls: 0,
    totalStaleSources: 0,
    totalOcrBacklog: 0,
    totalManualBacklog: 0,
    totalFailures: 0,
    totalCorrections: 0,
    totalPublicFindings: 0,
    totalCriticalPublicFindings: 0,
    nextDueAfter: null,
    latestRunAt: null,
    rows: [],
    stateOptions: [],
    ...overrides,
  };
}

function linkFor(text: string): HTMLAnchorElement {
  const element = screen.getByText(text).closest("a");
  if (!(element instanceof HTMLAnchorElement)) {
    throw new Error(`Expected ${text} to be inside a link`);
  }
  return element;
}

describe("AtlasCommandMap", () => {
  it("routes due state work to the state-lane dispatch controls", () => {
    render(
      <AtlasCommandMap
        center={center()}
        stateLaneDispatch={dispatch({
          dueLanes: 5,
          attentionLanes: 2,
          totalMissingUrls: 18,
          totalStaleSources: 9,
        })}
      />,
    );

    expect(screen.getByText("State Lanes")).toBeInTheDocument();
    expect(screen.getByText("5 due lanes · 2 attention lanes")).toBeInTheDocument();
    expect(linkFor("Run due lanes")).toHaveAttribute("href", "#state-lane-dispatch-heading");
  });

  it("routes pending source reviews to Trust Review", () => {
    render(
      <AtlasCommandMap
        center={center({
          trustReview: {
            sourceSubmissionsPending: 4,
            totalPending: 4,
          },
        })}
        stateLaneDispatch={dispatch()}
      />,
    );

    expect(screen.getByText("Trust Review")).toBeInTheDocument();
    expect(screen.getByText("4 pending items")).toBeInTheDocument();
    expect(screen.getByText("4 submitted sources waiting for acceptance, rejection, or more information.")).toBeInTheDocument();
    expect(linkFor("Review sources")).toHaveAttribute(
      "href",
      "/admin/quality?submissions=pending&state=submitted_source_pending_review",
    );
  });

  it("routes stopped automation to the Atlas safety control", () => {
    render(
      <AtlasCommandMap
        center={center({
          automation: {
            enabled: false,
            reason: "Waiting for updated provider key.",
            changedBy: "admin",
            changedAt: "2026-08-15T20:00:00.000Z",
            revision: 2,
          },
        })}
        stateLaneDispatch={dispatch()}
      />,
    );

    expect(screen.getByText("Automation stopped")).toBeInTheDocument();
    expect(screen.getByText("Waiting for updated provider key.")).toBeInTheDocument();
    expect(linkFor("Review safety stop")).toHaveAttribute("href", "#atlas-safety");
  });

  it("shows unknown, not stopped, when the safety control cannot be read", () => {
    render(
      <AtlasCommandMap
        center={center({
          automation: {
            enabled: false,
            reason: "Automation control could not be read.",
            changedBy: "system",
            changedAt: null,
            revision: 0,
            unreadable: true,
          },
        } as unknown as Partial<AtlasCommandCenter>)}
        stateLaneDispatch={dispatch()}
      />,
    );

    expect(screen.getByText("Automation status unknown")).toBeInTheDocument();
    expect(screen.queryByText("Automation stopped")).not.toBeInTheDocument();
    expect(linkFor("Review safety control")).toHaveAttribute("href", "#atlas-safety");
  });
});
