# 2026-10-09: A publish hold does nothing for a row that went live before the hold deployed
**What happened:** the guard re-queue (PR 790) put nine rejected rows back to verified; the
02:05:33 UTC publish picked them up under PR 790's code, one minute before PR 797 (the publish
name holds) merged. Two went live wrong: 100439 (verified 56647, FL) "Courtesy Pay (Paid
Overdraft) Fee .. . . .$35.005" at $50, where $50 was the next cell's safe-deposit rent and the
fee is $35; 100434 (verified 8975, TN) "paper statement fee is waived if enrolled in
eStatements" at $5. UAT found both at 02:32. Ambler 51385 was still "to open the account. A
Maintenance Service Charge of": 1,347 institutions were due for retidy v6 at 40 a publish step,
Ambler 263rd in id order.
**Cause:** `publishNameHold` runs only on a verified row being published. A row already live has
no twin check, so a hold written after it went live never reads it. The deploy order (re-queue
before the hold) made the gap visible; it would have shown on any live row of the same shape.
**Fix:** eval verdict v4 (`hamilton/eval-verdicts.ts`) adds the live-row twin `price_in_name`
(name states a price that is not the amount: wrong_amount, archived after the 12h second look,
verified row rejected with the same flag, lesson in pipeline_feedback), shared with publish
through `priceInName`. The waiver-clause and cut-off names are retidy v6 shapes; the retidy batch
goes to 100 institutions a step so Ambler's rename lands within three steps. No hand edits.
**Lesson:** every publish-time hold needs a live-row reading in the eval check (or the retidy),
or a deploy that lands after a publish step leaves that step's rows wrong for good.
