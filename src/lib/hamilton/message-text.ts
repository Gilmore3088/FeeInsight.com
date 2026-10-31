/**
 * One reply's text, from its separate text parts. A reply that reads data between sentences
 * arrives as several text parts (one per step), and each part ends a sentence with no trailing
 * space, so a plain join printed "$35.00.Across". Parts are joined with one space, or a blank
 * line when the next part opens a Markdown block (a heading, list, table or quote), and never
 * with a second space when the boundary already has one.
 */
const MARKDOWN_BLOCK_START = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/;

export function joinTextParts(texts: readonly string[]): string {
  let out = "";
  for (const text of texts) {
    if (!text) continue;
    if (!out || /\s$/.test(out) || /^\s/.test(text)) out += text;
    else out += (MARKDOWN_BLOCK_START.test(text) ? "\n\n" : " ") + text;
  }
  return out;
}

/** The text of a chat message's text parts, joined by joinTextParts. */
export function messageText(message: { parts?: ReadonlyArray<{ type: string; text?: string }> }): string {
  return joinTextParts((message.parts ?? []).flatMap((p) => (p.type === "text" && typeof p.text === "string" ? [p.text] : [])));
}
