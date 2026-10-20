import { incurredProviderUsageSql } from "@/lib/provider-usage-accounting";
import { sql } from "@/lib/data-store/connection";

export interface ApiTrustOverview {
  schemaReady: boolean;
  automation: {
    enabled: boolean | null;
    reason: string | null;
    changedAt: string | null;
  };
  spend: {
    todayMicrousd: number;
    sevenDayMicrousd: number;
    monthMicrousd: number;
  };
  policy: {
    total: number;
    enabled: number;
    disabled: number;
    missingCaps: number;
    providerReady: boolean;
  };
  counts: {
    blockedToday: number;
    failedToday: number;
    providerCallsToday: number;
    routeHitsToday: number;
  };
  latestProviderFailure: {
    routeId: string | null;
    agentName: string | null;
    operation: string | null;
    error: string | null;
    createdAt: string | null;
  } | null;
  topRoutes: Array<{
    routeId: string;
    hits: number;
    blocked: number;
    failed: number;
  }>;
  topSubjects: Array<{
    subjectKey: string;
    hits: number;
    blocked: number;
  }>;
  blocker: string | null;
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getApiTrustOverview(): Promise<ApiTrustOverview> {
  try {
    const [
      automationRows,
      spendRows,
      policyRows,
      countRows,
      failureRows,
      topRouteRows,
      topSubjectRows,
    ] = await Promise.all([
      sql`
        SELECT enabled, reason, changed_at
          FROM public.automation_control
         WHERE control_key = 'global'
         LIMIT 1
      `,
      sql`
        SELECT
          COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', NOW()) THEN COALESCE(estimated_cost_microusd, 0) ELSE 0 END), 0)::bigint AS today,
          COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN COALESCE(estimated_cost_microusd, 0) ELSE 0 END), 0)::bigint AS seven_day,
          COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', NOW()) THEN COALESCE(estimated_cost_microusd, 0) ELSE 0 END), 0)::bigint AS month
        FROM public.ai_api_usage_events
       WHERE ${incurredProviderUsageSql(sql)}
      `,
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE enabled)::int AS enabled,
          COUNT(*) FILTER (WHERE NOT enabled)::int AS disabled,
          COUNT(*) FILTER (
            WHERE enabled
              AND hard_daily_microusd IS NULL
              AND hard_monthly_microusd IS NULL
              AND max_provider_calls_per_run IS NULL
              AND max_provider_calls_per_tick IS NULL
              AND max_estimated_cost_per_run_microusd IS NULL
              AND max_estimated_cost_per_tick_microusd IS NULL
          )::int AS missing_caps,
          BOOL_OR(policy_key = 'global:provider:default' AND enabled AND hard_daily_microusd IS NOT NULL AND hard_monthly_microusd IS NOT NULL) AS global_ready,
          BOOL_OR(policy_key = 'route:api.admin.agents.tick' AND enabled AND max_provider_calls_per_tick IS NOT NULL AND max_estimated_cost_per_tick_microusd IS NOT NULL) AS tick_ready
        FROM public.api_budget_policies
      `,
      sql`
        SELECT
          (SELECT COUNT(*)::int
             FROM public.api_route_audit_events
            WHERE outcome = 'blocked'
              AND created_at >= date_trunc('day', NOW())) AS blocked_today,
          (SELECT COUNT(*)::int
             FROM public.api_route_audit_events
            WHERE outcome = 'error'
              AND created_at >= date_trunc('day', NOW())) AS failed_today,
          (SELECT COALESCE(SUM(request_count), 0)::int
             FROM public.ai_api_usage_events
            WHERE ${incurredProviderUsageSql(sql)}
              AND created_at >= date_trunc('day', NOW())) AS provider_calls_today,
          (SELECT COUNT(*)::int
             FROM public.api_route_audit_events
            WHERE created_at >= date_trunc('day', NOW())) AS route_hits_today
      `,
      sql`
        SELECT route_id, agent_name, operation, error_summary, created_at
          FROM public.ai_api_usage_events
         WHERE status = 'failed'
         ORDER BY created_at DESC
         LIMIT 1
      `,
      sql`
        SELECT route_id,
               COUNT(*)::int AS hits,
               COUNT(*) FILTER (WHERE outcome = 'blocked')::int AS blocked,
               COUNT(*) FILTER (WHERE outcome = 'error')::int AS failed
          FROM public.api_route_audit_events
         WHERE created_at >= NOW() - INTERVAL '7 days'
         GROUP BY route_id
         ORDER BY hits DESC
         LIMIT 10
      `,
      sql`
        SELECT COALESCE(subject_key, 'unknown') AS subject_key,
               COUNT(*)::int AS hits,
               COUNT(*) FILTER (WHERE outcome = 'blocked')::int AS blocked
          FROM public.api_route_audit_events
         WHERE created_at >= NOW() - INTERVAL '7 days'
         GROUP BY COALESCE(subject_key, 'unknown')
         ORDER BY hits DESC
         LIMIT 10
      `,
    ]);

    const automation = automationRows[0];
    const spend = spendRows[0] ?? {};
    const policy = policyRows[0] ?? {};
    const counts = countRows[0] ?? {};
    const globalReady = Boolean(policy.global_ready);
    const tickReady = Boolean(policy.tick_ready);
    const providerReady = globalReady && tickReady && number(policy.missing_caps) === 0;

    return {
      schemaReady: true,
      automation: {
        enabled: automation?.enabled === null || automation?.enabled === undefined
          ? null
          : Boolean(automation.enabled),
        reason: automation?.reason ? String(automation.reason) : null,
        changedAt: iso(automation?.changed_at),
      },
      spend: {
        todayMicrousd: number(spend.today),
        sevenDayMicrousd: number(spend.seven_day),
        monthMicrousd: number(spend.month),
      },
      policy: {
        total: number(policy.total),
        enabled: number(policy.enabled),
        disabled: number(policy.disabled),
        missingCaps: number(policy.missing_caps),
        providerReady,
      },
      counts: {
        blockedToday: number(counts.blocked_today),
        failedToday: number(counts.failed_today),
        providerCallsToday: number(counts.provider_calls_today),
        routeHitsToday: number(counts.route_hits_today),
      },
      latestProviderFailure: failureRows[0]
        ? {
            routeId: failureRows[0].route_id ? String(failureRows[0].route_id) : null,
            agentName: failureRows[0].agent_name ? String(failureRows[0].agent_name) : null,
            operation: failureRows[0].operation ? String(failureRows[0].operation) : null,
            error: failureRows[0].error_summary ? String(failureRows[0].error_summary) : null,
            createdAt: iso(failureRows[0].created_at),
          }
        : null,
      topRoutes: topRouteRows.map((row) => ({
        routeId: String(row.route_id),
        hits: number(row.hits),
        blocked: number(row.blocked),
        failed: number(row.failed),
      })),
      topSubjects: topSubjectRows.map((row) => ({
        subjectKey: String(row.subject_key),
        hits: number(row.hits),
        blocked: number(row.blocked),
      })),
      blocker: providerReady
        ? null
        : "Automation cannot resume until global provider caps and cron tick caps are enabled.",
    };
  } catch (error) {
    return {
      schemaReady: false,
      automation: { enabled: null, reason: null, changedAt: null },
      spend: { todayMicrousd: 0, sevenDayMicrousd: 0, monthMicrousd: 0 },
      policy: { total: 0, enabled: 0, disabled: 0, missingCaps: 0, providerReady: false },
      counts: { blockedToday: 0, failedToday: 0, providerCallsToday: 0, routeHitsToday: 0 },
      latestProviderFailure: null,
      topRoutes: [],
      topSubjects: [],
      blocker: error instanceof Error ? error.message : "API trust schema is unavailable.",
    };
  }
}
