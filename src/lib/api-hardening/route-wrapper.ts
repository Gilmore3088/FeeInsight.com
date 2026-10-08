import { getApiRoutePolicy } from "./policies";
import { getRequestSubjectKey, recordApiRouteAuditEvent, type ApiAuditOutcome } from "./audit";
import { isRateLimited } from "./rate-limit";

type RouteHandler<TArgs extends unknown[]> = (...args: TArgs) => Promise<Response> | Response;

function findRequest(args: unknown[]): Request | undefined {
  return args.find((arg): arg is Request => arg instanceof Request);
}

function outcomeForStatus(status: number): ApiAuditOutcome {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 423) return "blocked";
  if (status >= 500) return "error";
  return "success";
}

export function withApiRoutePolicy<TArgs extends unknown[]>(
  routeId: string,
  method: string,
  handler: RouteHandler<TArgs>,
): RouteHandler<TArgs> {
  const policy = getApiRoutePolicy(routeId);
  const wrapped = async (...args: TArgs): Promise<Response> => {
    const startedAt = Date.now();
    const request = findRequest(args);
    const subjectKey = getRequestSubjectKey(request);

    if (await isRateLimited(policy, subjectKey)) {
      await recordApiRouteAuditEvent({
        policy,
        request,
        method,
        statusCode: 429,
        outcome: "rate_limited",
        startedAt,
        subjectKey,
        reasonCode: "rate_limit_exceeded",
      }).catch(() => {});
      return Response.json(
        { error: "Too many requests. Please wait a few minutes and try again." },
        { status: 429, headers: { "Retry-After": "600" } },
      );
    }

    try {
      const response = await handler(...args);
      recordApiRouteAuditEvent({
        policy,
        request,
        method,
        statusCode: response.status,
        outcome: outcomeForStatus(response.status),
        startedAt,
        subjectKey,
        metadata: requestShape(request),
      }).catch(() => {});
      return response;
    } catch (error) {
      recordApiRouteAuditEvent({
        policy,
        request,
        method,
        statusCode: 500,
        outcome: "error",
        startedAt,
        subjectKey,
        reasonCode: "route_handler_exception",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => {});
      throw error;
    }
  };

  return wrapped;
}

/**
 * The request's view and format (e.g. view=benchmark&format=csv), so the ledger shows which
 * export was served. Only these two named, non-identifying parameters are kept.
 */
export function requestShape(request: Request | undefined): Record<string, string> {
  if (!request) return {};
  try {
    const params = new URL(request.url).searchParams;
    const shape: Record<string, string> = {};
    for (const key of ["view", "format"]) {
      const value = params.get(key);
      if (value && /^[a-z_]{1,32}$/.test(value)) shape[key] = value;
    }
    return shape;
  } catch {
    return {};
  }
}
