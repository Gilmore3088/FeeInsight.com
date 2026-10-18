/**
 * Does an institution offer Zelle? Read from the institution's own stored documents (its fee
 * schedule, disclosures and product pages in agent_source_texts), never from Zelle's participant
 * list: that list was struck on 2026-10-17 because its terms allow only personal, non-commercial
 * use (#1840, DECISIONS.md "No non-commercial data"). Nothing here fetches anything.
 *
 * Deterministic text rules, no model call. Each sentence that names Zelle is read on its own:
 * - offers: the document states the service as the institution's own: a fee or limit line with an
 *   amount, "send money with Zelle", enrolling in Zelle, Zelle in "our" app or online banking, or
 *   the brand notice a participating institution prints ("Zelle and the Zelle related marks are
 *   wholly owned by ... used herein under license").
 *   "Send money with Zelle" counts only beside an own-service cue ("our app", "your account",
 *   enrolling), and no rule but the brand notice counts inside a safety warning ("never",
 *   "only ... people you know", "criminals", "cannot cancel").
 * - does_not_offer: only a plain, unconditional statement that Zelle is not offered. Any condition
 *   or scope ("for business accounts", "until your account is 30 days old", "on weekends", "to
 *   recipients outside the U.S.", "at this time") describes a limit on a service the institution
 *   has, so the sentence is a mention.
 * - mentioned: every other sentence (a scam or safety warning, a list of payment apps, a limit). A
 *   mention alone is never read as offering Zelle.
 *
 * Per institution: any offers sentence and no does_not_offer sentence is "offers"; a
 * does_not_offer sentence and no offers sentence is "does_not_offer"; both, or mentions only, is
 * "unclear". A document that never names Zelle says nothing either way, so an institution with no
 * mention gets no row (a gap is never filled).
 */

/**
 * Version of these rules, recorded on every stored row and on the registry partition. Raising it
 * restarts the pass over every institution, so a rule fix reaches rows already stored.
 * 1: first rules (#1875).
 */
export const BANK_ZELLE_MATCHER_VERSION = 1;

export type ZelleSentenceKind = "offers" | "does_not_offer" | "mentioned";
export type ZelleStatus = "offers" | "does_not_offer" | "unclear";

export interface ZelleSentence {
  kind: ZelleSentenceKind;
  /** The rule that decided the kind; "mention" for a mention. */
  rule: string;
  /** The sentence as the document states it, whitespace collapsed, at most SNIPPET_MAX characters. */
  snippet: string;
}

export const SNIPPET_MAX = 300;
/** Characters read on each side of a Zelle mention when no sentence boundary comes sooner. */
const WINDOW = 220;

const ZELLE = /\bzelle\b/gi;

/** Sentences that say Zelle is not offered. Read before the offering rules. */
const NEGATIVE_RULES: Array<[string, RegExp]> = [
  ["not_offered", /\b(?:do|does|will|can|are|is)\s*(?:not|n['’]t)\s+(?:currently\s+|yet\s+)?(?:offer|offered|support|supported|provide|participate|available|use)\b[^.;]{0,60}\bzelle\b/i],
  ["not_available", /\bzelle\b[^.;]{0,60}\b(?:is|are)\s+not\s+(?:currently\s+|yet\s+)?(?:available|offered|supported)\b/i],
  ["not_participant", /\bnot\s+(?:a\s+)?(?:zelle\s*®?\s+)?(?:participant|participating\s+(?:bank|institution|financial\s+institution|credit\s+union))\b[^.;]{0,40}\bzelle\b|\bzelle\b[^.;]{0,40}\bnot\s+(?:a\s+)?participa/i],
];

/**
 * does_not_offer is strict: only a plain, unconditional "we do not offer Zelle". Any condition or
 * scope (one account type, a waiting period, weekends, recipients abroad, an amount, "at this
 * time") describes a limit on a service the institution has, so the sentence is only a mention.
 */
const NARROW_QUALIFIER = new RegExp(
  [
    String.raw`\b(?:for|on|with|to)\s+(?:business|commercial|corporate|trust|estate|minor|youth|student|teen|joint|ira|health\s+savings)\b`,
    String.raw`\bbusiness\s+(?:accounts?|customers?|members?)\b`,
    String.raw`\b(?:until|unless|after|before|during|while|if|when|once|within|except|outside|temporarily|weekends?|holidays?|international|abroad|exceed|exceeds|over|more\s+than|less\s+than)\b`,
    String.raw`\bat\s+this\s+time\b`,
    String.raw`\b(?:to|for)\s+(?:recipients?|amounts?|accounts?|transfers?|payments?|new)\b`,
    String.raw`\brecipients?\b`,
    String.raw`\$\s?\d`,
    String.raw`\b\d+\s+(?:days?|hours?|business\s+days?)\b`,
  ].join("|"),
  "i",
);

/**
 * A safety warning about Zelle ("never send money with Zelle to someone you don't know") is advice,
 * not a statement that the institution offers it, so it never counts as offers.
 */
const WARNING_CONTEXT = new RegExp(
  [
    String.raw`\b(?:never|only|criminals?|pose\s+as|posing\s+as|impersonat\w*|trust|trusted|beware|warning|caution|careful)\b`,
    String.raw`\b(?:cannot|can['’]?t|can\s+not)\s+(?:be\s+)?(?:cancel|cancell?ed|reverse|reversed|undo|recall)\w*`,
    String.raw`\bpeople\s+you\s+know\b`,
    String.raw`\bsomeone\s+you\s+(?:don['’]?t|do\s+not)\s+know\b`,
  ].join("|"),
  "i",
);

/** send_money_with counts only beside a cue that the service is the institution's own. */
const OWN_SERVICE_CUE = /\b(?:our|your)\s+(?:\w+\s+){0,2}(?:app|application|account|accounts|online\s+banking|mobile\s+banking|digital\s+banking|internet\s+banking|banking)\b|\b(?:enroll|enrol|enrolled|enrolling)\b/i;

/** Sentences that state Zelle as the institution's own service. */
const POSITIVE_RULES: Array<[string, RegExp]> = [
  ["brand_notice", /\bzelle\b[^.]{0,120}\b(?:wholly\s+owned\s+by\s+early\s+warning|used\s+(?:herein\s+)?under\s+licen[cs]e)/i],
  ["send_money_with", /\b(?:send|receive|request|split)\b[^.;]{0,40}\b(?:with|using|through|via)\s+zelle\b/i],
  ["enroll", /\b(?:enroll|enrol|enrolled|enrolling|enrollment|register|registered|sign\s+up|activate)\b[^.;]{0,40}\bzelle\b|\bzelle\b[^.;]{0,20}\b(?:enrollment|registration)\b/i],
  ["in_our_banking", /\bzelle\b[^.;]{0,80}\b(?:in|within|through|from|on)\s+(?:our|the\s+\w+\s+(?:bank|credit\s+union))\s+(?:\w+\s+){0,3}(?:app|application|online\s+banking|mobile\s+banking|digital\s+banking|internet\s+banking|website)\b/i],
  ["offer_statement", /\b(?:we|bank|credit\s+union)\s+(?:now\s+)?(?:offer|offers|provide|provides|support|supports)\s+zelle\b|\bzelle\b[^.;]{0,30}\bis\s+(?:now\s+)?(?:available|offered)\s+(?:to|in|through|for)\b/i],
  ["fee_or_limit_line", /\bzelle\b[^.;\n]{0,80}(?:\$\s?\d|\bno\s+(?:fee|charge)\b|\bfree\b|\b(?:daily|monthly|per[-\s]transaction)\s+limit\b)/i],
];

/** Context that makes a sentence about Zelle the brand, not the institution's service. */
const OTHER_CONTEXT = /\b(?:scam|scams|scammer|fraudster|imposter|impostor|venmo|cash\s*app|paypal|apple\s+cash)\b/i;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The sentence around one mention: back to the previous boundary and on to the next, within WINDOW. */
function sentenceAt(text: string, index: number, length: number): string {
  const startLimit = Math.max(0, index - WINDOW);
  const endLimit = Math.min(text.length, index + length + WINDOW);
  let start = startLimit;
  for (let i = index - 1; i >= startLimit; i -= 1) {
    const ch = text[i];
    if (ch === "\n" && text[i - 1] === "\n") { start = i + 1; break; }
    if ((ch === "." || ch === "!" || ch === "?") && /\s/.test(text[i + 1] ?? " ") && !/\d/.test(text[i - 1] ?? "")) { start = i + 1; break; }
  }
  let end = endLimit;
  for (let i = index + length; i < endLimit; i += 1) {
    const ch = text[i];
    if (ch === "\n" && text[i + 1] === "\n") { end = i; break; }
    if ((ch === "." || ch === "!" || ch === "?") && /\s/.test(text[i + 1] ?? " ") && !/\d/.test(text[i + 1] ?? "")) { end = i + 1; break; }
  }
  return text.slice(start, end).trim();
}

function clip(sentence: string): string {
  if (sentence.length <= SNIPPET_MAX) return sentence;
  const at = sentence.search(/\bzelle\b/i);
  const from = Math.max(0, Math.min(at - Math.floor(SNIPPET_MAX / 3), sentence.length - SNIPPET_MAX));
  return sentence.slice(from, from + SNIPPET_MAX).trim();
}

/** Reads one sentence that names Zelle. */
export function classifyZelleSentence(sentence: string): ZelleSentence {
  const snippet = clip(collapse(sentence));
  for (const [rule, pattern] of NEGATIVE_RULES) {
    if (pattern.test(sentence)) {
      if (NARROW_QUALIFIER.test(sentence)) return { kind: "mentioned", rule: `${rule}_narrowed`, snippet };
      return { kind: "does_not_offer", rule, snippet };
    }
  }
  const otherContext = OTHER_CONTEXT.test(sentence) || WARNING_CONTEXT.test(sentence);
  for (const [rule, pattern] of POSITIVE_RULES) {
    if (!pattern.test(sentence)) continue;
    // Only the brand notice holds in any company; every other rule fails in a scam or safety
    // warning or a list of other payment apps in the same sentence.
    if (otherContext && rule !== "brand_notice") continue;
    if (rule === "send_money_with" && !OWN_SERVICE_CUE.test(sentence)) continue;
    return { kind: "offers", rule, snippet };
  }
  return { kind: "mentioned", rule: "mention", snippet };
}

/** Every sentence in a document that names Zelle, in document order, one per sentence. */
export function zelleSentences(text: string): ZelleSentence[] {
  const out: ZelleSentence[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(ZELLE)) {
    const sentence = sentenceAt(text, match.index ?? 0, match[0].length);
    const key = collapse(sentence).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(classifyZelleSentence(sentence));
  }
  return out;
}

export interface ZelleDocument {
  agentSourceTextId: number;
  sourceDocumentId: number;
  /** The institution's own document URL. */
  url: string;
  text: string;
}

export interface ZelleFinding {
  status: ZelleStatus;
  /** The rule behind the evidence sentence; "conflict" when documents disagree, "mention" for mentions only. */
  rule: string;
  /** The sentence shown as evidence, from the document at `evidence.url`. */
  snippet: string;
  evidence: { agentSourceTextId: number; sourceDocumentId: number; url: string };
  documentsMentioning: number;
  offersSentences: number;
  doesNotOfferSentences: number;
  mentionSentences: number;
}

/** One institution's finding from its current documents, or null when none names Zelle. */
export function decideZelle(documents: ZelleDocument[]): ZelleFinding | null {
  type Hit = ZelleSentence & { doc: ZelleDocument };
  const hits: Hit[] = [];
  let documentsMentioning = 0;
  for (const doc of documents) {
    const sentences = zelleSentences(doc.text);
    if (sentences.length === 0) continue;
    documentsMentioning += 1;
    for (const s of sentences) hits.push({ ...s, doc });
  }
  if (hits.length === 0) return null;
  const offers = hits.filter((h) => h.kind === "offers");
  const not = hits.filter((h) => h.kind === "does_not_offer");
  const mentions = hits.filter((h) => h.kind === "mentioned");
  const counts = {
    documentsMentioning,
    offersSentences: offers.length,
    doesNotOfferSentences: not.length,
    mentionSentences: mentions.length,
  };
  const evidence = (h: Hit) => ({ agentSourceTextId: h.doc.agentSourceTextId, sourceDocumentId: h.doc.sourceDocumentId, url: h.doc.url });
  if (offers.length > 0 && not.length === 0) return { status: "offers", rule: offers[0].rule, snippet: offers[0].snippet, evidence: evidence(offers[0]), ...counts };
  if (not.length > 0 && offers.length === 0) return { status: "does_not_offer", rule: not[0].rule, snippet: not[0].snippet, evidence: evidence(not[0]), ...counts };
  const first = not[0] ?? mentions[0];
  return { status: "unclear", rule: not.length > 0 ? "conflict" : "mention", snippet: first.snippet, evidence: evidence(first), ...counts };
}
