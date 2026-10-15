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
  if (index === -1) return { lead: null, body: content };
  return {
    lead: blocks[index].trim(),
    body: blocks.filter((_, i) => i !== index).join("\n\n"),
  };
}

/** About how long the article takes to read, at 230 words a minute; never under one minute. */
export function readingMinutes(content: string): number {
  const words = content.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  return Math.max(1, Math.round(words / 230));
}
