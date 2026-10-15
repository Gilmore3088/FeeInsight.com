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

/**
 * The question as the reader typed it, without the conversation context the screen appends.
 * The older single-question form is stripped only when the current block is absent, so text the
 * reader typed in front of a current block is never cut (#1273).
 */
export function questionOnly(text: string): string {
  if (CONTEXT_BLOCK.test(text)) return text.replace(CONTEXT_BLOCK, "").trim();
  return text.replace(LEGACY_EARLIER_QUESTION, "").trim();
}

/**
 * The longest user message an honest Analyze screen can send: an Ask-box question at its limit
 * plus the context block with every carried turn at its limit. Computed with the builder itself,
 * so it follows the block's format and bounds.
 */
export const MAX_USER_MESSAGE_CHARS = withConversationContext(
  "x".repeat(QUESTION_CHARS),
  Array.from({ length: CONVERSATION_CONTEXT_TURNS }, () => ({
    question: "x".repeat(QUESTION_CHARS),
    lead: "x".repeat(LEAD_CHARS),
  })),
).length;

/**
 * Most messages one request may carry. The Analyze screen sends one (it clears the chat before
 * each written answer); the admin research chat sends its whole history, so this allows 50
 * questions with their answers in one chat.
 */
export const MAX_REQUEST_MESSAGES = 100;

/**
 * Most content one request may carry across every message and role (#1357). Assistant messages
 * are not capped one by one, since real research answers run long, but a client that sends many
 * long ones would otherwise set an unbounded provider cost. 400,000 characters fits a full
 * 100-message admin chat with long answers; anything larger starts a new chat.
 */
export const MAX_REQUEST_CONTENT_CHARS = 400_000;

export const MESSAGE_TOO_LONG_ERROR = `Each question can be at most ${MAX_USER_MESSAGE_CHARS.toLocaleString("en-US")} characters.`;
export const TOO_MANY_MESSAGES_ERROR = "This conversation is too long. Start a new chat to keep asking.";

type MessageLike = { role?: unknown; parts?: unknown };

/** A user message's text, its text parts joined as the route reads them. */
function messageText(message: MessageLike): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        !!p && typeof p === "object" && (p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join(" ");
}

/** A message's whole content as it would be forwarded, measured by its serialized parts. */
function contentSize(message: MessageLike): number {
  if (!message || !Array.isArray(message.parts)) return 0;
  try { return JSON.stringify(message.parts).length; } catch { return Number.POSITIVE_INFINITY; }
}

/**
 * The server's own bound on what a client sends (#1273): the number of messages, and each user
 * message's length. The screens' limits hold only for an honest client; this holds for any.
 * Returns the error to send, or null when the request is within bounds.
 */
export function messageBoundsError(messages: readonly MessageLike[]): string | null {
  if (messages.length > MAX_REQUEST_MESSAGES) return TOO_MANY_MESSAGES_ERROR;
  let total = 0;
  for (const m of messages) {
    if (m && m.role === "user" && messageText(m).length > MAX_USER_MESSAGE_CHARS) return MESSAGE_TOO_LONG_ERROR;
    // Every part counts, text or not, since the route forwards all of them to the model.
    total += contentSize(m);
    if (total > MAX_REQUEST_CONTENT_CHARS) return TOO_MANY_MESSAGES_ERROR;
  }
  return null;
}
