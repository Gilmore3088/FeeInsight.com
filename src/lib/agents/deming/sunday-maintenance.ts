import { sql } from "@/lib/data-store/connection";
import { SITE_URL } from "@/lib/constants";
import { escapeHtml, getTransactionalFromAddress, sendResendEmail, type EmailDeliveryStatus } from "@/lib/email/resend";
import { loadLabelQueue, type ContestedName } from "@/lib/agents/knox/label-queue";
import { answerKeySchemaReady, banksToCheck, listAnswerKeyInstitutions } from "@/lib/data-store/answer-key";
import { readDataRoomCounts, type DataRoomCounts } from "@/lib/data-store/data-room";
import { getFailureAlerts, type FailureAlert } from "@/lib/agents/failure-alerts";
import { goalBriefLines, readGoalScorecard, type GoalScorecard } from "@/lib/agents/goal-scorecard";
import { briefRecipients } from "@/lib/agents/daily-brief";

type SqlTag = typeof sql;

/**
 * James's Sunday maintenance email (#1104): the week's tasks only he can do, each with a time
 * estimate and a link, capped at about an hour; the rest rolls to next week and the email says so.
 * Built by a deterministic step on the run ledger (`deming-sunday-maintenance`, last in the daily
 * scoreboard run, Sundays UTC only). No model call. Every count comes from a query.
 *
 * It is delivered only while `SUNDAY_EMAIL_LIVE=true`; otherwise each Sunday's run records the
 * email it would have sent, so James can read it on the ledger before switching it on.
 */

export const SUNDAY_EMAIL_MINUTES = 60;
export const MINUTES_PER_LABEL = 1;
export const MINUTES_PER_ANSWER_KEY_BANK = 10;
export const MINUTES_PER_DECISION = 5;
const STUCK_IN_EMAIL = 5;

export interface SundayTask {
  kind: "label" | "decision" | "answer_key";
  title: string;
  minutes: number;
  href: string;
}

export interface SundayEmailInputs {
  labels: ContestedName[] | null;
  answerKeyToCheck: number | null;
  dataRoom: DataRoomCounts | null;
  goal: GoalScorecard | null;
  stuck: FailureAlert[] | null;
  now: Date;
}

export interface SundayEmail {
  subject: string;
  lines: string[];
  /** Minutes the tasks in this email take, at most `SUNDAY_EMAIL_MINUTES`. */
  minutes: number;
  /** Tasks that did not fit and roll to next week. */
  rolledOver: number;
}

const count = (value: number) => value.toLocaleString("en-US");
const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`;
const UNREAD = "could not be read this week";

/** The week's tasks in the issue's order: labels, decisions, samples. Pure. */
export function sundayTasks(input: SundayEmailInputs): { tasks: SundayTask[]; unreadable: string[] } {
  const tasks: SundayTask[] = [];
  const unreadable: string[] = [];
  if (input.labels == null) unreadable.push(`Fee names to label: ${UNREAD}.`);
  for (const group of input.labels ?? []) {
    tasks.push({
      kind: "label",
      title: `"${group.example}" (${plural(group.banks, "bank")})`,
      minutes: MINUTES_PER_LABEL,
      href: `${SITE_URL}/admin/knox/labels`,
    });
  }
  if (input.dataRoom == null) unreadable.push(`Data decisions: ${UNREAD}.`);
  else {
    if (input.dataRoom.closedInstitutionFees > 0) {
      tasks.push({
        kind: "decision",
        title: `Decide on ${plural(input.dataRoom.closedInstitutionFees, "live fee")} at ${plural(input.dataRoom.closedInstitutions, "closed institution")} (#1200)`,
        minutes: MINUTES_PER_DECISION,
        href: "https://github.com/Gilmore3088/FeeInsight.com/issues/1200",
      });
    }
    if (input.dataRoom.cityAtLimit > 0) {
      tasks.push({
        kind: "decision",
        title: `Approve the city-name repair: ${plural(input.dataRoom.cityAtLimit, "institution")} at the 15-character cut (#1213)`,
        minutes: MINUTES_PER_DECISION,
        href: "https://github.com/Gilmore3088/FeeInsight.com/issues/1213",
      });
    }
  }
  if (input.answerKeyToCheck == null) unreadable.push(`Answer-key banks: ${UNREAD}.`);
  for (let index = 0; index < (input.answerKeyToCheck ?? 0); index += 1) {
    tasks.push({
      kind: "answer_key",
      title: "Check an answer-key bank's fees against its schedule",
      minutes: MINUTES_PER_ANSWER_KEY_BANK,
      href: `${SITE_URL}/admin/answer-key`,
    });
  }
  return { tasks, unreadable };
}

/** The email: tasks that fit the hour, the week in numbers, anything stuck. Pure. */
export function buildSundayEmail(input: SundayEmailInputs): SundayEmail {
  const { tasks, unreadable } = sundayTasks(input);
  const fitting: SundayTask[] = [];
  let minutes = 0;
  for (const task of tasks) {
    if (minutes + task.minutes > SUNDAY_EMAIL_MINUTES) break;
    fitting.push(task);
    minutes += task.minutes;
  }
  const rolledOver = tasks.length - fitting.length;
  const day = input.now.toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push(fitting.length === 0
    ? "Nothing needs you this week."
    : `This week: ${plural(fitting.length, "task")}, about ${minutes} minutes.${rolledOver > 0 ? ` ${plural(rolledOver, "more task")} roll to next week.` : ""}`);

  const labels = fitting.filter((task) => task.kind === "label");
  if (labels.length > 0) {
    lines.push(`Fee names to label (${plural(labels.length, "name")}, about ${labels.length * MINUTES_PER_LABEL} minutes): ${labels.map((task) => task.title).join("; ")}.\n${SITE_URL}/admin/knox/labels`);
  }
  for (const task of fitting.filter((item) => item.kind === "decision")) {
    lines.push(`${task.title}, about ${task.minutes} minutes.\n${task.href}`);
  }
  const banks = fitting.filter((task) => task.kind === "answer_key");
  if (banks.length > 0) {
    lines.push(`Answer-key banks to check: ${plural(banks.length, "bank")}, about ${banks.length * MINUTES_PER_ANSWER_KEY_BANK} minutes.\n${SITE_URL}/admin/answer-key`);
  }
  lines.push(...unreadable);

  if (input.goal) {
    const goalLines = goalBriefLines(input.goal).filter((line) =>
      /^(Coverage|Accuracy|Wrong after publish|Provider spend)/.test(line),
    );
    lines.push(`The week in numbers:\n${goalLines.map((line) => `- ${line}`).join("\n")}\n- Held lines leaving the pile: not measured yet.\n${SITE_URL}/admin/scoreboard`);
  } else {
    lines.push(`The week in numbers: ${UNREAD}.`);
  }

  if (input.stuck == null) lines.push(`Anything stuck: ${UNREAD}.`);
  else if (input.stuck.length === 0) lines.push("Anything stuck: no failure alert is open.");
  else {
    const shown = input.stuck.slice(0, STUCK_IN_EMAIL);
    lines.push(`Anything stuck (${plural(input.stuck.length, "open alert")}):\n${shown.map((alert) => `- ${alert.title}: ${alert.message}`).join("\n")}${input.stuck.length > shown.length ? `\n- and ${count(input.stuck.length - shown.length)} more` : ""}\n${SITE_URL}/admin`);
  }

  return {
    subject: `Fee Insight: your Sunday hour, ${day}${fitting.length === 0 ? " (nothing waiting)" : ` (${minutes} minutes)`}`,
    lines,
    minutes,
    rolledOver,
  };
}

export function isSundayUtc(now: Date): boolean {
  return now.getUTCDay() === 0;
}

export function sundayEmailLive(env: Record<string, string | undefined> = process.env): boolean {
  return env.SUNDAY_EMAIL_LIVE === "true";
}

export interface SundayMaintenanceResult {
  ran: boolean;
  reason: string | null;
  email: SundayEmail | null;
  deliveryStatus: EmailDeliveryStatus | "skipped";
  deliveryReason: string | null;
}

async function read<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`Sunday maintenance email: ${what} could not be read`, error);
    return null;
  }
}

export async function runSundayMaintenance({
  db = sql,
  now = new Date(),
  dryRun = false,
  force = false,
}: { db?: SqlTag; now?: Date; dryRun?: boolean; force?: boolean } = {}): Promise<SundayMaintenanceResult> {
  if (!force && !isSundayUtc(now)) {
    return { ran: false, reason: "Not Sunday (UTC).", email: null, deliveryStatus: "skipped", deliveryReason: null };
  }
  const [labels, answerKeyToCheck, dataRoom, goal, stuck] = await Promise.all([
    read("fee-name labels", () => loadLabelQueue(db)),
    read("answer key", async () => ((await answerKeySchemaReady(db)) ? banksToCheck(await listAnswerKeyInstitutions(db)).length : 0)),
    read("data room", () => readDataRoomCounts(db)),
    read("scorecard", () => readGoalScorecard(db, now)),
    read("failure alerts", () => getFailureAlerts(db)),
  ]);
  const email = buildSundayEmail({ labels, answerKeyToCheck, dataRoom, goal, stuck, now });

  if (dryRun) return { ran: true, reason: null, email, deliveryStatus: "not_configured", deliveryReason: "dry run" };
  if (!sundayEmailLive()) {
    return { ran: true, reason: null, email, deliveryStatus: "not_configured", deliveryReason: "SUNDAY_EMAIL_LIVE is not true; written to the ledger only." };
  }
  const from = getTransactionalFromAddress();
  if (!from) {
    return { ran: true, reason: null, email, deliveryStatus: "not_configured", deliveryReason: "TRANSACTIONAL_EMAIL_FROM is not configured." };
  }
  const { to, cc } = briefRecipients();
  const text = email.lines.join("\n\n");
  const html = email.lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line).replace(/\n/g, "<br>")}</p>`).join("");
  const result = await sendResendEmail(
    { from, to, cc, subject: email.subject, text, html, idempotencyKey: `sunday-maintenance-${now.toISOString().slice(0, 10)}` },
    "the Sunday maintenance email",
  );
  return {
    ran: true,
    reason: null,
    email,
    deliveryStatus: result.status,
    deliveryReason: result.status === "sent" ? null : result.status === "failed" ? result.error : result.reason,
  };
}

export function summarizeSundayMaintenance(result: SundayMaintenanceResult): string {
  if (!result.ran) return `Skipped the Sunday maintenance email: ${result.reason ?? "not due"}`;
  const minutes = result.email?.minutes ?? 0;
  return result.deliveryStatus === "sent"
    ? `Deming emailed James the Sunday hour: ${minutes} minutes of tasks.`
    : `Deming wrote the Sunday hour (${minutes} minutes of tasks) but did not email it: ${result.deliveryReason ?? result.deliveryStatus}.`;
}
