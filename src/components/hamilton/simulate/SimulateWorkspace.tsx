"use client";

import { useState, useEffect, useCallback } from "react";
import { useCompletion } from "@ai-sdk/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import {
  computeFeePosition,
  computeTradeoffs,
  type DistributionData,
  type FeePosition,
  type TradeoffDeltas,
} from "@/lib/hamilton/simulation";
import { canSimulate, type ConfidenceTier } from "@/lib/hamilton/confidence";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import {
  getSimulationCategories,
  getDistributionForCategory,
  getInstitutionFee,
  getScenario,
  saveScenario,
  listScenarios,
} from "@/app/pro/(hamilton)/simulate/actions";
import { ScenarioCategorySelector, type SimulationCategory } from "./ScenarioCategorySelector";
import { FeeSlider } from "./FeeSlider";
import { CurrentVsProposed } from "./CurrentVsProposed";
import { StrategicTradeoffs } from "./StrategicTradeoffs";
import { RecommendedPositionCard } from "./RecommendedPositionCard";
import { HamiltonInterpretation } from "./HamiltonInterpretation";
import { ScenarioArchive, type ScenarioListItem } from "./ScenarioArchive";
import { InsufficientConfidenceGate } from "./InsufficientConfidenceGate";
import { GenerateBoardSummaryButton } from "./GenerateBoardSummaryButton";
import {
  PeerBaselineSelector,
  type HamiltonPeerSetOption,
} from "@/components/hamilton/PeerBaselineSelector";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";

interface InstitutionContext {
  name?: string;
  type?: string;
  assetTier?: string;
  fedDistrict?: number | null;
}

interface Props {
  userId: number;
  institutionId: string | null;
  institutionContext: InstitutionContext;
  initialCategory?: string;
  initialScenarioId?: string;
  peerSetId?: string | null;
  savedPeerSets: HamiltonPeerSetOption[];
  selectedSource?: HamiltonContextSource;
  selectedSourceLabel?: string | null;
}

function formatDollar(v: number): string {
  return `$${v.toFixed(2)}`;
}

function formatCategory(cat: string): string {
  return DISPLAY_NAMES[cat] ?? cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function peerSourceLabel(source: DistributionData["peer_source"] | undefined): string {
  if (source === "saved-peer-set") return "Saved peer set";
  if (source === "selected-institution-default") return "Selected-institution peers";
  if (source === "national") return "National index";
  return "Peer baseline";
}

export function SimulateWorkspace({
  institutionId,
  institutionContext,
  initialCategory,
  initialScenarioId,
  peerSetId,
  savedPeerSets,
  selectedSource,
  selectedSourceLabel,
}: Props) {
  const router = useRouter();

  // ─── Category + Distribution ───────────────────────────────────────────────
  const [categories, setCategories] = useState<SimulationCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [distribution, setDistribution] = useState<DistributionData | null>(null);
  const [confidenceTier, setConfidenceTier] = useState<ConfidenceTier | null>(null);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Fee Values ───────────────────────────────────────────────────────────
  const [currentFee, setCurrentFee] = useState(0);
  const [proposedFee, setProposedFee] = useState(0);
  const [usingInstitutionFee, setUsingInstitutionFee] = useState(false);

  // ─── Scenario Persistence ─────────────────────────────────────────────────
  const [savedScenarioId, setSavedScenarioId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioListItem[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [scenarioPeerSetId, setScenarioPeerSetId] = useState<string | null | undefined>(undefined);
  const activePeerSetId = scenarioPeerSetId === undefined ? peerSetId ?? null : scenarioPeerSetId;
  const defaultPeerSetLabel = institutionId
    ? "Selected institution peer default"
    : "Verified national index";

  // ─── Streaming Interpretation ────────────────────────────────────────────
  const { complete, completion, isLoading: isStreaming } = useCompletion({
    api: "/api/hamilton/simulate",
  });

  // ─── Derived State ────────────────────────────────────────────────────────
  let currentPosition: FeePosition | null = null;
  let proposedPosition: FeePosition | null = null;
  let tradeoffs: TradeoffDeltas | null = null;

  if (distribution) {
    currentPosition = computeFeePosition(currentFee, distribution);
    proposedPosition = computeFeePosition(proposedFee, distribution);
    tradeoffs = computeTradeoffs(currentFee, proposedFee, currentPosition, proposedPosition);
  }

  const simulationBlocked =
    confidenceTier !== null && !canSimulate(confidenceTier).allowed;
  const blockedReason =
    confidenceTier !== null && !canSimulate(confidenceTier).allowed
      ? (canSimulate(confidenceTier) as { allowed: false; reason: string }).reason
      : "";

  const canGenerateSummary = !isStreaming && completion.length > 0 && !simulationBlocked;
  const collaborateHref = hrefWithInstitutionContext(
    "/pro/settings#workspace-access",
    institutionId,
  );

  // ─── Category Selection ───────────────────────────────────────────────────
  const handleCategorySelect = useCallback(async (feeCategory: string, peerSetOverride?: string | null) => {
    const effectivePeerSetId = peerSetOverride === undefined ? activePeerSetId : peerSetOverride;
    setSelectedCategory(feeCategory);
    setLoadingCategory(true);
    setError(null);
    setSavedScenarioId(null);
    setSelectedScenarioId(null);

    const result = await getDistributionForCategory(feeCategory, {
      institutionId,
      peerSetId: effectivePeerSetId,
    });
    if ("error" in result) {
      setError(result.error);
      setDistribution(null);
      setConfidenceTier(null);
    } else {
      setDistribution(result.distribution);
      setConfidenceTier(result.confidenceTier);

      // Use institution's actual fee if available, otherwise the selected peer median.
      const instFee = institutionId ? await getInstitutionFee(institutionId, feeCategory) : null;
      const hasInstFee = instFee !== null;
      const startingFee = hasInstFee ? instFee.amount : result.distribution.median_amount;
      setUsingInstitutionFee(hasInstFee);
      setCurrentFee(startingFee);
      setProposedFee(startingFee);
    }

    setLoadingCategory(false);
  }, [institutionId, activePeerSetId]);

  const handlePeerSetChange = useCallback((nextPeerSetId: string | null) => {
    setScenarioPeerSetId(nextPeerSetId);
    setSavedScenarioId(null);
    setSelectedScenarioId(null);
    setError(null);
    if (selectedCategory) {
      void handleCategorySelect(selectedCategory, nextPeerSetId);
    }
  }, [selectedCategory, handleCategorySelect]);

  // ─── Initialization ───────────────────────────────────────────────────────
  useEffect(() => {
    getSimulationCategories({ institutionId, peerSetId: activePeerSetId })
      .then((cats) => {
        setCategories(cats);
        if (initialCategory && cats.some((c) => c.fee_category === initialCategory)) {
          handleCategorySelect(initialCategory);
        }
      })
      .catch(() => setError("Failed to load fee categories"))
      .finally(() => setLoadingCategories(false));

    listScenarios()
      .then(setScenarios)
      .catch(() => {});
  }, [initialCategory, handleCategorySelect, institutionId, activePeerSetId]);

  // ─── Slider Handlers ──────────────────────────────────────────────────────
  const handleSliderChange = useCallback((value: number[]) => {
    const newFee = value[0];
    if (newFee !== undefined) {
      setProposedFee(newFee);
      setSavedScenarioId(null);
    }
  }, []);

  const handleSliderCommit = useCallback(
    async (value: number[]) => {
      const proposed = value[0];
      if (proposed === undefined || !distribution || !selectedCategory) return;

      setProposedFee(proposed);
      setSavedScenarioId(null);

      await complete("", {
        body: {
          feeCategory: selectedCategory,
          currentFee,
          proposedFee: proposed,
          institutionId: institutionId ?? null,
          peerSetId: activePeerSetId,
        },
      });
    },
    [distribution, selectedCategory, currentFee, institutionId, activePeerSetId, complete]
  );

  const handleInputChange = useCallback(
    (value: number) => {
      if (!distribution) return;
      const clamped = Math.max(distribution.min_amount, Math.min(distribution.max_amount, value));
      setProposedFee(clamped);
      setSavedScenarioId(null);
    },
    [distribution]
  );

  const handleInputCommit = useCallback(async () => {
    if (!distribution || !selectedCategory) return;
    await complete("", {
      body: {
        feeCategory: selectedCategory,
        currentFee,
        proposedFee,
        institutionId: institutionId ?? null,
        peerSetId: activePeerSetId,
      },
    });
  }, [distribution, selectedCategory, currentFee, proposedFee, institutionId, activePeerSetId, complete]);

  // ─── Save Scenario ────────────────────────────────────────────────────────
  const handleSave = useCallback(async (): Promise<string | null> => {
    if (!selectedCategory || !distribution || !confidenceTier || !proposedPosition) return null;
    if (simulationBlocked) return null;

    setIsSaving(true);
    const result = await saveScenario({
      institutionId: institutionId ?? "",
      feeCategory: selectedCategory,
      currentValue: currentFee,
      proposedValue: proposedFee,
      resultJson: {
        currentFee,
        proposedFee,
        currentPosition,
        proposedPosition,
        peerContext: {
          label: distribution.peer_label,
          source: distribution.peer_source,
          fallbackReason: distribution.peer_fallback_reason,
        },
        interpretation: completion,
      },
      confidenceTier,
      peerSetId: distribution.peer_set_id ?? activePeerSetId ?? null,
      evidencePolicy: "verified-only",
      peerBaselineSource: distribution.peer_source ?? null,
      peerBaselineLabel: distribution.peer_label ?? null,
      peerFallbackReason: distribution.peer_fallback_reason ?? null,
      selectedSource,
      selectedSourceLabel,
    });

    setIsSaving(false);

    if ("error" in result) {
      setError(result.error);
      return null;
    }

    setSavedScenarioId(result.id);
    listScenarios().then(setScenarios).catch(() => {});
    return result.id;
  }, [
    selectedCategory,
    distribution,
    confidenceTier,
    proposedPosition,
    simulationBlocked,
    institutionId,
    currentFee,
    proposedFee,
    currentPosition,
    completion,
    activePeerSetId,
    selectedSource,
    selectedSourceLabel,
  ]);

  const handleReset = useCallback(() => {
    if (!distribution) return;
    setProposedFee(distribution.median_amount);
    setSavedScenarioId(null);
  }, [distribution]);

  const handleExportData = useCallback(() => {
    if (!selectedCategory || !distribution || !currentPosition || !proposedPosition || !tradeoffs) {
      return;
    }

    const rows = [
      ["field", "value"],
      ["institution", institutionContext.name ?? ""],
      ["fee_category", selectedCategory],
      ["current_fee", String(currentFee)],
      ["proposed_fee", String(proposedFee)],
      ["current_percentile", String(currentPosition.percentile)],
      ["proposed_percentile", String(proposedPosition.percentile)],
      ["current_median_gap", String(currentPosition.medianGap)],
      ["proposed_median_gap", String(proposedPosition.medianGap)],
      ["current_risk_profile", currentPosition.riskProfile],
      ["proposed_risk_profile", proposedPosition.riskProfile],
      ["median", String(distribution.median_amount)],
      ["p25", String(distribution.p25_amount)],
      ["p75", String(distribution.p75_amount)],
      ["approved_count", String(distribution.approved_count)],
      ["peer_label", distribution.peer_label ?? ""],
      ["peer_source", distribution.peer_source ?? ""],
      ["peer_fallback_reason", distribution.peer_fallback_reason ?? ""],
      ["evidence_policy", "verified-only"],
      ["selected_source", selectedSource ?? ""],
      ["selected_source_label", selectedSourceLabel ?? ""],
      ["confidence_tier", confidenceTier ?? ""],
      ["revenue_impact", tradeoffs.revenueImpact.value],
      ["peer_risk_exposure", tradeoffs.riskMitigation.value],
      ["risk_profile_shift", tradeoffs.operationalImpact.value],
    ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${cell.replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hamilton-scenario-${selectedCategory}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [
    selectedCategory,
    distribution,
    currentPosition,
    proposedPosition,
    tradeoffs,
    institutionContext.name,
    currentFee,
    proposedFee,
    confidenceTier,
    selectedSource,
    selectedSourceLabel,
  ]);

  // ─── Generate Board Summary ───────────────────────────────────────────────
  const handleGenerateSummary = useCallback(async () => {
    let scenarioId = savedScenarioId;
    if (!scenarioId) {
      scenarioId = await handleSave();
    }
    if (scenarioId) {
      const query = new URLSearchParams({ scenario_id: scenarioId });
      if (institutionId) query.set("instId", institutionId);
      const scenarioPeerSetId = distribution?.peer_set_id ?? activePeerSetId;
      if (scenarioPeerSetId) query.set("peerSetId", scenarioPeerSetId);
      router.push(`/pro/reports?${query.toString()}`);
    }
  }, [savedScenarioId, handleSave, institutionId, distribution?.peer_set_id, activePeerSetId, router]);

  // ─── Restore Scenario ─────────────────────────────────────────────────────
  const handleScenarioSelect = useCallback(
    async (scenario: ScenarioListItem) => {
      const scenarioPeerSetId = scenario.peer_set_id ?? null;
      setScenarioPeerSetId(scenarioPeerSetId);

      if (scenario.fee_category !== selectedCategory || scenarioPeerSetId !== activePeerSetId) {
        await handleCategorySelect(scenario.fee_category, scenarioPeerSetId);
      }

      const current = parseFloat(scenario.current_value);
      const proposed = parseFloat(scenario.proposed_value);
      if (!isNaN(current)) setCurrentFee(current);
      if (!isNaN(proposed)) setProposedFee(proposed);
      setSelectedScenarioId(scenario.id);
      setSavedScenarioId(scenario.id);
    },
    [selectedCategory, activePeerSetId, handleCategorySelect]
  );

  useEffect(() => {
    if (!initialScenarioId) return;
    let cancelled = false;

    getScenario(initialScenarioId)
      .then((scenario) => {
        if (!scenario || cancelled) return;
        void handleScenarioSelect(scenario);
      })
      .catch(() => {
        if (!cancelled) setError("Could not restore the selected scenario.");
      });

    return () => {
      cancelled = true;
    };
  }, [initialScenarioId, handleScenarioSelect]);

  // ─── Derived display values ────────────────────────────────────────────────
  const categoryLabel = selectedCategory ? formatCategory(selectedCategory) : "Fee Simulation";
  const hasDistribution = distribution && confidenceTier && !loadingCategory;
  const hasSimulation = hasDistribution && !simulationBlocked && currentPosition && proposedPosition;
  const activePeerLabel = distribution?.peer_label ?? "Peer baseline";
  const benchmarkPosture = distribution
    ? `${distribution.approved_count} approved peer rows · ${peerSourceLabel(distribution.peer_source)}`
    : "Choose a category to load the approved-row peer baseline.";
  const currentPointPosture = distribution
    ? usingInstitutionFee
      ? "Current point uses the selected institution's approved fee row."
      : "Current point starts from the peer median because no approved selected-institution fee row is available."
    : "No selected category loaded.";

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--hamilton-surface)" }}>

      {/* Page Header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className="font-headline text-4xl leading-tight tracking-tight mb-1"
            style={{ color: "var(--hamilton-on-surface)" }}
          >
            {selectedCategory ? `Fee Simulation: ${categoryLabel}` : "Fee Simulation"}
          </h1>
          <p className="font-label text-[10px] uppercase tracking-widest" style={{ color: "var(--hamilton-on-surface-variant)" }}>
            Verified-only benchmark &bull; Provisional rows excluded from scoring
          </p>
        </div>
        <div
          className="flex flex-col items-start gap-1 rounded border px-3 py-2 text-left sm:items-end sm:text-right"
          style={{
            color: "var(--hamilton-primary)",
            background: "color-mix(in srgb, var(--hamilton-primary) 5%, transparent)",
            borderColor: "color-mix(in srgb, var(--hamilton-primary) 10%, transparent)",
          }}
        >
          <span className="font-label text-[9px] font-bold uppercase tracking-widest">
            Manual Scenario Mode
          </span>
          <span className="text-[11px]" style={{ color: "var(--hamilton-on-surface-variant)" }}>
            No provider automation queued
          </span>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm" style={{ color: "rgb(186 26 26)" }}>
          {error}
        </p>
      )}
      {distribution?.peer_fallback_reason && (
        <p className="mb-4 rounded border px-3 py-2 text-xs" style={{ color: "rgb(146 64 14)", borderColor: "rgb(245 158 11)", background: "rgb(255 251 235)" }}>
          {distribution.peer_fallback_reason}
        </p>
      )}

      <div className="mb-5 max-w-xl">
        <PeerBaselineSelector
          id="simulate-peer-baseline"
          value={activePeerSetId}
          defaultLabel={defaultPeerSetLabel}
          peerSets={savedPeerSets}
          disabled={loadingCategories || loadingCategory}
          onChange={handlePeerSetChange}
        />
        <div
          className="mt-3 rounded border px-3 py-2 text-xs leading-relaxed"
          style={{
            borderColor: "rgb(231 229 228)",
            background: "rgb(250 249 248)",
            color: "var(--hamilton-on-surface-variant)",
          }}
        >
          <strong style={{ color: "var(--hamilton-on-surface)" }}>Evidence posture:</strong>{" "}
          Verified-only distribution. {benchmarkPosture} {currentPointPosture}
        </div>
      </div>

      {/* Section 1: Scenario Setup ─────────────────────────────────────────── */}
      <section
        className="mb-8 bg-white p-6 rounded border editorial-shadow"
        style={{
          borderColor: "rgb(231 229 228)",
          boxShadow: "0 0 15px rgba(138, 76, 39, 0.1)",
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-center">
          {/* Category */}
          <div className="flex flex-col border-r pr-8" style={{ borderColor: "rgb(245 245 244)" }}>
            <label className="font-label text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--hamilton-on-surface-variant)" }}>
              Category
            </label>
            {loadingCategories || loadingCategory ? (
              <div className="skeleton h-6 w-32 rounded" />
            ) : (
              <ScenarioCategorySelector
                categories={categories}
                selected={selectedCategory}
                loading={loadingCategories || loadingCategory}
                onSelect={handleCategorySelect}
              />
            )}
          </div>

          {/* Current Point */}
          <div className="flex flex-col border-r pr-8" style={{ borderColor: "rgb(245 245 244)" }}>
            <label className="font-label text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--hamilton-on-surface-variant)" }}>
              {usingInstitutionFee ? "Your Current Fee" : `${activePeerLabel} Median`}
            </label>
            <div
              className="font-headline text-2xl"
              style={{ color: "rgb(120 113 108)" }}
            >
              {hasDistribution ? formatDollar(currentFee) : "—"}
            </div>
            {!hasDistribution && (
              <span className="text-xs mt-1" style={{ color: "var(--hamilton-on-surface-variant)" }}>
                Select a category
              </span>
            )}
          </div>

          {/* Active Simulation Target */}
          <div
            className="md:col-span-2 flex flex-col p-4 rounded border"
            style={{ background: "rgb(250 249 248)", borderColor: "rgb(231 229 228)" }}
          >
            {hasDistribution && !simulationBlocked ? (
              <FeeSlider
                min={distribution!.min_amount}
                max={distribution!.max_amount}
                step={0.25}
                currentFee={currentFee}
                proposedFee={proposedFee}
                median={distribution!.median_amount}
                p75={distribution!.p75_amount}
                onValueChange={handleSliderChange}
                onValueCommit={handleSliderCommit}
                onInputChange={handleInputChange}
                onInputCommit={handleInputCommit}
              />
            ) : (
              <div>
                <label className="font-label text-[10px] uppercase tracking-widest mb-3 block" style={{ color: "var(--hamilton-primary)" }}>
                  Active Simulation Target
                </label>
                <p className="text-sm italic" style={{ color: "var(--hamilton-on-surface-variant)" }}>
                  Select a fee category to begin simulation.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Insufficient confidence gate */}
      {hasDistribution && simulationBlocked && (
        <InsufficientConfidenceGate reason={blockedReason} />
      )}

      {/* Section 2 + 3: Comparison + Analysis ─────────────────────────────── */}
      {hasSimulation && (
        <>
          {/* Side-by-side comparison */}
          <section className="mb-8">
            <CurrentVsProposed
              feeCategory={selectedCategory!}
              currentFee={currentFee}
              proposedFee={proposedFee}
              currentPosition={currentPosition!}
              proposedPosition={proposedPosition!}
            />
          </section>

          {/* Section 3+4: Interpretation + Operational Impact */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-24">
            {/* Hamilton Strategy Interpretation — col-span-7 */}
            <div className="lg:col-span-7 space-y-4">
              <h2
                className="font-label text-[10px] uppercase tracking-widest border-b pb-2"
                style={{ color: "var(--hamilton-on-surface-variant)", borderColor: "rgb(231 229 228)" }}
              >
                Hamilton Strategy Interpretation
              </h2>

              <HamiltonInterpretation
                interpretation={completion}
                isStreaming={isStreaming}
              />

              {/* Finalize / Board Summary CTA */}
              <div className="space-y-2">
                <GenerateBoardSummaryButton
                  disabled={!canGenerateSummary}
                  savedScenarioId={savedScenarioId}
                  onGenerate={handleGenerateSummary}
                />
                {proposedPosition && (
                  <RecommendedPositionCard
                    confidenceTier={confidenceTier!}
                    proposedFee={proposedFee}
                    proposedPosition={proposedPosition!}
                    median={distribution!.median_amount}
                    p25={distribution!.p25_amount}
                  />
                )}
              </div>
            </div>

            {/* Operational Impact — col-span-5 */}
            <div className="lg:col-span-5 space-y-4">
              <h2
                className="font-label text-[10px] uppercase tracking-widest border-b pb-2"
                style={{ color: "var(--hamilton-on-surface-variant)", borderColor: "rgb(231 229 228)" }}
              >
                Operational Impact
              </h2>
              <StrategicTradeoffs tradeoffs={tradeoffs} />
            </div>
          </section>
        </>
      )}

      {/* Scenario archive (collapsible, shown below main content on mobile) */}
      <div className="block lg:hidden mt-4">
        <ScenarioArchive
          scenarios={scenarios}
          selectedId={selectedScenarioId}
          onSelect={handleScenarioSelect}
        />
      </div>

      {/* Fixed Action Bar ──────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white border-t flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between z-40 px-4 py-3 sm:px-12 sm:py-4"
        style={{ borderColor: "rgb(231 229 228)" }}
      >
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:gap-4">
          <button
            onClick={handleSave}
            disabled={isSaving || !hasSimulation}
            className="font-label text-[10px] uppercase tracking-widest px-4 py-2 rounded border transition-all hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              color: "rgb(87 83 78)",
              background: "rgb(250 249 248)",
              borderColor: "rgb(214 211 208)",
            }}
          >
            {isSaving ? "Saving..." : "Save Draft"}
          </button>
          <button
            onClick={handleReset}
            disabled={!hasSimulation}
            className="font-label text-[10px] uppercase tracking-widest px-4 py-2 rounded border transition-all hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              color: "rgb(87 83 78)",
              background: "rgb(250 249 248)",
              borderColor: "rgb(214 211 208)",
            }}
          >
            Reset Simulation
          </button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto sm:gap-6">
          <button
            type="button"
            onClick={handleExportData}
            disabled={!hasSimulation}
            className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest font-bold transition-all hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--hamilton-primary)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Data
          </button>
          <Link
            href={collaborateHref}
            className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest font-bold transition-all hover:opacity-80"
            style={{ color: "var(--hamilton-primary)" }}
          >
            <Share2 className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
            Collaborate
          </Link>
        </div>
      </div>
    </div>
  );
}
