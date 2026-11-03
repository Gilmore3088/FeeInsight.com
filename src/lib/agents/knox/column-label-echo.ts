/**
 * v170 (Knox re-read backlog dry run 3, Nov 2): a table whose page repeats its column headings inside
 * each cell. Responsive fee tables print a hidden label in every cell for phones, and the reader keeps
 * it, so a row reads "Returned Check (Service / Item) | $10 (Fee) | Per item (Terms/Conditions)" under
 * the heading row "Category | Service / Item | Fee | Terms/Conditions" (River Town FCU 6757, doc 41792).
 * Knox named the fee "Returned Check (Service / Item)": the label's "Item" made the plain returned check
 * no plain returned item, so it stayed NSF beside the page's $25 NSF, and "Statement Copy (Service /
 * Item)" matched the check copy rule's "copy ... items" and filed as check_image. Seven current texts
 * print such echoes (Nov 2, read-only): Banterra 389, Heart of Louisiana FCU 5488, Gulf Coast Educators
 * FCU 4975, St. Johns Bank 2440, Co-Op FCU 8046, Bluestone FCU 4715 and River Town.
 *
 * A cell's trailing "(Label)" is the echo, and is removed, only when the label is printed as a whole
 * cell of a heading row above it (a row of two or more cells with no figure, within the last
 * `HEADING_REACH` lines) and a cell after the row's first carries one too ("$10 (Fee)"): a name's own
 * note that matches a column ("Business Checking/Draft Fee (monthly) | $ | 5.00" under a "Monthly"
 * column) stays. A label holds no digit and at most four words, so "(5)", "(per item)" and
 * "(Free with Platinum Checking)" stay. Every other line is returned as it is.
 */
const CELL_SEPARATOR = " | ";
const HEADING_REACH = 150;
const TRAILING_LABEL = /\s*\(([A-Za-z][A-Za-z /&'-]{0,40})\)\s*$/;
const MAX_LABEL_WORDS = 4;

const normal = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

function headingCells(line: string): string[] | null {
  const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
  if (cells.length < 2 || /\d|\$/.test(line)) return null;
  if (cells.some((cell) => cell.split(/\s+/).length > 6)) return null;
  return cells.map(normal);
}

export function withoutColumnLabelEchoes(text: string): string {
  if (!/\([A-Za-z][A-Za-z /&'-]{0,40}\)\s*(?:\||$)/m.test(text)) return text;
  const lines = text.split("\n");
  const headings: Array<{ at: number; cells: Set<string> }> = [];
  return lines
    .map((line, index) => {
      const heading = headingCells(line);
      if (heading) {
        headings.push({ at: index, cells: new Set(heading) });
        return line;
      }
      if (!line.includes("|") || headings.length === 0) return line;
      const near = headings.filter((row) => index - row.at <= HEADING_REACH);
      if (near.length === 0) return line;
      const isHeadingLabel = (label: string) => {
        const words = normal(label);
        return words.split(" ").length <= MAX_LABEL_WORDS && near.some((row) => row.cells.has(words));
      };
      const cells = line.split(CELL_SEPARATOR);
      const echoes = cells.map((cell) => {
        const match = cell.match(TRAILING_LABEL);
        return match && isHeadingLabel(match[1]) && cell.slice(0, match.index).trim() ? (match.index as number) : null;
      });
      // A row the page labels repeats a heading after a cell other than its name (its price, "$10 (Fee)"):
      // a name's own note that happens to match a heading ("Draft Fee (monthly)" under a "Monthly"
      // column) is not one.
      if (!echoes.slice(1).some((at) => at !== null)) return line;
      return cells.map((cell, at) => (echoes[at] === null ? cell : cell.slice(0, echoes[at] as number).trimEnd())).join(CELL_SEPARATOR);
    })
    .join("\n");
}
