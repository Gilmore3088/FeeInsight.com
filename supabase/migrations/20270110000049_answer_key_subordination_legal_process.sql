-- James, 2026-10-15 02:59 UTC (#1026 comment 6183387204, item 1): subordination fees file as
-- legal_process, reversing the Oct 8 call. The answer-key seed (20270110000018, applied, not
-- edited) keys The Summit FCU's subordination fee under other_lending_fee; this aligns that one row.
--
-- Data: this CHANGES PRODUCTION DATA. Exactly one row: answer_key_fees id 1440 (answer-key
-- institution 4875, The Summit Federal Credit Union, "Mortgage Subordination Fee ... $125"),
-- canonical_key other_lending_fee -> legal_process. Every condition below must hold, so no other
-- row can change, and a database without that row changes nothing.
-- Reverse: UPDATE public.answer_key_fees SET canonical_key = 'other_lending_fee', updated_at = NOW()
--          WHERE id = 1440 AND canonical_key = 'legal_process';
UPDATE public.answer_key_fees f
   SET canonical_key = 'legal_process',
       updated_at = NOW()
  FROM public.answer_key_institutions ak
 WHERE f.id = 1440
   AND f.answer_key_institution_id = ak.id
   AND ak.institution_id = 4875
   AND f.canonical_key = 'other_lending_fee'
   AND f.amount = 125
   AND f.source_line ILIKE '%Mortgage Subordination Fee%';
