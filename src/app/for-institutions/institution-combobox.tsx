"use client";

import { useEffect, useId, useState } from "react";

export interface PickedInstitution {
  id: number;
  name: string;
  stateCode: string | null;
}

interface Suggestion {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

/**
 * The institution field on the report request form: free text, with matching institutions
 * suggested as the requester types (the public /api/institutions search). Picking one records
 * its id, so the request reaches James, and the pipeline, already tied to that institution.
 * Typing after a pick clears it; an unpicked name is still sent and matched by name.
 */
export function InstitutionCombobox({
  id,
  name,
  defaultValue,
  readOnly,
  className,
  onPick,
  invalid = false,
  describedBy,
  onFieldBlur,
}: {
  id: string;
  name: string;
  defaultValue: string;
  readOnly: boolean;
  className: string;
  onPick: (picked: PickedInstitution | null) => void;
  /** The form found a problem with this field: sets aria-invalid. */
  invalid?: boolean;
  /** Ids of the helper or error text that describes the field. */
  describedBy?: string;
  /** Called with the typed value when the field loses focus (validate on blur). */
  onFieldBlur?: (value: string) => void;
}) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pickedName, setPickedName] = useState<string | null>(null);

  useEffect(() => {
    const query = value.trim();
    if (readOnly || query.length < MIN_QUERY || query === pickedName) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/institutions?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) return;
        const rows = (await response.json()) as Suggestion[];
        setSuggestions(Array.isArray(rows) ? rows.slice(0, 8) : []);
        setActive(-1);
        setOpen(true);
      } catch {
        // Suggestions are a convenience; the typed name is still sent.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, readOnly, pickedName]);

  function choose(suggestion: Suggestion) {
    setPickedName(suggestion.institution_name);
    setValue(suggestion.institution_name);
    setOpen(false);
    setSuggestions([]);
    onPick({ id: suggestion.id, name: suggestion.institution_name, stateCode: suggestion.state_code });
  }

  const query = value.trim();
  const searching = !readOnly && query.length >= MIN_QUERY && query !== pickedName;
  const expanded = open && searching && suggestions.length > 0;

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type="text"
        required
        readOnly={readOnly}
        aria-readonly={readOnly}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (pickedName !== null) {
            setPickedName(null);
            onPick(null);
          }
        }}
        onKeyDown={(event) => {
          if (!expanded) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            choose(suggestions[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onBlur={(event) => {
          onFieldBlur?.(event.target.value);
          setTimeout(() => setOpen(false), 120);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
        placeholder="Start typing your bank or credit union"
        className={className}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-md border border-[#E0D7C9] bg-white py-1 text-sm shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(suggestion);
              }}
              className={`cursor-pointer px-3 py-2 ${index === active ? "bg-[#FBF3EF]" : "hover:bg-[#FAF7F2]"}`}
            >
              <span className="font-medium text-[#1A1815]">{suggestion.institution_name}</span>
              {(suggestion.city || suggestion.state_code) && (
                <span className="ml-1 text-[12px] text-[#6B6255]">
                  {[suggestion.city, suggestion.state_code].filter(Boolean).join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
