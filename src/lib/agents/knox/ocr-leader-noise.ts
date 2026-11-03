/**
 * v181 (backlog dry run 12, First Bank & Trust Co. text 12416): a scanned schedule's dot leaders can carry OCR
 * noise, single letters and runs of a few repeated letters ("Paid Item Charge................c......... 30.00",
 * "Sweep Transfer Fee. ....... iii iiieeeeeeaeeeeeaaeaeeaaaaaaa.. | FREE"), which the readers took into the fee's
 * name ("Paid Item Charge c"). A run of such tokens that sits on a leader (dots or an ellipsis before it) and is
 * followed by more leader, a cell break or the price is blanked; a run holding any real word ("see below") is
 * kept. Lines keep their positions. Pure, and idempotent.
 *
 * Every check that looks for a read's stored line in a text (`zeroPrintedForRead`, `audienceRowLineCount`,
 * `audienceSectionHeading`, `conditionalFreeRow`) blanks both the line and the text first, so a line stored before
 * v181 (with its noise) and one stored since (without) find the same row of either text (review of #2979).
 */
const OCR_NOISE_RUN = /((?:\.{2,}|…)[.…\s]*)((?:[a-z]+[.…\s]+)*?[a-z]+)(?=[.…\s]*(?:\.{2,}|…|\||\$?\d|$))/g;
/** Real words a leader can lead to that the noise test would otherwise take ("....... free"). */
const LEADER_WORDS = /^(?:free|fee|fees|see|add|all|off|too|less|need|feed|seen|been|tee|ill)$/;
function ocrNoiseToken(token: string): boolean {
  if (token.length === 1) return true;
  return token.length >= 3 && !LEADER_WORDS.test(token) && new Set(token).size <= 3 && /([a-z])\1/.test(token);
}
export function withoutOcrLeaderNoise(text: string): string {
  if (!/(?:\.{2,}|…)[.…\s]*[a-z]/.test(text)) return text;
  return text.split("\n").map((line) => line.replace(OCR_NOISE_RUN, (whole, leader: string, run: string) => {
    const tokens = run.split(/[.…\s]+/).filter(Boolean);
    return tokens.length > 0 && tokens.every(ocrNoiseToken) ? `${leader}${" ".repeat(run.length)}` : whole;
  })).join("\n");
}

/** Whitespace squashed after the blanking: how a stored line and a text's lines are compared. */
export function ocrComparable(line: string | null | undefined): string {
  return withoutOcrLeaderNoise(line ?? "").replace(/\s+/g, " ").trim();
}
