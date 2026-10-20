-- Public city, state and market pages ask for the latest Summary of Deposits year with
-- MAX(year), or filter on year = (SELECT MAX(year) ...). No index leads with year, so each
-- call scanned all 1.5M SOD rows: about 65,000 s of DB time over 14 days at 0.6-0.9 s a
-- call (pg_stat_statements, Oct 19 read-only review). An index on year turns MAX(year) into
-- one index probe for every caller. Index only: no data changes. The table is written only
-- by the yearly SOD import, so the build's brief write lock blocks nothing in practice.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS institution_branch_deposits_year_idx
  ON public.institution_branch_deposits (year);
