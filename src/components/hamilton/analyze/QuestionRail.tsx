"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { LocalDate } from "@/components/hamilton/common/LocalDate";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import "./ask-dashboard.css";

export interface RailQuestion {
  id: string;
  title: string;
  updated_at: string;
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/** Pins live in this browser only: no saved-answer pin is stored on the server. */
function pinKey(userId: number): string {
  return `hamilton-ask-pins:${userId}`;
}

const PIN_EVENT = "hamilton-ask-pins";

/** The stored pins as their raw text, so the snapshot compares by value. */
function readPinsRaw(userId: number): string {
  try {
    return window.localStorage.getItem(pinKey(userId)) ?? "[]";
  } catch {
    return "[]";
  }
}

export function parsePins(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

function writePins(userId: number, ids: string[]): void {
  try {
    window.localStorage.setItem(pinKey(userId), JSON.stringify(ids));
  } catch {
    // Pins are a convenience; the list works without them.
  }
  window.dispatchEvent(new Event(PIN_EVENT));
}

function subscribePins(onChange: () => void): () => void {
  window.addEventListener(PIN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PIN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The reader's saved questions (hamilton_saved_analyses, newest first), searchable, with the ones
 * they pin on this device first. Each opens its saved answer; the one on screen is marked.
 */
export function QuestionRail({
  userId,
  questions,
  currentId,
  institutionId,
}: {
  userId: number;
  questions: RailQuestion[];
  currentId: string | null;
  institutionId: string | null;
}) {
  const id = useId();
  const [term, setTerm] = useState("");
  // The server and the first render have no pins; the browser's stored pins follow.
  const pinsRaw = useSyncExternalStore(subscribePins, () => readPinsRaw(userId), () => "[]");
  const pins = useMemo(() => parsePins(pinsRaw), [pinsRaw]);
  const togglePin = (qid: string) => {
    writePins(userId, pins.includes(qid) ? pins.filter((p) => p !== qid) : [qid, ...pins].slice(0, 20));
  };
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? questions.filter((q) => q.title.toLowerCase().includes(t)) : questions;
  }, [questions, term]);
  const pinned = shown.filter((q) => pins.includes(q.id));
  const recent = shown.filter((q) => !pins.includes(q.id));

  const row = (q: RailQuestion) => {
    const isPinned = pins.includes(q.id);
    return (
      <li key={q.id} className="ha-q">
        <a
          href={hrefWithInstitutionContext(`/pro/analyze?analysis=${encodeURIComponent(q.id)}`, institutionId)}
          aria-current={q.id === currentId ? "page" : undefined}
        >
          {q.title}
          <LocalDate iso={q.updated_at} options={SHORT_DATE} className="ha-q-date" />
        </a>
        <button
          type="button"
          className="ha-pin"
          aria-pressed={isPinned}
          aria-label={`${isPinned ? "Unpin" : "Pin"}: ${q.title}`}
          title={isPinned ? "Unpin" : "Pin to the top on this device"}
          onClick={() => togglePin(q.id)}
        >
          <span aria-hidden="true">{isPinned ? "★" : "☆"}</span>
        </button>
      </li>
    );
  };

  return (
    <nav className="ha-rail" aria-label="Your questions">
      {/* A search field only once there is something to search; it filters, it never asks. */}
      {questions.length > 0 ? (
        <>
          <label htmlFor={`${id}-search`} className="hd-label" style={{ margin: "0 4px" }}>Search your questions</label>
          <input
            id={`${id}-search`}
            type="search"
            className="ha-rail-search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Fee, bank or word"
          />
        </>
      ) : (
        <p className="hd-label" style={{ margin: "0 4px" }}>Your questions</p>
      )}
      {pinned.length > 0 ? (
        <>
          <p className="ha-rail-head hd-label" id={`${id}-pinned`}>Pinned</p>
          <ul aria-labelledby={`${id}-pinned`}>{pinned.map(row)}</ul>
        </>
      ) : null}
      {recent.length > 0 ? (
        <>
          <p className="ha-rail-head hd-label" id={`${id}-recent`}>Recent</p>
          <ul aria-labelledby={`${id}-recent`}>{recent.map(row)}</ul>
        </>
      ) : null}
      {questions.length === 0 ? (
        <p className="hd-card-note" style={{ margin: 4 }}>Questions you ask are saved here.</p>
      ) : shown.length === 0 ? (
        <p className="hd-card-note" style={{ margin: 4 }}>No questions match.</p>
      ) : null}
    </nav>
  );
}
