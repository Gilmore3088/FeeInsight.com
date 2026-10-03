'use client';

import { useState, useEffect, useRef } from 'react';
import { DISTRICT_NAMES, FDIC_TIER_LABELS, FDIC_TIER_ORDER } from '@/lib/fed-districts';
import { ReportTypeSelector } from './report-type-selector';

interface PeerPreview {
  institution_count: number;
  observation_count: number;
  category_count: number;
  thin: boolean;
}

interface LimitInfo {
  used: number;
  limit: number;
}

interface Props {
  limitReached: boolean;
  limitInfo: LimitInfo | null;
}

const activeChip =
  'inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-full border transition-colors bg-[#C44B2E] text-white border-[#C44B2E]';
const inactiveChip =
  'inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-full border transition-colors bg-white text-[#5A5347] border-[#E8DFD1] hover:border-[#C44B2E]/40 hover:text-[#A93D25] cursor-pointer';

export function ReportGenerationForm({ limitReached, limitInfo }: Props) {
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Peer filter state (for peer_brief / competitive_snapshot)
  const [charter, setCharter] = useState<string>('');
  const [tiers, setTiers] = useState<string[]>([]);
  const [districts, setDistricts] = useState<number[]>([]);

  // District-only state (for district_outlook)
  const [outlookDistrict, setOutlookDistrict] = useState<number | null>(null);

  // Peer preview state
  const [preview, setPreview] = useState<PeerPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPeerType =
    selectedType === 'peer_brief' || selectedType === 'competitive_snapshot';
  const isDistrictType = selectedType === 'district_outlook';

  // Debounced peer preview fetch
  useEffect(() => {
    if (!isPeerType) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams();
        if (charter) params.set('charter', charter);
        if (tiers.length > 0) params.set('tier', tiers.join(','));
        if (districts.length > 0) params.set('district', districts.join(','));

        const res = await fetch(`/api/reports/peer-brief/confirm?${params.toString()}`);
        if (res.ok) {
          const data = await res.json() as PeerPreview;
          setPreview(data);
        }
      } catch {
        // Preview failures are non-critical; leave stale preview visible
      } finally {
        setPreviewLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [charter, tiers, districts, isPeerType]);

  function toggleTier(tierKey: string) {
    setTiers((prev) =>
      prev.includes(tierKey) ? prev.filter((t) => t !== tierKey) : [...prev, tierKey]
    );
  }

  function toggleDistrict(d: number) {
    setDistricts((prev) =>
      prev.includes(d) ? prev.filter((v) => v !== d) : [...prev, d]
    );
  }

  function handleTypeSelect(type: string) {
    setSelectedType(type);
    setError(null);
    setPreview(null);
    setCharter('');
    setTiers([]);
    setDistricts([]);
    setOutlookDistrict(null);
  }

  function handleBack() {
    setSelectedType(null);
    setError(null);
  }

  async function handleGenerate() {
    if (!selectedType) return;
    setGenerating(true);
    setError(null);

    if (isPeerType) {
      const params = new URLSearchParams({
        intent: 'peer-brief',
        legacyPeerFilters: '1',
      });
      if (charter) params.set('charter', charter);
      if (tiers.length > 0) params.set('tier', tiers.join(','));
      if (districts.length > 0) params.set('district', districts.join(','));
      window.location.assign(`/pro/reports?${params.toString()}`);
      setGenerating(false);
      return;
    }

    if (isDistrictType && outlookDistrict !== null) {
      const params = new URLSearchParams({
        intent: 'executive-briefing',
        legacyPeerFilters: '1',
        district: String(outlookDistrict),
      });
      window.location.assign(`/pro/reports?${params.toString()}`);
      setGenerating(false);
      return;
    }

    try {
      window.location.assign('/pro/reports');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  }

  // Step 1: No type selected — show type selector
  if (!selectedType) {
    return (
      <div className="space-y-6">
        {limitReached && limitInfo && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">
            You&apos;ve generated {limitInfo.used} of {limitInfo.limit} reports today.
            Daily limit resets at midnight.
          </div>
        )}
        <ReportTypeSelector onSelect={handleTypeSelect} selected={selectedType} />
      </div>
    );
  }

  // Step 2: Type selected — show scope form
  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-1.5 text-sm text-[#7A7265] hover:text-[#1A1815] transition-colors"
      >
        <svg aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
          />
        </svg>
        Back to report types
      </button>

      {/* Daily limit banner (shown on form step too) */}
      {limitReached && limitInfo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">
          You&apos;ve generated {limitInfo.used} of {limitInfo.limit} reports today.
          Daily limit resets at midnight.
        </div>
      )}

      {/* Peer filter form (peer_brief + competitive_snapshot) */}
      {isPeerType && (
        <div className="rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] p-5 space-y-5">
          {/* Charter */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255] mb-2">
              Charter Type
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { value: '', label: 'All' },
                { value: 'bank', label: 'Bank' },
                { value: 'credit_union', label: 'Credit Union' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCharter(opt.value)}
                  className={charter === opt.value ? activeChip : inactiveChip}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Asset Tier */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255] mb-2">
              Asset Tier
            </p>
            <div className="flex flex-wrap gap-2">
              {FDIC_TIER_ORDER.map((tierKey) => (
                <button
                  key={tierKey}
                  type="button"
                  onClick={() => toggleTier(tierKey)}
                  className={tiers.includes(tierKey) ? activeChip : inactiveChip}
                >
                  {FDIC_TIER_LABELS[tierKey]}
                </button>
              ))}
            </div>
          </div>

          {/* Fed District */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255] mb-2">
              Fed District
            </p>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDistrict(d)}
                  className={districts.includes(d) ? activeChip : inactiveChip}
                >
                  {d} - {DISTRICT_NAMES[d]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* District-only selector (district_outlook) */}
      {isDistrictType && (
        <div className="rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255] mb-3">
            Select Fed District
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setOutlookDistrict(outlookDistrict === d ? null : d)}
                className={outlookDistrict === d ? activeChip : inactiveChip}
              >
                {d} - {DISTRICT_NAMES[d]}
              </button>
            ))}
          </div>
          {outlookDistrict === null && (
            <p className="mt-3 text-xs text-[#6B6255]">
              Select a district to generate the outlook report.
            </p>
          )}
        </div>
      )}

      {/* Peer group preview (peer types only) */}
      {isPeerType && (
        <div className="rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] p-5 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255]">
            Peer Group Preview
          </p>

          {previewLoading && !preview && (
            <p className="text-sm text-[#6B6255]">Loading peer group data...</p>
          )}

          {preview && (
            <>
              <div className="flex items-baseline gap-6">
                <div>
                  <span
                    className={`text-2xl font-bold tabular-nums ${
                      preview.institution_count >= 5 ? 'text-emerald-600' : 'text-amber-600'
                    }`}
                  >
                    {preview.institution_count.toLocaleString()}
                  </span>
                  <span className="ml-1.5 text-xs text-[#6B6255]">institutions</span>
                </div>
                <div>
                  <span className="text-lg font-semibold tabular-nums text-[#1A1815]">
                    {preview.observation_count.toLocaleString()}
                  </span>
                  <span className="ml-1.5 text-xs text-[#6B6255]">observations</span>
                </div>
                <div>
                  <span className="text-lg font-semibold tabular-nums text-[#1A1815]">
                    {preview.category_count.toLocaleString()}
                  </span>
                  <span className="ml-1.5 text-xs text-[#6B6255]">fee categories</span>
                </div>
              </div>

              {preview.thin && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
                  Peer group has fewer than 5 institutions — Hamilton Reports will
                  show the evidence caveat before producing a board-ready output.
                </div>
              )}

              {preview.institution_count > 200 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
                  Peer group exceeds 200 institutions — medians will be statistically robust.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Generate button */}
      <div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={
            generating ||
            (isDistrictType && outlookDistrict === null)
          }
          className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors bg-[#C44B2E] hover:bg-[#A83D25] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {generating ? 'Opening...' : 'Open Hamilton Reports'}
        </button>
      </div>
    </div>
  );
}
