import type { UIMessage } from "ai";

export type HamiltonAudience = "public" | "pro" | "admin";

export const HAMILTON_EVIDENCE_POLICIES = [
  "verified-only",
  "provisional-first",
  "source-diligence",
] as const;

export type HamiltonEvidencePolicy = (typeof HAMILTON_EVIDENCE_POLICIES)[number];

export interface HamiltonRequestContract {
  messages: UIMessage[];
  audience: HamiltonAudience;
  institutionId: number | null;
  intent: string;
  evidencePolicy: HamiltonEvidencePolicy;
  mode?: string;
  analysisFocus?: string;
  gateCitations: boolean;
  conversationId?: string;
  workspaceContext?: Record<string, unknown>;
}

export interface HamiltonRequestContractOptions {
  audience: HamiltonAudience;
  defaultIntent?: string;
  allowConversationId?: boolean;
  allowGateCitations?: boolean;
}

export interface HamiltonRequestContractError {
  ok: false;
  status: number;
  error: string;
}

export interface HamiltonRequestContractSuccess {
  ok: true;
  contract: HamiltonRequestContract;
}

export type HamiltonRequestContractResult =
  | HamiltonRequestContractSuccess
  | HamiltonRequestContractError;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readOptionalString(value: unknown, maxLength = 80): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function parseInstitutionId(value: unknown): HamiltonRequestContractError | { ok: true; value: number | null } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }

  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, status: 400, error: "Invalid institutionId" };
  }

  return { ok: true, value: parsed };
}

function parseEvidencePolicy(value: unknown): HamiltonEvidencePolicy | null {
  if (typeof value !== "string") return "provisional-first";
  const normalized = value.trim();
  if ((HAMILTON_EVIDENCE_POLICIES as readonly string[]).includes(normalized)) {
    return normalized as HamiltonEvidencePolicy;
  }
  return null;
}

function parseConversationId(value: unknown): HamiltonRequestContractError | { ok: true; value: string | undefined } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    return { ok: false, status: 400, error: "Invalid conversation_id format" };
  }
  return { ok: true, value };
}

export function parseHamiltonRequestContract(
  body: unknown,
  options: HamiltonRequestContractOptions,
): HamiltonRequestContractResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid request body" };
  }

  const record = body as Record<string, unknown>;
  const messages = record.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, error: "Messages required" };
  }

  const institutionId = parseInstitutionId(record.institutionId);
  if (!institutionId.ok) return institutionId;

  const evidencePolicy = parseEvidencePolicy(record.evidencePolicy);
  if (!evidencePolicy) {
    return { ok: false, status: 400, error: "Invalid evidencePolicy" };
  }

  const conversationId = options.allowConversationId
    ? parseConversationId(record.conversation_id)
    : { ok: true as const, value: undefined };
  if (!conversationId.ok) return conversationId;

  const workspaceContext =
    record.workspaceContext && typeof record.workspaceContext === "object" && !Array.isArray(record.workspaceContext)
      ? (record.workspaceContext as Record<string, unknown>)
      : undefined;

  return {
    ok: true,
    contract: {
      messages: messages as UIMessage[],
      audience: options.audience,
      institutionId: institutionId.value,
      intent: readOptionalString(record.intent) ?? options.defaultIntent ?? "analyze",
      evidencePolicy,
      mode: readOptionalString(record.mode),
      analysisFocus: readOptionalString(record.analysisFocus),
      gateCitations: options.allowGateCitations === true && record.gate_citations === true,
      conversationId: conversationId.value,
      workspaceContext,
    },
  };
}

export function buildHamiltonRequestContractPrompt(
  contract: Pick<HamiltonRequestContract, "audience" | "intent" | "evidencePolicy" | "institutionId">,
): string {
  const audienceRules: Record<HamiltonAudience, string> = {
    public:
      "Consumer-safe: explain evidence plainly, avoid internal operations, and route gaps to source submission or Pro validation paths.",
    pro:
      "Self-serve consulting: use the selected institution as workspace context and produce decision-ready analysis only when evidence supports it. Never narrate internal data collection or pipeline problems (duplicate rows, stale or missing sources, provisional rows, unit or tier mismatches); when evidence is limited, say so in one short sentence about confidence and leave the data out.",
    admin:
      "Operator/internal: expose queue, source, provider, and validation implications when relevant, while preserving evidence caveats.",
  };

  return `\n\nHAMILTON REQUEST CONTRACT:
- Audience: ${contract.audience}
- Intent: ${contract.intent}
- Evidence policy: ${contract.evidencePolicy}
- Selected institution ID: ${contract.institutionId ?? "none"}
- Audience rule: ${audienceRules[contract.audience]}

Evidence policy rules:
- verified-only: use approved/published fee rows for benchmark or score conclusions.
- provisional-first: provisional evidence may support directional exploration only when labeled by evidence tier and confidence.
- source-diligence: prioritize what source evidence is missing, queued, failed, or needs review before producing recommendations.
- Empty or thin evidence must produce an insufficient-evidence diligence path, not generic analysis or unsupported fee claims.\n`;
}
