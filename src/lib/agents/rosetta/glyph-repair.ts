/**
 * Glyphs a document's own text layer leaves unknown (#2598).
 *
 * A PDF says which letters each glyph draws through its font's ToUnicode map. Microsoft Word's
 * PDF export maps the ligature glyphs it draws for "ti", "ft", "tt", "ff", "fi" and the like to
 * U+FFFD, the replacement character, so pdf.js reads "Interna\uFFFDonal", "Overdra\uFFFD" and
 * "a\uFFFDer". Some fonts do the same for the decimal point ("$14\uFFFD95"). pdf.js passes the
 * map on faithfully: the letters are not in the text layer, so no decoder recovers them. Rosetta
 * restores a glyph only where the answer is unambiguous:
 *
 * - U+FB00-U+FB06 are real Unicode ligatures; each has one compatibility decomposition (NFKC).
 * - "$2\uFFFD00": a dollar amount, the glyph, exactly two digits. US amounts write cents after
 *   a point, so the glyph is "." when no range reading is possible: the cents are "00", or are
 *   not above the dollar figure ("$143\uFFFD56"). "$5\uFFFD10" may be "$5-10", so it is restored
 *   only when the same document writes the glyph as its decimal ("$N\uFFFD00") and never between
 *   two dollar figures ("$5\uFFFD$10"). This is the one repair that can change an amount, so a
 *   doubtful case stays as it is (#2649 review).
 * - A word with one or two unknown glyphs: each is tried as every ligature Word draws
 *   (`LIGATURE_CANDIDATES`). The word is restored only when exactly one spelling is a known word
 *   (`FEE_TEXT_LIGATURE_WORDS`, or a word the same text prints in clear). At the end of a word the
 *   glyph may be a broken full stop ("account\uFFFD"), so there the letters before it must not be
 *   a word the text prints on its own: "the\uFFFD" stays, "Overdra\uFFFD" is "Overdraft".
 *
 * Everything else stays as it is: runs of the glyph (a dot leader), a lone glyph (a bullet or a
 * check box), and words with no unique answer. Knox already treats those as junk glyphs.
 *
 * HTML and plain text are bytes Rosetta decodes itself. Decoding a Latin-1 page as UTF-8 also
 * writes U+FFFD ("Zelle\uFFFD" for "Zelle(R)" on a page served as ISO-8859-1). `decodeTextBytes`
 * keeps valid UTF-8 as UTF-8 and reads bytes that are not valid UTF-8 in their declared charset,
 * or as Windows-1252 when none is declared, so every byte keeps its character.
 */

import { GLYPH_REPAIR_VERSION } from "./reader-versions";
// The number lives in reader-versions.ts (bump it there); the history stays above.
export { GLYPH_REPAIR_VERSION };

export const REPLACEMENT_CHARACTER = "\uFFFD";

/** A stored text carrying either glyph is due for one read with the current repair. */
export const GLYPH_REPAIR_DUE_PATTERN = "[\uFFFD\uFB00-\uFB06]";

/** The letters a Word ligature glyph draws, longest first within each family. */
export const LIGATURE_CANDIDATES = ["ti", "tti", "tt", "ft", "ff", "ffi", "ffl", "fi", "fl", "f"] as const;

/**
 * Words with a ligature's letters, as fee schedules and account agreements print them in clear:
 * the words of this kind at 10 or more institutions in a sample of 6,278 stored texts with no
 * replacement character (prod, 25 Oct 2026, every fourth completed text), with run-together
 * words, markup and place names removed.
 */
const FEE_TEXT_LIGATURE_WORDS_SOURCE = `
abbreviation accepting accommodation accounting accumulating accumulation accumulations acquisition
acquisitions acting action actions activate activated activating activation active actively activities
activity addition additional additionally additions adjudication adjusting administration administrative
adoption advertise advertised advertisement advertisements advertisers advertising affairs affect affected
affecting affects affidavit affiliate affiliated affiliates affinity affirmative affirmatively affixed afford
affordability affordable afforded affords after afternoon aggregation aircraft allocation alteration
alterations alternative alternatively alternatives ammunition amortization amortized analytics animations
annuities anti anticipate anticipated anticipates anticipation anytime application applications appointing
appreciation arbitration article articles artificial asserting assisting assistive association associations
assumption assumptions atlantic attach attached attaches attachment attachments attacks attained attains
attempt attempted attempting attempts attend attending attends attention attorney attorneys attract
attractive attributable auction auditing authentic authenticate authenticated authenticates authenticating
authentication authenticity authorities authorization authorizations automatic automatically automation
automotive battery beneficial beneficiaries beneficiary benefit benefited benefiting benefits better betting
bluff bottom briefly budgeting button buttons calculating calculation calculations cancellation cancellations
capabilities captions caution cautious celebrating celebration certificate certificates certification
certified certify characteristics charities circulation citation citations cities citizen citizens
classification classified clutter coffee collecting collection collections collective collectively
combination committed committee committees communicating communication communications communities
comparative compatibility compatible compensation competition competitive completing completion computation
computing concentration condition conditional conditioned conditions conducting confidence confident
confidential confidentiality confidently configuration configure confine confirm confirmation confirmations
confirmed confirming confirms conflict conflicting conflicts conjunction connecticut connecting connection
connections connectivity consecutive consenting consequential consideration considerations consisting
consolidating consolidation constitute constituted constitutes construction consultation consulting
consummation contacting continental contingent continually continuation continue continued continues
continuing continuous continuously contributing contribution contributions convention conventional
conversation conversations converting cooperation cooperative cooperatives corporation corporations
correcting correction corrections corrective counties counting crafted creating creation creative
credentials crediting critical cumulative cutoff cutting daytime deactivate deactivated debiting declaration
dedication deductibility deductible deductibles deducting deduction deductions deficiencies deficiency
deficit define defined defines definitely definition definitions deleting deletion deletions denomination
depositing depreciation derivative description descriptions designating designation designations
destination destinations destruction destructive detection determination differ difference differences
different differently differs difficult difficulties difficulty directing direction directions directives
disabilities discontinue discontinued discontinuing discretion discretionary discrimination disposition
disproportionately disruption disruptions disruptive dissatisfied distinct distribution distributions
documentation documenting domestic donation donations draft drafted drafts duplication duration duties
editing edition education educational effect effective effectively effectiveness effects effectuate
efficiency efficient efficiently effort effortless effortlessly efforts electing election elections
eliminating encryption enewsletter enotices entire entirely entirety entities entitled entity equities
essential essentially essentials estimate estimated estimates estimator evaluating evaluation examination
exception exceptional exceptions exciting executing execution executions executive executives exemption
exhaustive existing exiting expectations expertise expiration explanation exploitation extenuating
facilitating facilities fantastic fiduciary field fields fifteen fifth fifty fight figure figures file filed
files filing fill filled filling filter final finalized finally finance financed finances financial
financially financing find finding findings finds fine fines finger fingerprint fingertips finish finished
fire firearm firearms firefighters fires firewall firm firms first fit fitness fits five fix fixed flat flex
flexibility flexible flip flood floods floor flow fluctuate fluctuations forgotten foundation foundations
fraction fulfill fulfilled function functional functionalities functionality functioning functions
generation generational generations getting gift gifts graduation granting hereafter hereinafter hosting
identical identifiable identification identified identifier identifiers identifies identify identifying
identities identity illustrative immigration impacting impersonating impersonation implementation
implementing implications imposition inaction inactive inactivity incentive incentives incorporation
indemnification indicating indication ineffective inflation influence information informational informative
initial initially initials initiate initiated initiates initiating initiation initiative initiatives
injunction injunctive innovation innovative inspecting inspection installation institute institution
institutional institutions instructing instruction instructions insufficiency insufficient integration
intention intentional intentionally interaction interactions interactive interception interesting
international internationally interpretation interpreting interruption interruptions intervention
introduction intuitive investigate investigating investigation investigations investing invitations
invocation irregularities irrespective jurisdiction jurisdictions justifies justify lasting latitude left
legitimate letter letters letting liabilities lifetime lifetimes lifting limitation limitations limiting
liquidation listing listings litigating litigation little locating location locations lottery magnetic
malfunction malfunctions marketing massachusetts matter matters maturities mediation meeting meetings mention
mentioned microfilm misappropriation misrepresentation mitigate mitigation modification modifications
modified motion multi multifactor multifamily multiple multiples multiply multiplying municipalities
narcotics nation national nationally nationals nations nationwide native navigating navigation necessities
negative negotiable negotiate negotiated negotiation newsletter newsletters nonactions nonaffiliated
nonaffiliates nonfinancial nonnegotiable nonprofit nonprofits nonsufficient notarization notice notices
notification notifications notified notifies notify notifying objection objectionable objective objectives
obligation obligations off offense offensive offer offered offering offerings offers office officer officers
offices official officially officials offline offs offset often operating operation operational operations
opportunities optimal optimize optimum opting option optional options organization organizational
organizations orientation originating origination originations overdraft overdrafts pacific partial
partially participant participants participate participated participates participating participation
particular particularly parties patience patient pattern patterns payoff penalties permitted permitting
personalization pertinent petition plastic platinum plotted political portion portions position positions
positive possibilities postdating posting postings potential potentially practicable practical practice
practiced practices preauthorization precaution precautions preparation prescription prescriptions
presentation presenting prestige pretty preventing prevention printing priorities prioritize proactive
proactively production profile profiles profit profits prohibiting prohibition prohibitions promotion
promotional promotions properties proportion proportionate prosecution prospective protecting protection
protections protective publication publications punitive purporting putting qualification qualifications
qualified qualifier qualifiers qualifies quantity question questioning questions raffle rating ratings
ratio ratios reactivate reactivation reclamation recognition recommendation recommendations reconciliation
recreation recreational redemption reduction refinance refinanced refinances refinancing reflect reflected
reflecting reflects registration regulating regulation regulations rejecting rejection relating relation
relations relationship relationships relative relatively relatives remittance remitted remitting renovation
renovations renting repetitive reporting representation representations representative representatives
representing reproduction reputation requesting reservation residential resolution resolutions respective
respectively responsibilities restoration restricting restriction restrictions restrictive restrictively
resubmitted resulting retention retire retired retirees retirement revocation routine routinely routines
routing sacrificing sanctions satisfaction satisfactory satisfied satisfies satisfy satisfying scrutinize
scrutiny section sections securities selecting selection sensitive sequential setoff setting settings
settle settled settlement settles settlor sharedraft shift significant significantly simplified sitting
situation situations soft software solicitation solution solutions sometimes sophisticated specific
specifically specifications specifics specified specifies spoofing sporting staff staffed starting static
stating station stations statistical statistics stick sticker still stuff submitted submitting
subordination subscription subscriptions subsection substantial substantially substantive substitute
subtitle subtracting suffer suffered suffers sufficient sufficiently suffix suggesting suggestions
supporting supportive surreptitiously swift tactics targeting telecommunication telecommunications
telemarketing terminating termination testimonial testimonials testing texting theft thereafter thrift
ticket tickets tied tier tiered tiers ties time timeframe timeframes timeline timeliness timely times timing
tip tips tire tired title titled titles tradition traditional traffic transacting transaction transactional
transactions transition translation translations transmittal transmitted transmitting transportation
treating truncation tuition ultimate ultimately unaffected unaffiliated unanticipated unattended
underwriting underwritten unintentionally unstaffed until untimely untitled updating utilities utility
utilization utilize utilized utilizes utilizing vacation vacations validation valuation variation
variations verifiable verification verifications verified verifies versatile vesting victim violating
violation violations visiting voting waiting wanting warranties watercraft writing written
`;

export const FEE_TEXT_LIGATURE_WORDS: ReadonlySet<string> = new Set(FEE_TEXT_LIGATURE_WORDS_SOURCE.split(/\s+/).filter(Boolean));

const LIGATURE_LETTERS = /ti|ft|tt|ff|fi|fl/;
const UNICODE_LIGATURE = /[\uFB00-\uFB06]/g;
/** At most this many unknown glyphs in one word are tried (10 spellings each). */
const MAX_GLYPHS_PER_WORD = 2;
/** A word with an unknown glyph: letters and one or two lone glyphs, never a run of them. */
const GLYPH_WORD = /[A-Za-z\uFFFD]*[A-Za-z][A-Za-z\uFFFD]*/g;
/**
 * Words that end a sentence and, with a ligature's letters added, make a listed word ("an" +
 * "ti", "of" + "f", "so" + "ft", "the" + "ft"): their final glyph is never read as a ligature,
 * even in a text too short to print them on their own.
 */
const SENTENCE_END_WORDS: ReadonlySet<string> = new Set(["an", "of", "so", "the"]);
const DOLLAR_CENTS = /(\$\s?\d{1,3}(?:,\d{3})*|\$\s?\d+)\uFFFD(\d{2})(?![\d\uFFFD])/g;
/** The glyph written as a decimal point before "00", and the glyph between two dollar figures. */
const GLYPH_DECIMAL_00 = /\$\s?\d[\d,]*\uFFFD00(?![\d\uFFFD])/;
const GLYPH_DOLLAR_RANGE = /\$\s?\d[\d,]*\s?\uFFFD\s?\$/;

/** The text with each provable decimal glyph restored (see the module comment). */
function restoreDecimals(text: string, documentText: string): string {
  const glyphIsDecimal = GLYPH_DECIMAL_00.test(documentText) && !GLYPH_DOLLAR_RANGE.test(documentText);
  return text.replace(DOLLAR_CENTS, (match: string, dollars: string, cents: string) => {
    const whole = Number(dollars.replace(/[$,\s]/g, ""));
    const noRange = cents === "00" || Number(cents) <= whole;
    return noRange || glyphIsDecimal ? `${dollars}.${cents}` : match;
  });
}

/** U+FB00-U+FB06 written as their letters ("\uFB01nancial" is "financial"). */
export function expandUnicodeLigatures(text: string): string {
  return text.replace(UNICODE_LIGATURE, (ligature) => ligature.normalize("NFKC"));
}

export interface GlyphRepairResult {
  text: string;
  /** Unknown glyphs restored to letters or a decimal point. */
  restored: number;
  /** Unknown glyphs left as they were. */
  left: number;
}

/** The words a text prints in clear, lowercased. */
function clearWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const match of text.matchAll(/(?<![A-Za-z\uFFFD])[A-Za-z]+(?![A-Za-z\uFFFD])/g)) words.add(match[0].toLowerCase());
  return words;
}

function withCase(letters: string, word: string): string {
  const shown = word.replace(/\uFFFD/g, "");
  return shown.length >= 2 && shown === shown.toUpperCase() ? letters.toUpperCase() : letters;
}

function spellings(parts: string[], word: string): string[] {
  let results = [parts[0]];
  for (let index = 1; index < parts.length; index += 1) {
    const next: string[] = [];
    for (const prefix of results) {
      for (const letters of LIGATURE_CANDIDATES) {
        // A lone "f" glyph is an f drawn to join a following i or l ("pro\uFFFDit", "Re\uFFFDinancing").
        if (letters === "f" && !/^[il]/i.test(parts[index])) continue;
        next.push(prefix + withCase(letters, word) + parts[index]);
      }
    }
    results = next;
  }
  return results;
}

function restoredWord(word: string, known: (candidate: string) => boolean, printed: Set<string>): string | null {
  const glyphs = word.split(REPLACEMENT_CHARACTER).length - 1;
  if (glyphs === 0 || glyphs > MAX_GLYPHS_PER_WORD) return null;
  const parts = word.split(REPLACEMENT_CHARACTER);
  // A glyph opening the word has no letters before it to tell a ligature from a bullet.
  if (parts[0].length === 0) return null;
  if (word.endsWith(REPLACEMENT_CHARACTER)) {
    // A broken full stop after a word the text prints on its own ("the\uFFFD") is not a ligature.
    const stem = parts.slice(0, -1).join(REPLACEMENT_CHARACTER);
    const lower = stem.toLowerCase();
    if (stem.includes(REPLACEMENT_CHARACTER) || stem.length < 2 || printed.has(lower) || SENTENCE_END_WORDS.has(lower)) return null;
  }
  const matches = new Set(spellings(parts, word).filter((candidate) => known(candidate.toLowerCase())));
  return matches.size === 1 ? [...matches][0] : null;
}

/**
 * The text with each unknown glyph restored where only one reading is possible (see the module
 * comment). `documentText` is the whole document a page belongs to, whose clear words count as
 * printed; it defaults to the text itself. Deterministic: the same input gives the same result.
 */
export function repairUnmappedGlyphs(input: string, documentText: string = input): GlyphRepairResult {
  const expanded = expandUnicodeLigatures(input);
  const total = expanded.split(REPLACEMENT_CHARACTER).length - 1;
  if (total === 0) return { text: expanded, restored: 0, left: 0 };
  let text = restoreDecimals(expanded, expandUnicodeLigatures(documentText));
  const printed = clearWords(expandUnicodeLigatures(documentText));
  const known = (candidate: string) =>
    LIGATURE_LETTERS.test(candidate) && (FEE_TEXT_LIGATURE_WORDS.has(candidate) || printed.has(candidate));
  text = text.replace(GLYPH_WORD, (word) => {
    // A run of the glyph touching the word is a dot leader, not part of it. Two glyphs between
    // letters are two ligatures ("Compe\uFFFD\uFFFDon" is "Competition").
    if (!word.includes(REPLACEMENT_CHARACTER) || /\uFFFD{3}|^\uFFFD{2}|\uFFFD{2}$/.test(word)) return word;
    return restoredWord(word, known, printed) ?? word;
  });
  const left = text.split(REPLACEMENT_CHARACTER).length - 1;
  return { text, restored: total - left, left };
}

/** The charset a Content-Type header or the page's own meta tag declares, lowercased. */
export function declaredCharset(bytes: Uint8Array, contentType: string | null | undefined): string | null {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  return fromMeta ? fromMeta.toLowerCase() : null;
}

/** The WHATWG labels that all mean Windows-1252 (ISO-8859-1 and ASCII pages included). */
const WINDOWS_1252_LABELS = new Set(["windows-1252", "cp1252", "x-cp1252", "iso-8859-1", "iso8859-1", "iso_8859-1", "latin1", "l1", "us-ascii", "ascii"]);
/** Windows-1252's characters for bytes 0x80-0x9F (undefined bytes keep their code). */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** Windows-1252 decoded by table: Node's decoder for that label reads 0x80-0x9F as Latin-1. */
function decodeWindows1252(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    const chunk = bytes.subarray(start, start + 8192);
    text += String.fromCharCode(...Array.from(chunk, (byte) => (byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80] : byte)));
  }
  return text;
}

function decoderFor(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

/** Length of the valid UTF-8 sequence starting at `index`, or 0 when the byte there starts none. */
function utf8SequenceLength(bytes: Uint8Array, index: number): number {
  const lead = bytes[index];
  if (lead < 0x80) return 1;
  const cont = (offset: number, low = 0x80, high = 0xbf) => {
    const byte = bytes[index + offset];
    return byte !== undefined && byte >= low && byte <= high;
  };
  if (lead >= 0xc2 && lead <= 0xdf) return cont(1) ? 2 : 0;
  if (lead === 0xe0) return cont(1, 0xa0) && cont(2) ? 3 : 0;
  if ((lead >= 0xe1 && lead <= 0xec) || lead === 0xee || lead === 0xef) return cont(1) && cont(2) ? 3 : 0;
  if (lead === 0xed) return cont(1, 0x80, 0x9f) && cont(2) ? 3 : 0;
  if (lead === 0xf0) return cont(1, 0x90) && cont(2) && cont(3) ? 4 : 0;
  if (lead >= 0xf1 && lead <= 0xf3) return cont(1) && cont(2) && cont(3) ? 4 : 0;
  if (lead === 0xf4) return cont(1, 0x80, 0x8f) && cont(2) && cont(3) ? 4 : 0;
  return 0;
}

/**
 * Mostly-UTF-8 bytes as text: every valid UTF-8 sequence is read as UTF-8, and only a byte that
 * starts no valid sequence is read as Windows-1252. A UTF-8 page with one raw Latin-1 byte (the
 * Kasasa footer's 0xA9 "Copyright (c)") keeps its "’", "–" and "®" (#2649 review); a
 * pure Latin-1 page, whose high bytes start no valid sequence, reads as Windows-1252 throughout.
 */
function decodeUtf8WithWindows1252(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8");
  const parts: string[] = [];
  let runStart = 0;
  let index = 0;
  while (index < bytes.length) {
    const length = utf8SequenceLength(bytes, index);
    if (length > 0) {
      index += length;
      continue;
    }
    if (index > runStart) parts.push(utf8.decode(bytes.subarray(runStart, index)));
    parts.push(decodeWindows1252(bytes.subarray(index, index + 1)));
    index += 1;
    runStart = index;
  }
  if (bytes.length > runStart) parts.push(utf8.decode(bytes.subarray(runStart)));
  return parts.join("");
}

/**
 * Bytes as text. Valid UTF-8 is read as UTF-8 whatever the page declares (a page labelled
 * ISO-8859-1 that sends UTF-8 is common). Bytes that are not valid UTF-8 are read in the declared
 * charset when it is neither UTF-8 nor Windows-1252; otherwise each valid UTF-8 sequence stays
 * UTF-8 and only the bytes that are not are read as Windows-1252, so no byte becomes U+FFFD and no
 * UTF-8 character is split.
 */
export function decodeTextBytes(bytes: Uint8Array, contentType?: string | null): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const declared = declaredCharset(bytes, contentType);
    if (!declared || /^utf-?8$/.test(declared) || WINDOWS_1252_LABELS.has(declared)) return decodeUtf8WithWindows1252(bytes);
    return decoderFor(declared)?.decode(bytes) ?? decodeUtf8WithWindows1252(bytes);
  }
}
