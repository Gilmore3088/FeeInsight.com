"use client";

import { useEffect, useState, type CSSProperties } from "react";

export interface InstitutionSearchResult {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  published_fee_count: number;
  provisional_fee_count: number;
  fee_publication_label: string;
}

interface InstitutionPickerProps {
  inputId: string;
  label: string;
  /** Name of the hidden input that carries the chosen institution id in the form. */
  name?: string;
  initialName?: string | null;
  initialId?: number | null;
  required?: boolean;
  help?: string;
  onSelect?: (result: InstitutionSearchResult | null) => void;
  labelClassName?: string;
  labelStyle?: CSSProperties;
  inputClassName?: string;
  inputStyle?: CSSProperties;
}

export function institutionLocation(result: Pick<InstitutionSearchResult, "city" | "state_code">): string {
  return [result.city, result.state_code].filter(Boolean).join(", ");
}

/**
 * Search-as-you-type institution picker over /api/institutions. Only a matched result
 * can be chosen, so the form always submits a real institution id.
 */
export function InstitutionPicker({
  inputId,
  label,
  name = "institution_id",
  initialName = null,
  initialId = null,
  required = false,
  help = "Pick a matched result; Hamilton stores the institution ID after validation.",
  onSelect,
  labelClassName = "text-[11px] font-semibold uppercase tracking-wider",
  labelStyle = { color: "var(--hamilton-text-secondary)" },
  inputClassName = "rounded-md border px-3 py-2 text-sm outline-none transition-colors",
  inputStyle = {
    backgroundColor: "white",
    borderColor: "var(--hamilton-border)",
    color: "var(--hamilton-text-primary)",
  },
}: InstitutionPickerProps) {
  const [query, setQuery] = useState(initialName ?? "");
  const [selectedId, setSelectedId] = useState<number | null>(initialId);
  const [selectedName, setSelectedName] = useState<string | null>(initialName);
  const [suggestions, setSuggestions] = useState<InstitutionSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    setQuery(initialName ?? "");
    setSelectedId(initialId);
    setSelectedName(initialName);
  }, [initialId, initialName]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed === (selectedName ?? "")) {
      setSuggestions([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(`/api/institutions?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(response.status === 429 ? "Search is rate limited. Try again shortly." : "Search failed.");
        }
        const rows = (await response.json()) as InstitutionSearchResult[];
        setSuggestions(rows);
        setShowSuggestions(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setSearchError(error instanceof Error ? error.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, selectedName]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setSelectedId(null);
    setSelectedName(null);
    setShowSuggestions(value.trim().length >= 2);
    onSelect?.(null);
  }

  function selectInstitution(result: InstitutionSearchResult) {
    setSelectedId(result.id);
    setSelectedName(result.institution_name);
    setQuery(result.institution_name);
    setSuggestions([]);
    setSearchError(null);
    setShowSuggestions(false);
    onSelect?.(result);
  }

  const helpId = `${inputId}_help`;

  return (
    <div className="relative flex flex-col gap-1.5">
      <input type="hidden" name={name} value={selectedId ?? ""} />
      <label htmlFor={inputId} className={labelClassName} style={labelStyle}>
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        required={required}
        autoComplete="off"
        value={query}
        onChange={(event) => handleQueryChange(event.target.value)}
        onFocus={() => query.trim().length >= 2 && setShowSuggestions(true)}
        onBlur={() => window.setTimeout(() => setShowSuggestions(false), 160)}
        placeholder="Search by bank or credit union name"
        className={inputClassName}
        style={inputStyle}
        aria-describedby={helpId}
      />
      <p id={helpId} className="text-xs" style={{ color: "var(--hamilton-text-tertiary, #8A8073)" }}>
        {help}
      </p>

      {showSuggestions && (suggestions.length > 0 || isSearching || searchError) && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border bg-white shadow-lg"
          style={{ borderColor: "var(--hamilton-border, #E8DFD1)" }}
        >
          {isSearching && (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--hamilton-text-tertiary, #8A8073)" }}>
              Searching...
            </div>
          )}
          {searchError && (
            <div className="px-3 py-2 text-xs" style={{ color: "oklch(0.55 0.22 25)" }}>
              {searchError}
            </div>
          )}
          {!isSearching && !searchError && suggestions.map((result) => (
            <button
              key={result.id}
              type="button"
              onMouseDown={() => selectInstitution(result)}
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stone-50"
              style={{
                borderColor: "var(--hamilton-border, #E8DFD1)",
                color: "var(--hamilton-text-primary, #1A1815)",
              }}
            >
              <span className="block truncate font-semibold">{result.institution_name}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--hamilton-text-secondary, #6B6255)" }}>
                {institutionLocation(result) && <span>{institutionLocation(result)}</span>}
                <span>{result.fee_publication_label}</span>
                <span>{result.published_fee_count} verified fees</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
