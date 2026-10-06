-- Report requests now record their institution on arrival (leads.quote_institution_id), so
-- Magellan can put requesters' institutions first (PR 274). This fills it for the one existing
-- request where the match is certain: lead 17, "Banner Bank", whose request came from Banner
-- Bank's own profile page (use_case "institution_id=117; src=profile").
-- Left alone on purpose: lead 14 ("First National Bank", no id, many banks share the name),
-- lead 15 (typed name "Ifrstbakfn"; its id 5536 came from an alerts signup, not the request),
-- lead 7 (its id came from a page capture and names a different institution than the company),
-- and lead 18 (an end-to-end test).
-- CHANGES DATA: at most one row, only while it is still unset and unpaid.

UPDATE leads
SET quote_institution_id = 117
WHERE id = 17
  AND company = 'Banner Bank'
  AND quote_institution_id IS NULL
  AND paid_at IS NULL
  AND EXISTS (SELECT 1 FROM institution_sources WHERE id = 117 AND institution_name = 'Banner Bank');
