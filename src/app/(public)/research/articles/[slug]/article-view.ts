/**
 * The first chart block ("```bars Title" ... "```") of an article, lifted out so it can lead the
 * page beside the headline. The rest of the article renders as written. Null lead when the
 * article has no chart.
 */
export function splitLeadChart(content: string): { lead: string | null; body: string } {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const index = blocks.findIndex((block) => {
    const lines = block.trim().split("\n");
    return lines[0].startsWith("```bars") && lines[lines.length - 1] === "```";
  });
  // Only a chart that opens the article leads it: one under a later heading belongs to its section.
  const firstHeading = blocks.findIndex((block) => /^#{1,3} /.test(block.trim()));
  if (index === -1 || (firstHeading !== -1 && firstHeading < index)) return { lead: null, body: content };
  return {
    lead: blocks[index].trim(),
    body: blocks.filter((_, i) => i !== index).join("\n\n"),
  };
}

/** Plain text for a description: the body without chart blocks or table rows, cut at a word. */
export function plainSummary(content: string, max = 160): string {
  const text = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .filter((block) => !block.trim().startsWith("```") && !block.trim().startsWith("|"))
    .join(" ")
    .replace(/[#*_`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trim()}...`;
}

/** About how long the article takes to read, at 230 words a minute; never under one minute. */
export function readingMinutes(content: string): number {
  const words = content.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  return Math.max(1, Math.round(words / 230));
}
