import type { PlaybookFormat } from "./format";
import type { AttemptOutcome } from "./outcomes";
import type { Playbook } from "./playbook";

/**
 * Plain-English notes from an institution's playbook, for the admin institution page.
 * The playbook is what later runs act on; these notes are the same facts written for a
 * person: what kind of document the fee schedule is, which reader works, what failed
 * and will not be retried, and what has to happen next. Pure; no database access.
 */

export interface PlaybookNoteInput {
  playbook: Playbook;
  /** `institution_source_profiles.source_kind` / `read_strategy`: older, coarser memory. */
  sourceKind: string | null;
  readStrategy: string | null;
  lockedByCorrection: boolean;
  rejectedUrlCount: number;
}

export interface PlaybookNotes {
  /** "Scanned PDF", "Web page", ... or null when nothing has been learned yet. */
  formatLabel: string | null;
  /** One sentence per fact, most useful first. */
  lines: string[];
  /** What has to happen for this institution to move forward, or null when nothing. */
  nextStep: string | null;
}

export const FORMAT_LABELS: Readonly<Record<PlaybookFormat, string>> = {
  pdf_text: "PDF with readable text",
  pdf_scanned: "Scanned PDF (image only)",
  html_static: "Web page",
  html_js: "Web page that needs a browser to load",
  docx: "Word document",
  text: "Plain text",
  other: "Unrecognized file type",
};

const STRATEGY_LABELS: Readonly<Record<string, string>> = {
  "fetch.http": "a plain download",
  "read.pdf_layout": "the PDF table reader",
  "read.pdf_text": "the PDF text reader",
  "read.html_dom": "the web page reader",
  "read.html_text": "the web page reader",
  "read.plain_text": "the plain text reader",
  "extract.rules": "the fee rules",
};

const OUTCOME_LABELS: Partial<Record<AttemptOutcome, string>> = {
  scanned_pdf: "the PDF is a scan with no text",
  js_required: "the page only loads in a browser",
  empty: "the document had no text",
  parse_error: "the file could not be parsed",
  unsupported_format: "there is no reader for this file type yet",
  wrong_document: "the page was not a fee schedule",
  no_candidates: "no fees were found in the text",
  too_large: "the file was too large",
  rejected: "the row was rejected",
};

function strategyLabel(strategy: string): string {
  return STRATEGY_LABELS[strategy] ?? strategy;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The learned format, falling back to the older profile columns when it is missing. */
export function effectiveFormat(input: Pick<PlaybookNoteInput, "playbook" | "sourceKind" | "readStrategy">): PlaybookFormat | null {
  if (input.playbook.format) return input.playbook.format;
  if (input.sourceKind === "scanned_pdf" || input.readStrategy === "ocr") return "pdf_scanned";
  if (input.readStrategy === "browser_render") return "html_js";
  if (input.sourceKind === "pdf" || input.readStrategy === "pdf_text") return "pdf_text";
  if (input.sourceKind === "html" || input.readStrategy === "html_dom") return "html_static";
  return null;
}

function nextStepFor(format: PlaybookFormat | null, input: PlaybookNoteInput): string | null {
  if (format === "pdf_scanned") {
    return "Needs OCR. It is not retried until an OCR reader exists or the bank posts a new file.";
  }
  if (format === "html_js") {
    return "Needs a browser-rendering reader. It is not retried until one exists or the page changes.";
  }
  if (format === "docx") {
    return "Needs a Word reader. It is not retried until one exists or the file changes.";
  }
  const extract = Object.values(input.playbook.strategyStats).filter((stats) => stats.stage === "extract");
  if (extract.length > 0 && extract.every((stats) => stats.successes === 0)) {
    return "The text was read but no fees were found. It is re-checked when the document changes or the fee rules improve.";
  }
  if (format === null && input.rejectedUrlCount > 0) {
    return "Still looking for the right fee schedule page.";
  }
  return null;
}

export function describePlaybook(input: PlaybookNoteInput): PlaybookNotes {
  const { playbook } = input;
  const format = effectiveFormat(input);
  const lines: string[] = [];

  if (format) lines.push(`The fee schedule is a ${FORMAT_LABELS[format].toLowerCase()}.`);

  const readWorks = playbook.bestStrategy.read;
  if (readWorks) lines.push(`Reading works with ${strategyLabel(readWorks)}.`);

  if (playbook.expectedFeeCount != null && playbook.expectedFeeCount > 0) {
    lines.push(`A good read finds about ${plural(playbook.expectedFeeCount, "fee", "fees")}.`);
  }

  const failures = new Map<AttemptOutcome, number>();
  for (const entry of playbook.doNotRetry) failures.set(entry.outcome, (failures.get(entry.outcome) ?? 0) + 1);
  for (const [outcome, count] of failures) {
    const reason = OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, " ");
    lines.push(`Not retried: ${plural(count, "document", "documents")} where ${reason}.`);
  }

  if (input.rejectedUrlCount > 0) {
    lines.push(`${plural(input.rejectedUrlCount, "page was", "pages were")} ruled out as not the fee schedule and will not be proposed again.`);
  }
  if (input.lockedByCorrection) lines.push("A person corrected the source, so the pipeline will not change it.");
  if (playbook.costToDateMicrousd > 0) {
    lines.push(`Paid processing so far: $${(playbook.costToDateMicrousd / 1_000_000).toFixed(2)}.`);
  }
  if (lines.length === 0) lines.push("Nothing learned yet: no document for this institution has been read.");

  return {
    formatLabel: format ? FORMAT_LABELS[format] : null,
    lines,
    nextStep: nextStepFor(format, input),
  };
}
