/**
 * Snapshot page events and outreach outcomes (migration 20270110000029). No personal data in
 * either: see src/lib/outreach-journey.ts.
 */

import {
  type BuyerLog,
  journeyFunnel,
  journeyStage,
  type JourneyStage,
  type OutreachOutcome,
  type SnapshotEvent,
  type SnapshotEventInput,
} from "@/lib/outreach-journey";
import { sql } from "./connection";

type SqlTag = typeof sql;

export async function journeySchemaReady(db: SqlTag = sql): Promise<boolean> {
  const [row] = await db`
    SELECT to_regclass('public.snapshot_events') IS NOT NULL
       AND to_regclass('public.outreach_outcomes') IS NOT NULL AS ready
  `;
  return row?.ready === true;
}

export async function insertSnapshotEvent(event: SnapshotEventInput, db: SqlTag = sql): Promise<void> {
  await db`
    INSERT INTO snapshot_events (institution_id, event, detail, utm_campaign, utm_content)
    VALUES (${event.institutionId}, ${event.event}, ${event.detail}, ${event.utmCampaign}, ${event.utmContent})
  `;
}

export async function recordOutreachOutcome(
  input: {
    draftId: number | null;
    institutionId: number;
    outcome: OutreachOutcome;
    note: string | null;
    answers?: BuyerLog | null;
    recordedBy: string;
  },
  db: SqlTag = sql,
): Promise<void> {
  const answers = input.answers ? JSON.stringify(input.answers) : null;
  await db`
    INSERT INTO outreach_outcomes (draft_id, institution_id, outcome, note, answers, recorded_by)
    VALUES (${input.draftId}, ${input.institutionId}, ${input.outcome}, ${input.note}, ${answers}::jsonb, ${input.recordedBy})
  `;
}

export interface OutreachJourney {
  institutionId: number;
  stage: JourneyStage | null;
  outcomes: Array<{ outcome: OutreachOutcome; note: string | null; at: string }>;
  events: number;
}

/** Each institution's journey since outreach started, from its snapshot events and outcomes. */
export async function listOutreachJourneys(campaign: string, db: SqlTag = sql): Promise<OutreachJourney[]> {
  const [events, outcomes] = await Promise.all([
    db`SELECT institution_id, event FROM snapshot_events WHERE utm_campaign = ${campaign}`,
    db`SELECT institution_id, outcome, note, created_at FROM outreach_outcomes ORDER BY created_at`,
  ]);
  const byInstitution = new Map<number, { events: SnapshotEvent[]; outcomes: OutreachJourney["outcomes"] }>();
  const entry = (id: number) => {
    let found = byInstitution.get(id);
    if (!found) {
      found = { events: [], outcomes: [] };
      byInstitution.set(id, found);
    }
    return found;
  };
  for (const row of events) entry(Number(row.institution_id)).events.push(row.event as SnapshotEvent);
  for (const row of outcomes) {
    entry(Number(row.institution_id)).outcomes.push({
      outcome: row.outcome as OutreachOutcome,
      note: row.note === null ? null : String(row.note),
      at: new Date(row.created_at as string).toISOString(),
    });
  }
  return [...byInstitution.entries()].map(([institutionId, value]) => ({
    institutionId,
    stage: journeyStage(value.events, value.outcomes.map((item) => item.outcome)),
    outcomes: value.outcomes,
    events: value.events.length,
  }));
}

/**
 * One institution's journey between two times: its snapshot page events from the outreach link
 * (`utm_campaign`) and the outcomes recorded for it. Read by the weekly score.
 */
export async function journeyForInstitution(
  institutionId: number,
  campaign: string,
  from: Date,
  to: Date,
  db: SqlTag = sql,
): Promise<{ events: SnapshotEvent[]; outcomes: OutreachOutcome[] }> {
  const [events, outcomes] = await Promise.all([
    db`SELECT event FROM snapshot_events
        WHERE institution_id = ${institutionId} AND utm_campaign = ${campaign}
          AND created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}`,
    db`SELECT outcome FROM outreach_outcomes
        WHERE institution_id = ${institutionId}
          AND created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}`,
  ]);
  return {
    events: events.map((row) => row.event as SnapshotEvent),
    outcomes: outcomes.map((row) => row.outcome as OutreachOutcome),
  };
}

/** The five-stage funnel for the Growth page. */
export async function outreachFunnel(campaign: string, db: SqlTag = sql) {
  if (!(await journeySchemaReady(db))) return null;
  const journeys = await listOutreachJourneys(campaign, db);
  return journeyFunnel(journeys.map((journey) => journey.stage));
}
