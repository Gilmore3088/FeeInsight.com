/**
 * One reply's text, from its separate text parts. A reply that reads data between sentences
 * arrives as several text parts (one per step), and each part ends a sentence with no trailing
 * space, so a plain join printed "$35.00.Across". Parts are joined with one space; with nothing
 * when the boundary already has whitespace or the next part opens with closing punctuation; with
 * a line break before a code fence, a blank line after one, or between two table rows (one table stays one table); and with
 * a blank line when the next part opens a Markdown block or the last line is a list item or heading.
 */
const MARKDOWN_BLOCK_START = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/;
const LIST_OR_HEADING_LINE = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s)/;
const CLOSING_PUNCTUATION = /^[,.;:)!?]/;

function separator(out: string, text: string): string {
  if (/\s$/.test(out) || /^\s/.test(text) || CLOSING_PUNCTUATION.test(text)) return "";
  if (text.startsWith("```")) return "\n";
  const lastLine = out.slice(out.lastIndexOf("\n") + 1);
  if (lastLine.startsWith("|") && text.startsWith("|")) return "\n";
  if (lastLine.startsWith("```")) return "\n\n";
  if (MARKDOWN_BLOCK_START.test(text) || LIST_OR_HEADING_LINE.test(lastLine)) return "\n\n";
  return " ";
}

export function joinTextParts(texts: readonly string[]): string {
  let out = "";
  for (const text of texts) {
    if (!text) continue;
    out += out ? separator(out, text) + text : text;
  }
  return out;
}

/** The text of a chat message's text parts, joined by joinTextParts. */
export function messageText(message: { parts?: ReadonlyArray<{ type: string; text?: string }> }): string {
  return joinTextParts((message.parts ?? []).flatMap((p) => (p.type === "text" && typeof p.text === "string" ? [p.text] : [])));
}
