/**
 * Earlier turns of an Ask conversation, carried into a written (prose) answer (#979, H04-T05).
 *
 * The Analyze screen starts every written answer from an empty chat, so a follow-up such as
 * "compare their NSF fees" or "how does this compare with us?" only knows what came before if
 * the screen says so. It appends a bounded, explicit block naming the last few questions and the
 * one-line answer each got. The server strips the block again before it saves the question
 * (`answer-save.ts`), so a saved answer is filed under the words the reader typed.
 *
 * Bounds: at most CONVERSATION_CONTEXT_TURNS earlier turns, newest kept; each question and
 * answer line is flattened to one line and cut to a fixed length. Nothing else (no hidden
 * decision state, no earlier tool output) is carried.
 */

export type ConversationTurn = { question: string; lead: string | null };

/** Earlier turns carried into a written answer, newest kept. */
export const CONVERSATION_CONTEXT_TURNS = 3;
/** The Ask box's own limit, so a carried question is never longer than one the reader could type. */
const QUESTION_CHARS = 500;
/** An answer's lead line is a sentence or two; a long one is cut. */
const LEAD_CHARS = 280;

const BLOCK_START = "\n\n(For context, earlier in this conversation:\n";
/** The block as written by `withConversationContext`: one numbered line per turn, then ")". */
const CONTEXT_BLOCK = /\n\n\(For context, earlier in this conversation:\n(?:\d+\. [^\n]*\n)+\)$/;
/** The single-question form older screens appended; still stripped so their saves stay clean. */
const LEGACY_EARLIER_QUESTION = /\n\n\(For context, my previous question was: "[\s\S]*"\)$/;

/** One line, no markdown emphasis, cut at `max` characters with an ellipsis. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * The question with the conversation's last few turns appended, oldest first. A first question
 * (no earlier turns) and turns with no question text are left out, so nothing is invented.
 */
export function withConversationContext(question: string, earlier: readonly ConversationTurn[]): string {
  const turns = earlier
    .map((t) => ({ question: oneLine(t.question, QUESTION_CHARS), lead: t.lead ? oneLine(t.lead, LEAD_CHARS) : "" }))
    .filter((t) => t.question)
    .slice(-CONVERSATION_CONTEXT_TURNS);
  if (turns.length === 0) return question;
  const lines = turns.map((t, i) =>
    t.lead ? `${i + 1}. I asked: "${t.question}" Hamilton answered: "${t.lead}"` : `${i + 1}. I asked: "${t.question}"`,
  );
  return `${question}${BLOCK_START}${lines.join("\n")}\n)`;
}

/** The question as the reader typed it, without the conversation context the screen appends. */
export function questionOnly(text: string): string {
  return text.replace(CONTEXT_BLOCK, "").replace(LEGACY_EARLIER_QUESTION, "").trim();
}
