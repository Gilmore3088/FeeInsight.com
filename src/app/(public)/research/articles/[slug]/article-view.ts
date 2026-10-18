/**
 * A stored research article, read into the research-brief shape the template renders: an
 * opening finding, then sections of title -> one finding -> labeled exhibit -> source, with the
 * method section held apart for a disclosure. The article body is never rewritten; this only
 * decides where each of its blocks sits. Blocks are the Markdown subset of
 * `src/lib/article-markdown.ts`: paragraphs, "## " headings, "### " subheads, "- " lists, "|"
 * tables and "```bars" charts, separated by blank lines.
 */

export interface BarsRow {
  label: string;
  value: number;
  shown: string;
}

export interface TableData {
  head: string[];
  rows: string[][];
}

export type Exhibit =
  | { kind: "bars"; label: string; rows: BarsRow[]; table: TableData | null }
  | { kind: "table"; label: string; table: TableData };

/** Exhibits and their source, as a section, the lead or the method section holds them. */
export interface ExhibitGroup {
  exhibits: Exhibit[];
  /**
   * The article's own "Source:" line, or the Bank Fee Index line when the exhibits are fee
   * figures and the article wrote none. Null when neither holds: nothing is invented.
   */
  source: string | null;
}

export interface ArticleSection extends ExhibitGroup {
  id: string;
  title: string;
  /** The section's first paragraph, shown straight under its title. */
  finding: string | null;
  /** Further paragraphs, lists and "### " subheads, in written order, shown after the exhibit and source. */
  notes: string[];
}

export interface ArticleBrief {
  /** Paragraphs before the first heading: the article's opening finding. */
  lead: string[];
  /** A chart or table before the first heading, with its source. */
  leadExhibits: ExhibitGroup;
  sections: ArticleSection[];
  method: ({ title: string; blocks: string[] } & ExhibitGroup) | null;
  /** "October 2026" from a closing "As of October 2026." line, which the byline then carries. */
  asOf: string | null;
}

/** A whole heading that names the method; a content heading that only starts "How the..." is not one. */
export const METHOD_TITLE =
  /^(how (these|the|we|this) (numbers|figures|data|estimates) (are|were) (built|made|counted|calculated)|methodology|methods?|about (the|this) data|data and methods?|sources and methods?)\.?$/i;
const SOURCE_LINE = /^sources?:\s*/i;
const AS_OF_LINE = /^as of ([^.]+)\.?$/i;
/**
 * Exhibits about these are not fee-schedule figures (call reports, CFPB, BLS, FDIC deposits), so
 * they never get the Bank Fee Index source by default.
 */
const NOT_FEE_DATA = /\b(revenue|income|service charges?|call reports?|deposits?|complaints?|unemployment|cpi|branch(es)?|population|earnings)\b/i;

function blocksOf(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isBars(lines: string[]): boolean {
  return lines[0].startsWith("```bars") && lines[lines.length - 1] === "```";
}

function isTable(lines: string[]): boolean {
  return lines.every((line) => line.startsWith("|"));
}

/** Text without its Markdown marks, for labels read aloud and for descriptions. */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

export function parseBars(block: string): { label: string; rows: BarsRow[] } {
  const lines = block.split("\n");
  const rows = lines
    .slice(1, -1)
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length === 3 && cells[1] !== "" && Number.isFinite(Number(cells[1])))
    .map(([label, value, shown]) => ({ label, value: Number(value), shown }));
  return { label: lines[0].replace(/^```bars\s*/, "").trim(), rows };
}

export function parseTable(block: string): TableData {
  const rows = block
    .split("\n")
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
  const [head = [], ...body] = rows;
  return { head, rows: body };
}

/**
 * A standalone table's label, from its own columns: "Institutions, lowest, median and highest,
 * by state". Plain text, so the Markdown marks are dropped.
 */
export function tableLabel(table: TableData): string {
  const [first, ...rest] = table.head.map(plainText).filter(Boolean);
  if (!first) return "Table";
  if (rest.length === 0) return first;
  const names = rest.map((name, i) => (i === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1)));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list}, by ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
}

/** A stable anchor for a section title, prefixed "s-" so it never clashes with the page's own ids. */
export function sectionId(title: string, taken: Set<string>): string {
  const slug = plainText(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const base = `s-${slug || "section"}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

interface Bucket {
  title: string | null;
  prose: string[];
  exhibits: Exhibit[];
  source: string | null;
}

function bucket(title: string | null): Bucket {
  return { title, prose: [], exhibits: [], source: null };
}

function fill(b: Bucket, block: string): void {
  const lines = block.split("\n");
  if (isBars(lines)) {
    const { label, rows } = parseBars(block);
    // An untitled chart takes its section's title, so its caption and label are never empty.
    if (rows.length > 0) b.exhibits.push({ kind: "bars", label: label || plainText(b.title ?? "") || "Chart", rows, table: null });
    return;
  }
  if (isTable(lines)) {
    const table = parseTable(block);
    // A table straight after a chart holds the chart's figures: one exhibit, under the chart's label.
    const last = b.exhibits[b.exhibits.length - 1];
    if (last && last.kind === "bars" && last.table === null) last.table = table;
    else b.exhibits.push({ kind: "table", label: tableLabel(table), table });
    return;
  }
  if (SOURCE_LINE.test(block) && lines.length === 1) {
    b.source = block.replace(SOURCE_LINE, "");
    return;
  }
  b.prose.push(block);
}

/** True when an exhibit group reads as fee-schedule figures, so the Bank Fee Index source fits it. */
function isFeeData(b: Bucket): boolean {
  const text = [
    b.title ?? "",
    ...b.prose,
    ...b.exhibits.flatMap((e) => [e.label, ...(e.kind === "bars" ? (e.table?.head ?? []) : e.table.head)]),
  ].join(" ");
  return !NOT_FEE_DATA.test(text);
}

function group(b: Bucket, defaultSource: string | null): ExhibitGroup {
  if (b.source) return { exhibits: b.exhibits, source: b.source };
  return { exhibits: b.exhibits, source: b.exhibits.length > 0 && defaultSource && isFeeData(b) ? defaultSource : null };
}

/**
 * @param defaultSource the Bank Fee Index source line, for fee exhibits the article left unsourced.
 */
export function parseArticle(content: string, defaultSource: string | null = null): ArticleBrief {
  const blocks = blocksOf(content);
  let asOf: string | null = null;
  // A closing "As of October 2026." belongs to the byline, not the last section.
  const lastBlock = blocks[blocks.length - 1];
  const asOfMatch = lastBlock && !lastBlock.includes("\n") ? AS_OF_LINE.exec(lastBlock) : null;
  if (asOfMatch) {
    asOf = asOfMatch[1].trim();
    blocks.pop();
  }

  const lead = bucket(null);
  const sections: Bucket[] = [];
  let method: Bucket | null = null;
  let current = lead;

  for (const block of blocks) {
    // "# " and "## " start a section; a "### " subhead stays inside the section it is in.
    const heading = /^#{1,2} (.+)$/.exec(block);
    if (heading && !block.includes("\n")) {
      const next = bucket(heading[1].trim());
      if (!method && METHOD_TITLE.test(plainText(next.title!))) method = next;
      else sections.push(next);
      current = next;
      continue;
    }
    fill(current, block);
  }

  const taken = new Set<string>();
  return {
    lead: lead.prose,
    leadExhibits: group(lead, defaultSource),
    sections: sections.map((s) => {
      // The finding is the first paragraph, wherever it was written; a list or subhead never stands as one.
      const findingIndex = s.prose.findIndex((block) => !/^### /.test(block) && !block.split("\n").every((line) => line.startsWith("- ")));
      return {
        id: sectionId(s.title ?? "", taken),
        title: s.title ?? "",
        finding: findingIndex === -1 ? null : s.prose[findingIndex],
        notes: s.prose.filter((_, i) => i !== findingIndex),
        ...group(s, defaultSource),
      };
    }),
    method: method ? { title: method.title ?? "", blocks: method.prose, ...group(method, defaultSource) } : null,
    asOf,
  };
}

/** Titles of sections that show an exhibit with no source line, so a review can flag them. */
export function unsourcedSections(brief: ArticleBrief): string[] {
  return brief.sections.filter((s) => s.exhibits.length > 0 && !s.source).map((s) => s.title);
}

/** One point for the top of the page: a section's first sentence, and what backs it up. */
export interface Takeaway {
  /** The section it comes from, so the point links to its evidence. */
  id: string;
  /** Markdown, as the article wrote it. */
  text: string;
  evidence: "chart" | "table" | "text";
}

/** The first sentence of a paragraph; a "$30.50" or "U.S." never ends one. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = /(?<=[a-z0-9%)*][.!?])\s+(?=[A-Z*"(\[])/.exec(flat);
  return end ? flat.slice(0, end.index) : flat;
}

/**
 * Up to three one-line takeaways, in reading order: the first sentence of each section's finding.
 * Articles have no takeaway field, so these are the article's own words and nothing is invented.
 */
export function takeaways(brief: ArticleBrief, max = 3): Takeaway[] {
  return brief.sections
    .filter((s) => s.finding)
    .slice(0, max)
    .map((s) => {
      const kind = s.exhibits[0]?.kind;
      return { id: s.id, text: firstSentence(s.finding!), evidence: kind === "bars" ? "chart" : kind === "table" ? "table" : "text" };
    });
}

/** Rows shown before "Show all": a table or chart of up to this many plus two shows whole. */
export const TABLE_ROWS_SHOWN = 5;

export function tableFolds(rows: number): boolean {
  return rows > TABLE_ROWS_SHOWN + 2;
}

/** A dash, "n/a" or "none" stands for no figure and does not decide a column's alignment. */
export function isEmptyCell(cell: string): boolean {
  return /^(|-|–|—|n\/?a|none)$/i.test(cell.trim());
}

/** Plain text for a description: the opening finding without Markdown marks, cut at a word. */
export function plainSummary(brief: ArticleBrief, max = 160): string {
  const source = brief.lead.length > 0 ? brief.lead.join(" ") : (brief.sections.find((s) => s.finding)?.finding ?? "");
  const text = plainText(source.replace(/#/g, "")).replace(/\s+/g, " ");
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trim()}...`;
}

/** "October 8, 2026" for a byline, read in UTC so the date never shifts by a server's zone. */
export function bylineDate(value: string | Date | null | undefined): { label: string; iso: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    label: date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
    iso: date.toISOString(),
  };
}

/** Fee-category tags ("overdraft") from the stored JSON tag list, for the related guide. */
export function articleTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string" && /^[a-z_]+$/.test(t)) : [];
  } catch {
    return [];
  }
}
