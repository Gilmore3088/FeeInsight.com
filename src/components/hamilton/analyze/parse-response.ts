export interface ParsedResponse {
  hamiltonView: string;
  whatThisMeans: string;
  whyItMatters: string[];
  evidence: Array<{ label: string; value: string; note?: string }>;
  exploreFurther: string[];
}

/**
 * Parse Hamilton's structured analyze response into typed sections.
 * Expects ## headings: Hamilton's View, What This Means, Why It Matters, Evidence, Explore Further.
 * Falls back to raw content in hamiltonView if sections are not found.
 */
export function parseAnalyzeResponse(rawContent: string): ParsedResponse {
  const content = humanizeAnswerText(rawContent);
  const sections = content.split(/^##\s+/m);

  function getSection(name: string): string {
    const match = sections.find((s) => s.toLowerCase().startsWith(name.toLowerCase()));
    if (!match) return "";
    return match.replace(/^[^\n]+\n/, "").trim();
  }

  function parseBullets(text: string): string[] {
    return text
      .split("\n")
      .map((l) => l.replace(/^[-*\s]+/, "").trim())
      .filter((l) => /\w/.test(l));
  }

  const hamiltonViewRaw = getSection("hamilton");
  const whatThisMeansRaw = getSection("what this means");
  const whyItMattersRaw = getSection("why it matters");
  const evidenceRaw = getSection("evidence");
  const exploreFurtherRaw = getSection("explore further");

  if (!hamiltonViewRaw && !whatThisMeansRaw && !whyItMattersRaw) {
    return { hamiltonView: content.trim(), whatThisMeans: "", whyItMatters: [], evidence: [], exploreFurther: [] };
  }

  return {
    hamiltonView: hamiltonViewRaw,
    whatThisMeans: whatThisMeansRaw,
    whyItMatters: parseBullets(whyItMattersRaw),
    evidence: parseEvidenceMetrics(evidenceRaw),
    exploreFurther: parseFollowUps(exploreFurtherRaw),
  };
}

// Asset-size tiers as a customer reads them; raw keys (community_mid,
// COMMUNITY_MID) are database vocabulary and never reach the page.
const TIER_WORDS: Record<string, string> = {
  community_small: "under $300M",
  community_mid: "$300M to $1B",
  community_large: "$1B to $10B",
  large_regional: "$50B to $250B",
  super_regional: "over $250B",
};

/** Swap raw tier keys for plain words and drop code backticks from Hamilton's text. */
export function humanizeAnswerText(text: string): string {
  return text
    .replace(
      /\b(community_small|community_mid|community_large|large_regional|super_regional)\b(\s+(?:peers?|banks?|institutions?|credit unions?|tier|group|segment|cohort)\b)?/gi,
      (_m, key: string, noun: string | undefined) => `${TIER_WORDS[key.toLowerCase()]}${noun ?? " peers"}`,
    )
    .replace(/`/g, "");
}

/**
 * Follow-up questions from the Explore Further section. Only real questions
 * survive: quotes, numbering and stray ** are stripped, and lines that are not
 * questions ("Operational flags: …" notes) are dropped. At most four.
 */
export function parseFollowUps(text: string): string[] {
  return text
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
        .replace(/^["\u201c\u2018']+|["\u201d\u2019']+$/g, "")
        .trim(),
    )
    .filter((l) => /\w/.test(l) && l.endsWith("?") && !/^[^?]{0,40}:\s/.test(l))
    .slice(0, 4);
}


type EvidenceMetric = { label: string; value: string; note?: string };

/**
 * Parse the Evidence section into label/value rows.
 *
 * Accepts "**Label:** value", "**Label**: value" and "Label: value" bullets,
 * at any indent. The value is kept whole: dates (2026-02-17), ranges and
 * hyphenated words must never be split into a separate note. A label with no
 * value ("**Data problems:**") becomes a group heading row (value ""), and a
 * line that is not a label/value pair continues the row above it.
 */
export function parseEvidenceMetrics(text: string): EvidenceMetric[] {
  const metrics: EvidenceMetric[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, "").trim();
    if (!/\w/.test(line)) continue;

    const pair = splitLabel(line);
    if (pair) {
      metrics.push(pair);
      continue;
    }
    const last = metrics[metrics.length - 1];
    if (last && last.value) {
      last.value = `${last.value} ${cleanValue(line)}`;
    } else {
      metrics.push({ label: "", value: cleanValue(line) });
    }
  }
  return metrics;
}

function splitLabel(line: string): EvidenceMetric | null {
  const bold = line.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  if (bold) {
    const label = bold[1].replace(/:\s*$/, "").trim();
    const rest = bold[2].replace(/^:\s*/, "");
    // "**Label**" must be followed by a colon (inside or outside the bold) to
    // count as a label; otherwise it is emphasis at the start of a sentence.
    if (/:\s*$/.test(bold[1]) || /^:/.test(bold[2])) {
      return { label, value: cleanValue(rest) };
    }
    return null;
  }
  const plain = line.match(/^([^:*]{1,60}?):\s+(.+)$/);
  if (plain && !/\d$/.test(plain[1])) {
    return { label: plain[1].trim(), value: cleanValue(plain[2]) };
  }
  return null;
}

/** Drop unpaired bold markers left behind by the model ("** $15" or a lone "**"). */
function cleanValue(value: string): string {
  const trimmed = value.trim();
  const markers = trimmed.match(/\*\*/g)?.length ?? 0;
  return (markers % 2 === 1 ? trimmed.replace(/\*\*/g, "") : trimmed).trim();
}

const ABBREVIATIONS = /(?:\b(?:vs|e\.g|i\.e|etc|Inc|Co|Corp|No|St|Mr|Ms|Dr|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)|\b[A-Z](?:\.[A-Z])*)\.$/;

/** Split prose into sentences without breaking on "$1.75", "U.S." or "vs.". */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = "";
  for (const part of text.split(/(?<=[.!?]["”)]?)\s+(?=["“(]?[A-Z0-9$])/)) {
    current = current ? `${current} ${part}` : part;
    if (!ABBREVIATIONS.test(current)) {
      sentences.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) sentences.push(current.trim());
  return sentences.filter((s) => /\w/.test(s));
}

/**
 * Shape Hamilton's view for reading: the first sentence becomes the lead and
 * the rest falls into short paragraphs of at most three sentences. Paragraph
 * breaks the model wrote itself are kept.
 */
export function shapeHamiltonView(content: string): { lead: string; paragraphs: string[] } {
  const blocks = content
    .split(/\n+/)
    .map((b) => b.trim())
    .filter((b) => /\w/.test(b));
  if (blocks.length === 0) return { lead: "", paragraphs: [] };

  const [first, ...restOfFirst] = splitSentences(blocks[0]);
  const paragraphs: string[] = [];
  const pushChunks = (sentences: string[]) => {
    for (let i = 0; i < sentences.length; i += 3) {
      paragraphs.push(sentences.slice(i, i + 3).join(" "));
    }
  };
  pushChunks(restOfFirst);
  for (const block of blocks.slice(1)) pushChunks(splitSentences(block));
  return { lead: first ?? "", paragraphs };
}
