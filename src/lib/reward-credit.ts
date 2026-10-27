/**
 * #2137: a reward, bonus or credit the bank pays the customer, not a price the customer pays. Shared by
 * Knox (it drops such a read, rules v137) and the shared source check (`checkFeeAgainstSource`, reason
 * `reward_credit`). Pure: no database and no agent imports.
 *
 * A line such as "2) Earn $50 when you complete two or more online bill payments", "To receive up to a
 * $150 bonus", "receive a $25 credit toward the rental of a safe deposit box", "Earn a $5 Starbucks
 * Card", "Submit A Mobile Deposit | $5 reward" or "request a one-time service charge refund of $50"
 * states money paid to the customer. Read as a fee it sat in the dollar benchmarks at the reward.
 *
 * Only the fee's own figure counts: the first figure at the fee's amount after the fee's name on the
 * line, else the line's first at that amount (the name is not on the line, or follows its figure:
 * "$100 credit toward closing costs"), as in `rateBoundOf`. The figure is a reward when:
 * - words that only ever pay the customer come right before it: "earn", "we'll credit", "credited
 *   with", "bonus of", "refund of", "rebates up to" ("Earn $50", "refund of $50");
 * - a reward noun comes right after it: "$150 bonus", "$5 reward", "$25 credit toward", "$10 statement
 *   credit", "$10 cash back";
 * - or "receive" / "get" comes right before it AND a reward noun (bonus, reward, credit, rebate, refund,
 *   cash back) follows in the same clause: "To receive up to a $150 bonus", "receive a $25 credit toward
 *   the rental", "receive a $100 rebate". A bare "receive" or "get" never makes a reward: it names a
 *   service as often as a payment ("Fax / Receive $1.00 per page", "Incoming wire: to receive $15.00",
 *   "members get $2 per statement", "Rush card - get a $25 card").
 * It is never a reward when a fee word follows the figure ("receive a $20.00 late fee", "receive a $25
 * service charge", "receive reimbursement of our $2.95 Consumer Bill Pay Fee") or when it is a deposit
 * the customer must bring ("receive $1,000 or more in Monthly Direct Deposits").
 */

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{1,2})(?![\d.,]\d)/g;
const REWARD_WORDS_PREFILTER = /\b(?:earn|earns|earned|receive|receives|get|gets|enjoy|credit|credited|bonus|bonuses|reward|rewards|rebate|rebates|refund|refunds|cash\s*back)\b/i;
/** Articles and "up to" that may sit between the paying words and the figure. */
const FILLER = String.raw`(?:\s+(?:an?|one|extra|additional|one-time|up\s+to|another))*\s*$`;
/**
 * Words that pay the customer, right before the figure: "Earn $50", "earn a $5", "we'll credit $25",
 * "will be credited with $10", "bonus of $100", "refund of $50", "rebates up to $20".
 */
const PAID_BEFORE = new RegExp(
  String.raw`\b(?:earns?|earned|enjoy|we(?:'|’)?ll\s+(?:credit|deposit|pay|give)(?:\s+you)?|we\s+will\s+(?:credit|deposit|pay|give)(?:\s+you)?|credited(?:\s+with)?|(?:bonus(?:es)?|rewards?|rebates?|refunds?|statement\s+credit)\s+(?:of|up\s+to|totaling|worth))` + FILLER,
  "i",
);
/**
 * "receive" or "get" right before the figure, with only articles and "up to" between. On its own it
 * names a service as often as a payment ("Receive $1.00 per page", "Incoming wire: to receive $15.00"),
 * so it counts only with a reward noun after the figure in the same clause (`REWARD_IN_CLAUSE`).
 */
const RECEIVE_BEFORE = new RegExp(String.raw`\b(?:receives?|gets?)` + FILLER, "i");
/** A reward noun later in the figure's clause: "$150 bonus you must", "$25 credit toward", "$100 rebate after". */
const REWARD_IN_CLAUSE = /^[^.;!?|]{0,40}?\b(?:bonus(?:es)?|rewards?|credit|rebates?|refunds?|cash\s*back)\b/i;
/** A reward noun right after the figure: "$150 bonus", "($5 reward )", "$25 credit toward", "$10 cash back". */
const REWARD_AFTER =
  /^\s*\)?\s*(?:(?:cash|new[- ]account|sign[- ]?up|welcome|referral|account[- ]opening|monthly|annual|one[- ]time|extra|additional)\s+)*(?:bonus(?:es)?\b|rewards?\b|cash\s*back\b|statement\s+credit\b|account\s+credit\b|credit\s+(?:toward|towards|to\s+your|on\s+your|will|is)\b)/i;
/** A fee word right after the figure keeps it a fee: "$20.00 late fee", "$25 service charge", "$31 fee". */
const FEE_AFTER = /^\s*\.?\s*(?:[A-Za-z/-]+\s+){0,3}?(?:fees?|charges?|penalty|penalties|assessments?)\b/i;
/** A deposit or spend the customer must bring, not money paid to them: "receive $1,000 or more in direct deposits". */
const REQUIREMENT_AFTER = /^\s*(?:or\s+more|or\s+greater|minimum|in\s+(?:\w+\s+){0,3}(?:deposits?|purchases?|transactions?|overdraft|courtesy|coverage))/i;

function moneyValue(token: string): number {
  return Number(token.replace(/,/g, ""));
}

/** Where the fee's own words end on the line: after its name when the name is on it, else the start. */
function ownStart(line: string, feeName: string | null | undefined): number {
  // A name that kept its figure ("However, receive a $25") ends where the figure starts.
  const name = (feeName ?? "").replace(/\s*\$\s?[\d.,]+.*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!name) return 0;
  const at = line.toLowerCase().indexOf(name);
  return at < 0 ? 0 : at + name.length;
}

/** The reward words when `text` states `amount` as money paid to the customer on its own line, else null. */
export function rewardCreditOf(
  text: string | null | undefined,
  amount: number | string | null | undefined,
  feeName?: string | null,
): { clause: string } | null {
  const value = Number(amount);
  if (!(value > 0) || !Number.isFinite(value)) return null;
  const line = (text ?? "").replace(/\s+/g, " ");
  if (!REWARD_WORDS_PREFILTER.test(line)) return null;
  const from = ownStart(line, feeName);
  const atAmount = [...line.matchAll(MONEY)].filter((money) => Math.abs(moneyValue(money[1]) - value) <= 0.001);
  // A name printed after its figure ("$100 credit toward closing costs ...") owns the line's first one.
  const own = atAmount.find((money) => (money.index ?? 0) >= from) ?? atAmount[0];
  if (!own) return null;
  const start = own.index ?? 0;
  const end = start + own[0].length;
  const before = line.slice(Math.max(0, start - 60), start);
  const after = line.slice(end, end + 60);
  if (FEE_AFTER.test(after)) return null;
  const received = RECEIVE_BEFORE.test(before) && REWARD_IN_CLAUSE.test(after);
  const paid = (PAID_BEFORE.test(before) || received) && !REQUIREMENT_AFTER.test(after);
  if (!paid && !REWARD_AFTER.test(after)) return null;
  return { clause: line.slice(Math.max(0, start - 40), Math.min(line.length, end + 40)).trim() };
}
