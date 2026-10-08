-- The local competitors answer reads one institution's branches by institution_id. With no
-- index that was a scan of all 1.5M SOD rows, twice per answer (2.6 s and 1.6 s on prod,
-- pg_stat_statements, Oct 8). Index only: no data changes.
CREATE INDEX IF NOT EXISTS institution_branch_deposits_institution_year_idx
  ON public.institution_branch_deposits (institution_id, year);
