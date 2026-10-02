import { STATE_NAMES } from "@/lib/us-states";
import type { AdminAgent } from "./types";

/**
 * Rule-based parser for the crew command bar ("Magellan, run Georgia").
 * No model is involved: a fixed grammar, so commands are free, fast and predictable.
 * Unknown input returns a `help` command that lists what the crew understands.
 */

export type CrewScope = { kind: "state"; stateCode: string } | { kind: "all" } | { kind: "due" };

export type CrewCommand =
  | { kind: "help"; agent: AdminAgent; reason?: string }
  | { kind: "status"; agent: AdminAgent }
  | { kind: "stuck"; agent: AdminAgent }
  | { kind: "is-done"; agent: AdminAgent; stateCode: string }
  | { kind: "run"; agent: AdminAgent; scope: CrewScope }
  | { kind: "retry"; agent: AdminAgent }
  | { kind: "pause"; agent: AdminAgent }
  | { kind: "resume"; agent: AdminAgent }
  | { kind: "show"; agent: AdminAgent; query: string };

/** Commands that change something and therefore need a confirmation click. */
export function isWriteCommand(command: CrewCommand): boolean {
  return command.kind === "run" || command.kind === "retry" || command.kind === "pause" || command.kind === "resume";
}

const AGENT_NAMES: Record<string, AdminAgent> = {
  atlas: "atlas",
  magellan: "magellan",
  rosetta: "rosetta",
  knox: "knox",
  darwin: "darwin",
  hamilton: "hamilton",
};

const STATE_BY_NAME = new Map<string, string>(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
);

export const CREW_COMMAND_EXAMPLES = [
  "status",
  "what's stuck?",
  "is Georgia done?",
  "Atlas, run Georgia",
  "Atlas, run all due states",
  "Magellan, run Texas",
  "Knox, retry failed",
  "pause / resume",
  "show First Credit Union",
];

/** "GA", "ga", "Georgia", "new york" → state code; anything else → null. */
export function parseState(text: string): string | null {
  const cleaned = text.trim().replace(/[.?!]+$/, "").replace(/^the\s+/i, "").replace(/\s+state$/i, "");
  if (!cleaned) return null;
  const byName = STATE_BY_NAME.get(cleaned.toLowerCase());
  if (byName) return byName;
  const code = cleaned.toUpperCase();
  return /^[A-Z]{2}$/.test(code) && STATE_NAMES[code] ? code : null;
}

function parseScope(text: string): CrewScope | null {
  const cleaned = text.trim().replace(/[.?!]+$/, "").toLowerCase();
  if (!cleaned || cleaned === "everything" || cleaned === "all" || cleaned === "all states" || cleaned === "nationwide") {
    return { kind: "all" };
  }
  if (/^(all )?due( states)?$/.test(cleaned) || cleaned === "all due states" || cleaned === "what's due" || cleaned === "whats due") {
    return { kind: "due" };
  }
  const stateCode = parseState(text);
  return stateCode ? { kind: "state", stateCode } : null;
}

export function parseCrewCommand(input: string): CrewCommand {
  let text = input.trim().replace(/\s+/g, " ");
  let agent: AdminAgent = "atlas";

  // Optional "hey"/"ok" and an addressed agent: "Hey Magellan, ..." / "knox: ..."
  text = text.replace(/^(hey|hi|ok|okay)\s+/i, "");
  const addressed = text.match(/^([a-z]+)\s*[,:]?\s+(.*)$/i);
  if (addressed && AGENT_NAMES[addressed[1].toLowerCase()]) {
    agent = AGENT_NAMES[addressed[1].toLowerCase()];
    text = addressed[2];
  } else if (AGENT_NAMES[text.toLowerCase().replace(/[.?!,]+$/, "")]) {
    return { kind: "status", agent: AGENT_NAMES[text.toLowerCase().replace(/[.?!,]+$/, "")] };
  }

  const lower = text.toLowerCase().replace(/[.!]+$/, "").trim();

  if (!lower || /^(help|commands|what can you do\??)$/.test(lower)) return { kind: "help", agent };
  if (/^(status|how are (we|you) doing\??|what'?s (going on|happening)\??|report)$/.test(lower)) {
    return { kind: "status", agent };
  }
  if (/^(what'?s |is (anything|something) |anything )?stuck\??$/.test(lower)) return { kind: "stuck", agent };
  if (/^(pause|stop)( the pipeline| everything)?$/.test(lower)) return { kind: "pause", agent };
  if (/^(resume|start|unpause|go)( the pipeline| everything)?$/.test(lower)) return { kind: "resume", agent };
  if (/^retry( failed| the failed( jobs?| runs?)?| last)?$/.test(lower)) return { kind: "retry", agent };

  const isDone = lower.match(/^is (.+?) (done|finished|complete)\??$/);
  if (isDone) {
    const stateCode = parseState(isDone[1]);
    return stateCode
      ? { kind: "is-done", agent, stateCode }
      : { kind: "help", agent, reason: `I don't know the state "${isDone[1]}".` };
  }

  const run = text.match(/^(run|refresh|crawl|work on|do)\b\s*(.*)$/i);
  if (run) {
    const scope = parseScope(run[2]);
    return scope
      ? { kind: "run", agent, scope }
      : { kind: "help", agent, reason: `I don't know what "${run[2]}" is. Try a state, "all due" or "all".` };
  }

  const show = text.match(/^(show|find|look up|lookup)\s+(.+)$/i);
  if (show) return { kind: "show", agent, query: show[2].replace(/[?.!]+$/, "").trim() };

  return { kind: "help", agent, reason: "I didn't catch that." };
}

/** The steps each worker owns when asked to "run" on its own. */
export const AGENT_RUN_STEPS: Record<AdminAgent, Array<{ key: string; title: string }>> = {
  atlas: [],
  magellan: [
    { key: "discover", title: "Find missing fee schedule URLs" },
    { key: "fetch", title: "Download fee schedules" },
  ],
  rosetta: [{ key: "read", title: "Read downloaded documents" }],
  knox: [{ key: "extract", title: "Pull fees out of documents" }],
  darwin: [{ key: "classify", title: "Verify extracted fees" }],
  hamilton: [{ key: "publish", title: "Publish verified fees" }],
};

export function describeScope(scope: CrewScope): string {
  if (scope.kind === "state") return STATE_NAMES[scope.stateCode] ?? scope.stateCode;
  return scope.kind === "due" ? "all states that are due" : "all states";
}

/** One-line description of a write command, shown on its confirmation card. */
export function describeWrite(command: CrewCommand): string {
  switch (command.kind) {
    case "run":
      if (command.agent === "atlas") {
        return command.scope.kind === "state"
          ? `Atlas will run the full pipeline for ${describeScope(command.scope)}.`
          : command.scope.kind === "due"
            ? "Atlas will start runs for up to 10 states that are due."
            : "Atlas will run the full pipeline across all states.";
      }
      return `${titleCase(command.agent)} will ${AGENT_RUN_STEPS[command.agent].map((step) => step.title.charAt(0).toLowerCase() + step.title.slice(1)).join(", then ")} for ${describeScope(command.scope)}.`;
    case "retry":
      return `${titleCase(command.agent)} will retry its most recent failed job.`;
    case "pause":
      return "Pause the pipeline. Queued work waits until you resume.";
    case "resume":
      return "Resume the pipeline.";
    default:
      return "";
  }
}

export function titleCase(agent: string): string {
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}
