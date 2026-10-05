-- Hamilton reports name each institution's local competitors from the FDIC Summary
-- of Deposits: every institution with branches in the same counties (or, for credit
-- unions, the counties around the headquarters city). Without these indexes each
-- report scans all 1.5M branch rows (about 4 seconds on the current database).
CREATE INDEX IF NOT EXISTS institution_branch_deposits_county_year_idx
  ON public.institution_branch_deposits (county_fips, year);

CREATE INDEX IF NOT EXISTS institution_branch_deposits_state_city_year_idx
  ON public.institution_branch_deposits (state, upper(city), year);
