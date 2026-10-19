import { blockedHost, RegistryHttpError, redactRegistrySecrets } from "@/lib/regulatory/http";
import type { RegistryDb } from "./partitions";

/** Finish only this run's outstanding claim; a late worker cannot overwrite a newer owner. */
export async function recordRegistryFailure(db: RegistryDb, input: {
  source: string;
  partitionKey: string;
  runId: number;
  error: unknown;
}): Promise<{ blocked: boolean; message: string; recorded: boolean }> {
  const refused = blockedHost(input.error);
  const status = input.error instanceof RegistryHttpError ? input.error.status : null;
  const permanent = status != null && status >= 400 && status < 500 && ![408,425,429].includes(status);
  const hours = refused ? 168 : permanent ? 24 : 6;
  const message = redactRegistrySecrets(input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 2000);
  const sourceUrl = input.error instanceof RegistryHttpError ? redactRegistrySecrets(input.error.url) : null;
  const detail = {
    failure_receipt_version: 1,
    failure_kind: refused ? "publisher_refused" : permanent ? "invalid_request_or_missing_file" : "transport_or_parser",
    http_status: status,
    ...(refused ? { missing_source: { ...refused, url: sourceUrl, second_host: null } } : {}),
  };
  const rows = await db`
    INSERT INTO registry_ingest_partitions
      (source,partition_key,status,attempts,row_count,source_url,agent_run_id,last_error,detail,
       next_attempt_after,fetched_at,updated_at)
    VALUES (${input.source},${input.partitionKey},${refused ? "empty" : "failed"},1,0,${sourceUrl},
      ${input.runId},${message},${JSON.stringify(detail)}::jsonb,NOW()+${hours}*INTERVAL '1 hour',NOW(),NOW())
    ON CONFLICT (source,partition_key) DO UPDATE SET
      status=EXCLUDED.status, last_error=EXCLUDED.last_error,
      source_url=COALESCE(EXCLUDED.source_url,registry_ingest_partitions.source_url),
      agent_run_id=EXCLUDED.agent_run_id,
      detail=COALESCE(registry_ingest_partitions.detail,'{}'::jsonb) || EXCLUDED.detail
        || jsonb_build_object('parser_version',COALESCE(
          registry_ingest_partitions.detail->'claimed_parser_version',
          registry_ingest_partitions.detail->'parser_version')),
      next_attempt_after=GREATEST(registry_ingest_partitions.next_attempt_after,EXCLUDED.next_attempt_after),
      fetched_at=EXCLUDED.fetched_at,updated_at=NOW()
    WHERE registry_ingest_partitions.status='scheduled'
      AND (registry_ingest_partitions.agent_run_id=EXCLUDED.agent_run_id
           OR registry_ingest_partitions.agent_run_id IS NULL)
    RETURNING id
  `;
  return { blocked: Boolean(refused), message, recorded: rows.length > 0 };
}
