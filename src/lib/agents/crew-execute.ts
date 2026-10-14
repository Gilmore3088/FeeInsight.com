import { sql } from "@/lib/data-store/connection";
import { getPipelineControl, setPipelineEnabled } from "@/lib/automation-control";
import { pipelineHealthProblems } from "@/lib/job-health";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { STATE_NAMES } from "@/lib/us-states";
import { getCrewStatus } from "./crew";
import {
  AGENT_RUN_STEPS,
  CREW_COMMAND_EXAMPLES,
  describeScope,
  describeWrite,
  isWriteCommand,
  titleCase,
  type CrewCommand,
} from "./crew-commands";
import { startAgentRun } from "./run-store";
import { scheduleDueStateLaneRuns, startStateLaneRun, STATE_LANE_STEPS } from "./state-lane-scheduler";

/**
 * Answers and carries out crew commands. Reads answer immediately; writes return a
 * proposal that the operator confirms, and only the confirmation (which re-parses the
 * original text) changes anything. Every write goes through startAgentRun or the
 * pipeline control, so it appears in the run ledger and the crew log.
 */

export interface CrewReply {
  speaker: string;
  lines: string[];
  links?: Array<{ label: string; href: string }>;
  /** Only populated after a durable run has actually been created or reused. */
  runId?: number;
  runReused?: boolean;
  /** Present for write commands: what will happen if the operator confirms. */
  confirm?: { summary: string; commandText: string };
}

function minuteBucket(): string {
  return new Date().toISOString().slice(0, 16);
}

export async function answerCrewCommand(command: CrewCommand, commandText: string): Promise<CrewReply> {
  const speaker = titleCase(command.agent);
  if (isWriteCommand(command)) {
    return { speaker, lines: ["Here's what I'll do. Confirm to go ahead."], confirm: { summary: describeWrite(command), commandText } };
  }

  switch (command.kind) {
    case "help":
      return {
        speaker,
        lines: [
          ...(command.reason ? [command.reason] : []),
          "I can do these:",
          ...CREW_COMMAND_EXAMPLES.map((example) => `• ${example}`),
        ],
      };
    case "status": {
      const crew = await getCrewStatus();
      if (command.agent !== "atlas") {
        const me = crew.find((member) => member.agent === command.agent)!;
        return {
          speaker,
          lines: [`Now: ${me.now}`, me.last ? `Last: ${me.last}` : "I haven't done anything recently.", `Done today: ${me.doneToday}.`],
          links: [{ label: `Open ${speaker}`, href: me.href }],
        };
      }
      const health = await getPipelineHealth();
      const problems = pipelineHealthProblems(health);
      const working = crew.filter((member) => member.state === "working").map((member) => member.name);
      return {
        speaker,
        lines: [
          !health.pipeline_enabled
            ? "The pipeline is paused."
            : problems.length === 0
              ? "Everything is running normally."
              : `${problems.length === 1 ? "One thing needs" : `${problems.length} things need`} attention.`,
          working.length > 0 ? `Working now: ${working.join(", ")}.` : "Nobody is working right now.",
          `Today: ${health.runs_completed_24h ?? 0} runs finished, ${health.runs_failed_24h ?? 0} failed.`,
          ...problems.slice(0, 3).map((problem) => `• ${problem}`),
        ],
      };
    }
    case "stuck": {
      const health = await getPipelineHealth();
      const problems = pipelineHealthProblems(health);
      const failed = await sql`
        SELECT id, title, error_summary
          FROM agent_runs
         WHERE status IN ('failed', 'blocked')
           AND updated_at >= NOW() - INTERVAL '24 hours'
         ORDER BY updated_at DESC
         LIMIT 3
      `;
      const lines = [
        ...problems.map((problem) => `• ${problem}`),
        ...failed.map((run) => `• Run #${run.id} (${run.title}) failed: ${String(run.error_summary ?? "no reason recorded").slice(0, 120)}`),
      ];
      return {
        speaker,
        lines: lines.length > 0 ? ["Here's what's stuck:", ...lines] : ["Nothing is stuck."],
        links: failed.length > 0 ? [{ label: "Run details", href: "/admin/atlas/details" }] : undefined,
      };
    }
    case "is-done": {
      const stateName = STATE_NAMES[command.stateCode] ?? command.stateCode;
      const [run] = await sql`
        SELECT id, status, progress_current, progress_total, current_stage, updated_at
          FROM agent_runs
         WHERE state_code = ${command.stateCode}
         ORDER BY started_at DESC
         LIMIT 1
      `;
      if (!run) return { speaker, lines: [`${stateName} hasn't been run yet. Say "Atlas, run ${stateName}" to start it.`] };
      const status = String(run.status);
      const when = new Date(run.updated_at as string | Date).toISOString().slice(0, 16).replace("T", " ");
      const line = status === "completed" || status === "complete"
        ? `Yes. The last ${stateName} run finished (${when} UTC).`
        : status === "queued" || status === "running"
          ? `Not yet. ${stateName} is on step ${Number(run.progress_current) + 1} of ${run.progress_total}${run.current_stage ? ` (${run.current_stage})` : ""}.`
          : `No. The last ${stateName} run ended as "${status}" (${when} UTC).`;
      return { speaker, lines: [line], links: [{ label: `Run #${run.id}`, href: "/admin/atlas/details" }] };
    }
    case "show": {
      const id = Number(command.query.replace(/^#/, ""));
      const rows = Number.isInteger(id) && id > 0
        ? await sql`
            SELECT id, institution_name, state_code, fee_schedule_url FROM institution_sources WHERE id = ${id}
          `
        : await sql`
            SELECT id, institution_name, state_code, fee_schedule_url
              FROM institution_sources
             WHERE institution_name ILIKE ${`%${command.query}%`}
             ORDER BY asset_size DESC NULLS LAST
             LIMIT 3
          `;
      if (rows.length === 0) return { speaker, lines: [`I couldn't find "${command.query}".`] };
      const lines: string[] = [];
      for (const row of rows) {
        const [counts] = await sql`
          SELECT
            (SELECT COUNT(*)::int FROM published_fee_catalog WHERE institution_id = ${row.id}) AS published,
            (SELECT MAX(crawled_at) FROM source_documents WHERE institution_id = ${row.id} AND status = 'success') AS last_fetch
        `;
        const lastFetch = counts?.last_fetch
          ? new Date(counts.last_fetch as string | Date).toISOString().slice(0, 10)
          : "never";
        lines.push(
          `${row.institution_name} (${row.state_code ?? "?"}, #${row.id}): ${row.fee_schedule_url ? "fee schedule found" : "no fee schedule yet"}, last downloaded ${lastFetch}, ${counts?.published ?? 0} published fees.`,
        );
      }
      return {
        speaker,
        lines,
        links: rows.map((row) => ({ label: String(row.institution_name), href: `/admin/institution/${row.id}` })),
      };
    }
    default:
      return { speaker, lines: ["I didn't catch that."] };
  }
}

/** Carries out a confirmed write command. The caller re-parses the original text. */
export async function executeCrewWrite(command: CrewCommand, actor: string): Promise<CrewReply> {
  const speaker = titleCase(command.agent);
  switch (command.kind) {
    case "pause":
      await setPipelineEnabled(actor, false, `Paused from the crew command bar by ${actor}`);
      return { speaker, lines: ["Paused. Queued work will wait until you say resume."] };
    case "resume":
      await setPipelineEnabled(actor, true, `Resumed from the crew command bar by ${actor}`);
      return { speaker, lines: ["Resumed. The next tick picks the work back up."] };
    case "run": {
      const pipeline = await getPipelineControl();
      const pausedNote = pipeline.enabled ? [] : ["Note: the pipeline is paused, so this waits until you resume."];
      if (command.agent === "atlas") {
        if (command.scope.kind === "due") {
          const scheduled = await scheduleDueStateLaneRuns({ limit: 10, triggeredBy: actor });
          return {
            speaker,
            lines: [`Started ${scheduled.scheduled} state runs (${scheduled.reused} already running).`, ...pausedNote],
          };
        }
        if (command.scope.kind === "state") {
          const result = await startStateLaneRun({
            stateCode: command.scope.stateCode,
            triggeredBy: actor,
            triggerSource: "admin",
            source: "admin.state_lane",
          });
          return {
            speaker,
            runId: result.run.id,
            runReused: result.reused,
            links: [{ label: `Track run #${result.run.id}`, href: `/admin/atlas/runs/${result.run.id}` }],
            lines: [
              result.reused
                ? `${describeScope(command.scope)} is already running (run #${result.run.id}).`
                : `Queued ${describeScope(command.scope)} (run #${result.run.id}).`,
              ...pausedNote,
            ],
          };
        }
        const run = await startAgentRun({
          agent: "atlas",
          kind: "workflow",
          title: "Crew: full pipeline, all states",
          params: { source: "admin.crew_command" },
          triggeredBy: actor,
          triggerSource: "admin",
          idempotencyKey: `crew:atlas:all:${minuteBucket()}`,
          steps: STATE_LANE_STEPS.filter((step) => !step.key.startsWith("public-")),
        });
        return { speaker, runId: run.run.id, runReused: run.reused, links: [{ label: `Track run #${run.run.id}`, href: `/admin/atlas/runs/${run.run.id}` }], lines: [`Queued a full run across all states (run #${run.run.id}).`, ...pausedNote] };
      }
      const stateCode = command.scope.kind === "state" ? command.scope.stateCode : undefined;
      const institutionId = command.scope.kind === "institution" ? command.scope.institutionId : undefined;
      let institutionName: string | undefined;
      if (institutionId !== undefined) {
        if (command.agent !== "hamilton") {
          return { speaker, lines: ["Institution-only publication is available through Hamilton."] };
        }
        const [institution] = await sql`
          SELECT institution_name FROM institution_sources WHERE id = ${institutionId}
        `;
        if (!institution) return { speaker, lines: [`Institution #${institutionId} was not found. No run was created.`] };
        institutionName = String(institution.institution_name);
      }
      const scopeName = institutionId !== undefined
        ? `${institutionName} (#${institutionId})`
        : stateCode ? stateCode : "all states";
      const run = await startAgentRun({
        agent: command.agent,
        kind: "manual_repair",
        title: `Crew: ${speaker} for ${scopeName}`,
        stateCode,
        params: {
          source: "admin.crew_command",
          ...(stateCode ? { scope: "state", state_code: stateCode } : {}),
          ...(institutionId !== undefined ? { scope: "institution", institution_id: institutionId } : {}),
        },
        triggeredBy: actor,
        triggerSource: "admin",
        // Deduplicate active institution jobs, but permit a new one after completion.
        idempotencyKey: institutionId !== undefined
          ? `crew:${command.agent}:institution:${institutionId}:publish`
          : `crew:${command.agent}:${stateCode ?? "all"}:${minuteBucket()}`,
        steps: AGENT_RUN_STEPS[command.agent].map((step) => ({ ...step, agent: command.agent })),
      });
      return {
        speaker,
        runId: run.run.id,
        runReused: run.reused,
        links: [{ label: `Track run #${run.run.id}`, href: `/admin/atlas/runs/${run.run.id}` }],
        lines: [run.reused
          ? `Existing ${speaker} run #${run.run.id} for ${scopeName} reused.`
          : `Queued ${speaker} for ${scopeName} (run #${run.run.id}).`, ...pausedNote],
      };
    }
    case "retry": {
      const [failed] = await sql`
        SELECT r.id, r.state_code, s.step_key
          FROM agent_runs r
          JOIN agent_run_steps s ON s.agent_run_id = r.id
         WHERE r.status IN ('failed', 'blocked')
           AND s.status IN ('failed', 'blocked')
           AND s.agent_name = ${command.agent}
         ORDER BY r.updated_at DESC
         LIMIT 1
      `;
      if (!failed) return { speaker, lines: ["I don't have a failed job to retry."] };
      const stateCode = failed.state_code ? String(failed.state_code) : undefined;
      const stepKey = String(failed.step_key);
      const run = await startAgentRun({
        agent: command.agent,
        kind: "manual_repair",
        title: `Crew: retry ${stepKey}${stateCode ? ` for ${stateCode}` : ""} (from run #${failed.id})`,
        stateCode,
        params: { source: "admin.crew_command", retry_of_run_id: Number(failed.id), ...(stateCode ? { scope: "state", state_code: stateCode } : {}) },
        triggeredBy: actor,
        triggerSource: "admin",
        idempotencyKey: `crew:retry:${failed.id}:${stepKey}`,
        steps: [{ key: stepKey, agent: command.agent, title: `Retry ${stepKey}` }],
      });
      return { speaker, runId: run.run.id, runReused: run.reused, links: [{ label: `Track run #${run.run.id}`, href: `/admin/atlas/runs/${run.run.id}` }], lines: [`Queued retry of "${stepKey}" from run #${failed.id} (run #${run.run.id}).`] };
    }
    default:
      return answerCrewCommand(command, "");
  }
}
