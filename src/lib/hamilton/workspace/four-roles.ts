/**
 * The four-roles eval: checks one Hamilton answer against the roles James set
 * (2026-10-06). Each check is mechanical, so a failing answer names exactly what broke.
 *
 * - Inquisitive Economist: at least one driver with a figure and a dated source; when the
 *   answer rests on market data alone, it asks for the one missing figure.
 * - Rigorous Consultant: every claim has a number, a named and dated source, and the peer
 *   count for a market figure; the evidence level is set; no recommendation.
 * - Artistic Data Engineer: one exhibit with a title, a source and data to draw.
 * - Technical yet Clear Writer: the headline leads with its number; every sentence is under
 *   25 words; no pipeline terms; units formatted.
 */

import type { Exhibit, Fact, HamiltonAnswer, HamiltonRole } from "./types";

export const MAX_SENTENCE_WORDS = 25;
/** Storyline lines sit in cards and table rows on the Pro page: one short sentence each. */
export const MAX_STORY_LINE_WORDS = 20;
/** The governing thought is the one line the reader sees first. */
export const MAX_GOVERNING_WORDS = 16;
/** Exhibit titles sit on one line above the chart. */
export const MAX_TITLE_WORDS = 10;
/** Exhibit notes sit under the chart. */
export const MAX_NOTE_WORDS = 16;

export interface RoleCheck {
  role: HamiltonRole;
  pass: boolean;
  failures: string[];
}

export interface FourRolesResult {
  pass: boolean;
  roles: RoleCheck[];
}

/** Words that tell the reader what to do with a fee; Hamilton gives an opinion only on request. */
export const RECOMMENDATION =
  /\b(should|ought to|recommend(s|ed|ation)?|we suggest|you need to|consider (raising|lowering|cutting|dropping|eliminating)|(raise|lower|cut|drop|increase|reduce) (your|the|this) (fee|price))\b/i;

/** Internal names a bank reader should never see: agent names, and any snake_case table or column name. */
export const PIPELINE_TERMS = /\b(Knox|Darwin|Rosetta|Magellan|Atlas|pipeline|agent run)\b|\b[a-z0-9]+_[a-z0-9_]+\b/i;

/** "$209400", "$2,640,000" (a total over $1 million belongs in words), "2.38%". */
const UNFORMATTED_UNITS = [
  { re: /\$\d{4,}(?![\d,])/, why: "dollar amount without thousands separators" },
  { re: /\$\d{1,3}(,\d{3}){2,}(\.\d+)?(?!\s*(thousand|million|billion))/, why: "total over $1 million not written as millions" },
  { re: /\d+\.\d{2,}%/, why: "percent with more than one decimal" },
  { re: /(?<![$\d.,])0\.\d+(?![\d%])/, why: "share written as a decimal fraction" },
];

function words(sentence: string): number {
  // A quotation is the source's words, not Hamilton's, so it does not count.
  // A lone "/" or "&" (as in "NSF / returned item") is punctuation, not a word.
  const own = sentence.replace(/"[^"]*"/g, "").trim();
  return own ? own.split(/\s+/).filter((w) => /[\p{L}\p{N}$%]/u.test(w)).length : 0;
}

/** Split prose into sentences, keeping a quoted passage inside its sentence. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    current += c;
    if (c === '"') inQuote = !inQuote;
    const ends = /[.!?]/.test(c) || (c === '"' && /[.!?]/.test(text[i - 1] ?? ""));
    if (!inQuote && ends && (i === text.length - 1 || /\s/.test(text[i + 1]))) {
      // "$35.50" and "e.g." are not sentence ends: the next character is not a space or is lowercase.
      const next = text.slice(i + 1).trimStart()[0];
      if (next === undefined || /[A-Z"$0-9]/.test(next)) {
        out.push(current.trim());
        current = "";
      }
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The storyline's sourced lines that state a figure: lenses and exhibit takeaways. */
function storyFacts(answer: HamiltonAnswer): Fact[] {
  const story = answer.storyline;
  if (!story) return [];
  return [
    ...story.lenses.finance,
    ...story.lenses.market,
    ...story.exhibits.flatMap((e) => (e.takeaway ? [e.takeaway] : [])),
  ];
}

function storyText(answer: HamiltonAnswer): string[] {
  const story = answer.storyline;
  if (!story) return [];
  return [
    story.governingThought,
    ...story.situation.map((f) => f.text),
    ...story.complication.map((f) => f.text),
    ...story.exhibits.flatMap((e) => [e.actionTitle, e.exhibit.title]),
    ...storyFacts(answer).map((f) => f.text),
    ...(story.options ?? []).flatMap((o) => [o.label, ...o.consequences.map((c) => c.text)]),
    ...story.watch.map((f) => f.text),
  ];
}

function allText(answer: HamiltonAnswer): string[] {
  return [answer.headline, ...answer.claims.map((c) => c.text), ...answer.drivers.map((d) => d.text), answer.exhibit?.title ?? "", ...storyText(answer)].filter(Boolean);
}

function dated(fact: Fact): boolean {
  return Boolean(fact.source.label?.trim()) && Boolean(fact.source.asOf);
}

const MARKET_FIGURE = /\bmedian|percentile|middle half|peers?\b|institutions\b/i;

/**
 * A statement of law (cited to the CFR, the U.S. Code or a named regulation) or of who
 * regulates the bank (its registry record). These are sourced statements, not figures: they
 * need a named source but no number, and a threshold in a rule ("$10 billion in assets") is
 * not a market figure. A rule cited to its section is dated by that citation.
 */
const CITED_RULE = /\b\d+ CFR\b|U\.S\.C\.|\bReg(?:ulation)? [A-Z]{1,2}\b|Truth in Savings|\bPub(?:lic)?\.? L(?:aw|\.)|\bFIL-\d|\bCircular \d{4}-\d+|Congressional Review Act/i;
function isRuleOrRegistry(fact: Fact): boolean {
  return CITED_RULE.test(fact.source.label ?? "") || fact.source.table === "institution_sources";
}

function checkEconomist(answer: HamiltonAnswer): RoleCheck {
  const failures: string[] = [];
  const grounded = answer.drivers.filter((d) => /\d/.test(d.text.replace(/"[^"]*"/g, "")) && dated(d));
  if (grounded.length === 0) failures.push("No driver explains the number with a figure and a dated source (prices, rates, jobs or the Beige Book).");
  if (answer.evidenceLevel === "market" && !answer.question) {
    failures.push("The answer rests on market data alone but asks no clarifying question for the missing figure.");
  }
  if (answer.question && !answer.question.prompt.trim().endsWith("?")) failures.push("The clarifying question is not phrased as a question.");
  return { role: "economist", pass: failures.length === 0, failures };
}

function checkConsultant(answer: HamiltonAnswer): RoleCheck {
  const failures: string[] = [];
  if (answer.claims.length === 0) failures.push("No sourced claims.");
  for (const claim of [...answer.claims, ...storyFacts(answer)]) {
    if (isRuleOrRegistry(claim)) {
      const cited = CITED_RULE.test(claim.source.label ?? "");
      if (!claim.source.label?.trim() || (!cited && !dated(claim))) failures.push(`Claim has no named, dated source: "${claim.text}"`);
      continue;
    }
    if (!/\d/.test(claim.text)) failures.push(`Claim has no number: "${claim.text}"`);
    if (!dated(claim)) failures.push(`Claim has no named, dated source: "${claim.text}"`);
    if (MARKET_FIGURE.test(claim.text) && !(claim.sampleSize && claim.sampleSize > 0)) {
      failures.push(`Market figure without its peer count: "${claim.text}"`);
    }
  }
  if (!answer.evidenceLevel) failures.push("No evidence level.");
  for (const text of allText(answer)) {
    if (RECOMMENDATION.test(text.replace(/"[^"]*"/g, ""))) failures.push(`Recommendation not asked for: "${text}"`);
  }
  return { role: "consultant", pass: failures.length === 0, failures };
}

function exhibitPoints(exhibit: Exhibit): number {
  switch (exhibit.kind) {
    case "fee_position":
      return exhibit.band.n;
    case "trend":
      return exhibit.series.reduce((sum, s) => sum + s.points.length, 0);
    case "competitor_range":
      return exhibit.items.length;
    case "segment_table":
      return exhibit.members.length;
    case "change_timeline":
      return exhibit.events.length;
    case "structure_matrix":
      return exhibit.rows.length;
    case "money_at_stake":
      return exhibit.rows.length;
    case "archetype_map":
      return exhibit.archetypes.reduce((sum, a) => sum + a.count, 0);
  }
}

function checkDataEngineer(answer: HamiltonAnswer): RoleCheck {
  const failures: string[] = [];
  const exhibit = answer.exhibit;
  if (!exhibit) {
    failures.push("No exhibit.");
  } else {
    if (!exhibit.title.trim()) failures.push("Exhibit has no title.");
    if (exhibit.sources.length === 0) failures.push("Exhibit names no source.");
    if (exhibitPoints(exhibit) === 0) failures.push("Exhibit has no data to draw.");
    if (exhibit.kind === "fee_position") {
      const { p25, median, p75 } = exhibit.band;
      if (!(p25 <= median && median <= p75)) failures.push("Exhibit band is out of order.");
      if (!exhibit.markers.some((m) => m.scope === "national")) failures.push("Fee position exhibit has no national marker.");
    }
  }
  for (const story of answer.storyline?.exhibits ?? []) {
    if (!story.actionTitle.trim() || !/\d/.test(story.actionTitle)) failures.push(`Exhibit ${story.id} has no point with a number in its title.`);
    if (story.exhibit.sources.length === 0) failures.push(`Exhibit ${story.id} names no source.`);
    if (exhibitPoints(story.exhibit) === 0) failures.push(`Exhibit ${story.id} has no data to draw.`);
  }
  return { role: "data_engineer", pass: failures.length === 0, failures };
}

/** Clean, precise storyline copy (James, 2026-10-06): one idea per line, short, never said twice. */
function checkStoryCopy(answer: HamiltonAnswer, failures: string[]): void {
  const story = answer.storyline;
  if (!story) return;
  const lines = [
    story.governingThought,
    ...[...story.situation, ...story.complication, ...story.lenses.finance, ...story.lenses.market, ...story.watch].map((f) => f.text),
    ...(story.options ?? []).flatMap((o) => o.consequences.map((c) => c.text)),
    ...story.exhibits.flatMap((e) => [e.actionTitle, e.takeaway?.text ?? ""]),
  ].filter(Boolean);
  const g = words(story.governingThought);
  if (g > MAX_GOVERNING_WORDS) failures.push(`${g}-word governing thought: "${story.governingThought}"`);
  const seen = new Set<string>();
  for (const line of lines) {
    if (sentences(line).length !== 1) failures.push(`Storyline line is not one sentence: "${line}"`);
    const n = words(line);
    if (n > MAX_STORY_LINE_WORDS) failures.push(`${n}-word storyline line: "${line}"`);
    const key = line.toLowerCase().replace(/[^a-z0-9$%.]+/g, " ").trim();
    if (seen.has(key)) failures.push(`Storyline says this twice: "${line}"`);
    seen.add(key);
  }
  for (const e of story.exhibits) {
    const t = words(e.exhibit.title);
    if (t > MAX_TITLE_WORDS) failures.push(`${t}-word exhibit title: "${e.exhibit.title}"`);
    const note = e.exhibit.note ?? "";
    if (note && words(note) > MAX_NOTE_WORDS) failures.push(`${words(note)}-word exhibit note: "${note}"`);
  }
}

function checkWriter(answer: HamiltonAnswer): RoleCheck {
  const failures: string[] = [];
  checkStoryCopy(answer, failures);
  const head = sentences(answer.headline);
  if (head.length !== 1) failures.push("The headline is not one sentence.");
  if (!/\$\d|\d%|\d/.test(answer.headline)) failures.push("The headline carries no number.");
  for (const text of allText(answer)) {
    for (const sentence of sentences(text)) {
      const n = words(sentence);
      if (n >= MAX_SENTENCE_WORDS) failures.push(`${n}-word sentence: "${sentence}"`);
    }
    if (PIPELINE_TERMS.test(text)) failures.push(`Pipeline term in: "${text}"`);
    const unquoted = text.replace(/"[^"]*"/g, "");
    for (const { re, why } of UNFORMATTED_UNITS) {
      if (re.test(unquoted)) failures.push(`${why}: "${text}"`);
    }
  }
  return { role: "writer", pass: failures.length === 0, failures };
}

export function evaluateFourRoles(answer: HamiltonAnswer): FourRolesResult {
  const roles = [checkEconomist(answer), checkConsultant(answer), checkDataEngineer(answer), checkWriter(answer)];
  return { pass: roles.every((r) => r.pass), roles };
}
