-- Which two published rows a recorded fee change compares, and whether they are like for like:
-- the same page (feePageKey) and not a page that lists the fee at both prices. Until 8 Oct
-- Hamilton publish recorded a "change" when one schedule's price superseded another schedule's
-- (a consumer disclosure against a business schedule), so readers count a change only when
-- like_for_like is true. Hamilton publish fills these for new changes and its pairing pass fills
-- older ones. Adds three nullable columns; changes no rows.
ALTER TABLE public.fee_change_records
  ADD COLUMN IF NOT EXISTS previous_fee_published_id bigint,
  ADD COLUMN IF NOT EXISTS new_fee_published_id bigint,
  ADD COLUMN IF NOT EXISTS like_for_like boolean;
