/**
 * A document whose own address or link words call it old or archived is never a bank's fee link
 * (#1026, #1455 class, Nov 3). Banks keep a superseded schedule online beside the current one
 * ("/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf", ".../PDF.FEE.SCHED.716.OLD.pdf",
 * "/deposit-accounts/schedule-of-fees-old", "/old-web-site/", "/archive-2021/personal-checking.php"),
 * and Magellan took them like any fee page. On Nov 3 (prod, read-only) 86 live fees at 5 banks came
 * from such documents, and three of those banks still had one as their stored fee link. The
 * live-site audit never saw it: it checks the page a fee cites, and that page still prints the fee.
 *
 * One rule, read on the address's path (never the host: Old National, Old Second and Old Point are
 * banks) and on a link's label, used by Magellan's discovery address check (`find-validate.ts`), its
 * link scoring (`scoreLink`), its companion finder (`second-document.ts`) and its fetch step (a stored
 * link like this goes back to discovery, `fetch.ts`), and by Darwin's live re-check
 * (`darwin/old-labelled-document-check.ts`).
 *
 * Conservative on purpose. The path is split into words at "/", "-", "_", ".", "+", spaces and
 * camel case ("FeeScheduleOld"), and the extension dropped. Then:
 *   - "archive", "archived", "archives", "superseded", "expired", "obsolete" and "outdated" mark it
 *     anywhere in the path ("/archive-2021/", "/archive/2019/fees.pdf");
 *   - "old", "previous" and "prior" mark it only as the last word of a path segment
 *     ("Fee-Schedule-Old.pdf", "truthnsavings_old.pdf") or right before a document or site word
 *     ("old-fee-schedule.pdf", "/old-web-site/", "old-home.html", "prior-disclosures"), or before a
 *     year that is ("fee-schedule-old-2021.pdf" counts through the year).
 * So "/prior-notice", "/old-national-fee-schedule.pdf", "/older-adults-checking", "/senior-savings",
 * "/goldstar/fees", "/bold/fees", "Compliance-Folder", "Schedule-of-Fees-2022-No-Bold.pdf" and
 * "gold-card" are never old. "Retired", "former" and "legacy" are left out: "Retired Military
 * Accounts" is a current product, and a legacy accounts page is `legacy-page.ts`'s rule.
 *
 * A link label is read with the same words, but every one of them needs a document word beside it:
 * "Old Fee Schedule", "Fee Schedule (Archived)", "Previous Disclosures", "Fee Schedule - Old". "Prior
 * Notice Required", "Old National Bank" and "Older Adults Checking" are not old. Pure.
 */

/** Words that mark a document old wherever they sit in its path. */
const ALWAYS_OLD = new Set(["archive", "archived", "archives", "superseded", "expired", "obsolete", "outdated"]);
/** Words that mark it old only at a segment's end or beside a document word. */
const OLD_BESIDE_DOCUMENT = new Set(["old", "previous", "prior"]);
const OLD_WORDS = new Set([...ALWAYS_OLD, ...OLD_BESIDE_DOCUMENT]);
/** Document and site words: what an old word must stand beside. */
const DOCUMENT_WORDS = new Set([
  "fee", "fees", "schedule", "schedules", "sched", "disclosure", "disclosures", "version", "versions",
  "edition", "editions", "copy", "rates", "pricing", "charges", "tis", "truthnsavings", "agreement",
  "site", "web", "website", "home", "homepage", "page", "pages", "pdf", "docs", "documents", "files",
]);
const YEAR = /^(19|20)\d{2}$/;
const EXTENSION = /\.(pdf|html?|php|aspx?|docx?|jsp)$/i;

function words(segment: string): string[] {
  return segment
    .replace(EXTENSION, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function documentWordAfter(tokens: string[], index: number): boolean {
  let next = index + 1;
  while (next < tokens.length && YEAR.test(tokens[next])) next += 1;
  return next < tokens.length && DOCUMENT_WORDS.has(tokens[next]);
}

/** Pure: the old word an address's path carries ("old", "archive"...), or null. The host is never read. */
export function oldLabelledAddress(url: string | null | undefined): string | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url.trim()).pathname;
  } catch {
    return null;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the encoded path
  }
  for (const segment of path.split("/")) {
    const tokens = words(segment);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (ALWAYS_OLD.has(token)) return token;
      if (!OLD_BESIDE_DOCUMENT.has(token)) continue;
      const last = tokens.slice(index + 1).every((rest) => YEAR.test(rest));
      if (last || documentWordAfter(tokens, index)) return token;
    }
  }
  return null;
}

/** Pure: the old word a link's label carries beside a document word ("Old Fee Schedule", "Fee Schedule (Archived)"), or null. */
export function oldLabelledLinkWords(label: string | null | undefined): string | null {
  const tokens = (label ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!OLD_WORDS.has(token)) continue;
    if (documentWordAfter(tokens, index)) return token;
    let before = index - 1;
    while (before >= 0 && YEAR.test(tokens[before])) before -= 1;
    const lastWord = tokens.slice(index + 1).every((rest) => YEAR.test(rest));
    if (lastWord && before >= 0 && DOCUMENT_WORDS.has(tokens[before])) return token;
  }
  return null;
}

/** Pure: the link is old or archived by its address or its label (`oldLabelledAddress`, `oldLabelledLinkWords`). */
export function oldLabelledLink(url: string | null | undefined, label?: string | null): string | null {
  return oldLabelledAddress(url) ?? oldLabelledLinkWords(label);
}

/**
 * A loose Postgres pre-filter on a URL column's path (host removed, lowercased) that every address
 * `oldLabelledAddress` matches also matches; the exact rule then runs in TypeScript on the rows.
 */
export function oldLabelledPrefilterSql(column: string): string {
  return `lower(regexp_replace(COALESCE(${column}, ''), '^[a-z]+://[^/]+', '', 'i')) ~ '(old|archiv|previous|prior|supersed|expired|obsolete|outdated)'`;
}
