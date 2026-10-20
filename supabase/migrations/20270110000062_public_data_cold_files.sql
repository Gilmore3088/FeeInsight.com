-- Hoovie storage tiers (#1870, part of #1783): hot public data stays in Postgres, older periods
-- can be written to compressed files in the R2 bucket the document vault already uses.
--
-- One index row per cold file: which table, source and period it holds, where the file is, how
-- many rows it carries and the SHA-256 of its bytes. Readers (src/lib/data-catalog/cold-reads.ts)
-- read a period from its file only once `pruned_at` is set, i.e. once the hot rows are gone.
--
-- Data: schema only. Creates one new empty table and its index; changes, moves or deletes no
-- existing row. Nothing writes to it until the export switch in
-- src/lib/agents/hoovie/storage-tiers.ts (`COLD_EXPORT_LIVE`) is turned on by a later PR, and no
-- code prunes hot rows: pruning waits for James's separate yes. Re-running is safe.

CREATE TABLE IF NOT EXISTS public.public_data_cold_files (
  id BIGSERIAL PRIMARY KEY,
  -- The Postgres table the rows came from (institution_call_report_items today).
  table_name TEXT NOT NULL,
  -- The row source inside that table ('ffiec' or 'ncua' for call-report lines).
  source TEXT NOT NULL,
  -- The period the file holds, as the table keys it (report_date YYYY-MM-DD for call-report lines).
  period TEXT NOT NULL,
  -- Bucket and object key in R2.
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  -- 'jsonl.gz': gzip of a header line of column names, then one JSON array per row.
  format TEXT NOT NULL DEFAULT 'jsonl.gz',
  columns TEXT[] NOT NULL,
  row_count BIGINT NOT NULL CHECK (row_count >= 0),
  -- Compressed file size in bytes.
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  -- SHA-256 (hex) of the compressed bytes.
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Estimated Postgres bytes the same rows take (table average per row x row_count): what a prune would free.
  hot_bytes_estimate BIGINT,
  agent_run_id BIGINT,
  written_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when the file was read back and its checksum and row count matched.
  verified_at TIMESTAMPTZ,
  -- Set only after the hot rows were removed, which needs James's yes. Readers use the file only then.
  pruned_at TIMESTAMPTZ,
  CONSTRAINT public_data_cold_files_format_check CHECK (format IN ('jsonl.gz')),
  UNIQUE (table_name, source, period)
);

CREATE INDEX IF NOT EXISTS public_data_cold_files_pruned_idx
  ON public.public_data_cold_files (table_name, source, period)
  WHERE pruned_at IS NOT NULL;

ALTER TABLE public.public_data_cold_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_data_cold_files FROM PUBLIC, anon, authenticated;
