/** Availability is about a read, never a judgment that a fee is wrong. */
export type PublicationEvidenceCheck =
  | "live_prior"
  | "document_text"
  | "listed_fee_lines"
  | "exact_duplicate"
  | "other_bank_document"
  | "unconfirmed_document_host"
  | "business_schedule"
  | "document_owner"
  | "page_copy_live"
  | "page_copy_document"
  | "page_copy_text";

export type PublicationEvidence<T> =
  | { state: "available"; value: T }
  | { state: "unavailable"; check: PublicationEvidenceCheck };

/** Do not serialize arbitrary database errors, SQL, source content or stacks. */
export async function readPublicationEvidence<T>(
  check: PublicationEvidenceCheck,
  read: () => Promise<T>,
): Promise<PublicationEvidence<T>> {
  try {
    return { state: "available", value: await read() };
  } catch {
    return { state: "unavailable", check };
  }
}

export class PublicationEvidenceUnavailable extends Error {
  constructor(readonly check: PublicationEvidenceCheck) {
    super(`Publication evidence unavailable: ${check}`);
    this.name = "PublicationEvidenceUnavailable";
  }
}

/** Shared historical callers retain their existing fallback; publish opts into required reads. */
export function publicationEvidenceValue<T>(read: PublicationEvidence<T>, fallback: T, required = false): T {
  if (read.state === "available") return read.value;
  if (required) throw new PublicationEvidenceUnavailable(read.check);
  return fallback;
}

export interface PublishEvidenceCheck {
  protocol: "publish.evidence.v1";
  /** A read failed even if another independent rule already proved refusal. */
  readState: "available" | "unavailable";
  unavailableChecks: PublicationEvidenceCheck[];
  deferred: number;
  unavailableByCheck: Partial<Record<PublicationEvidenceCheck, number>>;
  samples: Array<{ fee_verified_id: number; checks: PublicationEvidenceCheck[]; deferred: boolean }>;
}
