import { createHash } from "node:crypto";
import { sql } from "@/lib/data-store/connection";
import type { ReferenceKeySnapshot } from "@/lib/data-store/answer-key-eligibility";
import type { AnswerKeyAmountKind } from "@/lib/data-store/answer-key";
import { distinctPredictions, predictionMatches, type PipelineFee } from "@/lib/agents/answer-key-score";
import { inSavepoint } from "@/lib/agents/savepoint";
import {
  FIXED_COHORT_FROZEN_AT, FIXED_COHORT_EVENT, FIXED_COHORT_ID, FIXED_COHORT_PROTOCOL, FIXED_COHORT_SCORER_VERSION,
  summarizeFixedCohort, type CohortInstitutionScore, type FixedCohortScore, type UnscoredReason,
} from "./fixed-cohort-history";
export * from "./fixed-cohort-history";

/**
 * The fixed answer-key cohort (2026-11-02): one accuracy number a day on the same institutions,
 * scored the same way, so a day-over-day move is the pipeline's and not the cohort's.
 *
 * The answer-key score (`answer-key-score.ts`) scores only the keys whose reference passed that
 * day's live re-check (`answer-key-eligibility.ts`). That check depends on the bank's site that
 * day, so its cohort moves: 1 of 62 institutions on Nov 1, 8 of 62 (213 of 2,276 fees) on Nov 2.
 * This cohort is the 62 confirmed answer keys as they stood on Nov 2, frozen here by id and by a
 * fingerprint of each key's scored content. Every one of the 62 key documents was held byte for
 * byte (`source_documents.content_hash`) on Nov 2.
 *
 * Scored every day, by protocol 1:
 *   - expected: each confirmed, mapped key fee (canonical key + amount kind), the key as confirmed;
 *   - live: the institution's distinct (category, amount) rows in `published_fee_catalog` and its
 *     (category, rate) rows in `published_fee_rate_catalog`, whatever document they were read from:
 *     what a reader sees for that institution;
 *   - match: answer-key scorer v3's rule (`predictionMatches`: same category, amount within one
 *     cent, "free" is $0, "varies" takes any amount, a rate matches only a "varies" fee);
 *   - precision: live predictions that match a key fee / live predictions;
 *   - recall: key fees with a matching live prediction / key fees.
 * An institution with no live fees is scored (its key fees count as missed). An institution that
 * cannot be scored on a day (its key was edited or removed, or the read failed) is counted as
 * unscored with its reason, never dropped. The list changes only when James says so: a new
 * cohort is a new `FIXED_COHORT_ID`, never an edit of this one.
 */

export interface FrozenCohortKey { answerKeyId: number; institutionId: number; fees: number; fingerprint: string }

/** [answer key id, institution id, mapped confirmed fees, fingerprint], read from prod on Nov 2 2026. */
const FROZEN: ReadonlyArray<readonly [number, number, number, string]> = [
  [5, 61, 37, "39309661ace81d082f257deb6b20df1d264c1c5603939846f3a6e800641cfadb"],
  [6, 69, 27, "e461b5f4e6376d29250b6573104334a52956a472c3ba560dd9f30a109407ac58"],
  [8, 80, 50, "36900080a89a95c1b1fbe160a94bbb101518c28beb4409d446952d30823df691"],
  [10, 115, 63, "03db2f9d0372171684ec143bcbff834eff7378e637d00b062f0eb450e0dc0085"],
  [12, 156, 14, "2e06e30d8029351f373021cb52deb41630ad689723cd77781c9336d340380ee8"],
  [13, 160, 41, "504536b586071f2175a2740655a5a3eabbed3e876014e7329fcb561de9ad5a0e"],
  [15, 268, 33, "ac8200b34ded6e98d10e144fae7577a13fc8bc557a9290658be9ca26f9b968ed"],
  [17, 302, 36, "7776ccea368f533b0e7f7721426f15c8c2cc5407344f7598e465b05080e15d72"],
  [18, 316, 39, "c82fcfeaed1d6e22fb8a27770c17515eb5b1cb9b8ebbfb040817d70bf2bbca29"],
  [19, 321, 27, "3099a988107fa31ca0466fbba4589386f10347c8ba7d638a43eb996e08d641aa"],
  [20, 359, 11, "dcdad865e11ead65825864dc79b26210e6a244c703146c8bdf86df9a31090a2b"],
  [22, 395, 34, "400fbe91004e9f9f99ebe2cfd823d54328e12b4e97f47f4c3b9ded571c7166d0"],
  [23, 408, 20, "d47736b49e684727e1420f27fa402c687deca28c13532097ee50c34d9eff1b39"],
  [24, 458, 59, "c4e1df697e7758e3ed59ccdbe03ef9bda798662abbabf569ae8329c870305da8"],
  [26, 734, 24, "6562836016ad1003253155f200c0344e48c2fd3f804ff9c33c02a4f8de2eaa98"],
  [30, 1175, 46, "8d23e0b183cba6f37f121c8a2d9e14a92133088fb743a6245bc3d9f319a5092d"],
  [32, 1390, 42, "1920e0ca999a2c15ebd11b83a8e49c4ac62583cb9549fd95b1b0646df31191fd"],
  [34, 1552, 24, "df417a4b65d03c2bd06ac9ff3e621139fba3a573e9152f3655f754ca4295147e"],
  [37, 1741, 44, "f7c14f62d03ed3a565db266098acb050f8435475e060fca115c67e975ab26dfc"],
  [39, 1987, 51, "e98f76120f4c1578a21d49f94eebf1ed0ac3affe2a1990030a82a1e79424239e"],
  [41, 2267, 32, "72477114e132d4ed8fe981cd43f055c13cd9bae4dcdb51ec1f29b6a7c6fbe59a"],
  [43, 2694, 28, "32e1c56b72228d70b231777172271bc1cc7a688a9c42ec6fa812fc04d43a5e35"],
  [49, 4248, 26, "a849da6631957efba088f37001abd71decaecf923d9e4a82e8f36b4bc5b3e23c"],
  [51, 4600, 38, "9e3f0e70030dfb372ea9313de184966a4c67aa35fa626713f8f61614a3df40ae"],
  [53, 4638, 45, "d0bbbb55aa6c906c28263cec5ab69ef286fd27aea956c5c6a46eed6f33bccd45"],
  [56, 4770, 49, "dd97a1687962ff12fb089f959ef79e5aa3a5276cb69b131a96a63363d42c6e2c"],
  [58, 4875, 37, "bcdb5f1b5ff731f6fa23eba2346b741487c31cbee5064757fea7c920ebd6b4c5"],
  [59, 4888, 27, "dee829d7cae742a5b41233298f47b628503cb498c9ec79bcb67bcaf8b8258ac7"],
  [60, 4937, 36, "51cce95c8f210918fddd2dff17d5f45e3a502c3f3cd78985a84c8426611278c9"],
  [63, 5107, 34, "29188fda42637a428fd0c6439b4d65507401539e0c435f1bd1c4fbd4d27e77a3"],
  [64, 5226, 27, "8f0845741722324659780de167ddd0c9a21e3757880ded82d5a995a73ec8a2a8"],
  [66, 5410, 17, "7f3c5e19e88c5eec0e4bd75a3cbf151c2bf37e4df9ada84547668ab86f9e89bf"],
  [68, 5594, 35, "71a3f40b2b30db19216c4b57cf21338c56357220b47378da5a236a9f3e176453"],
  [69, 5643, 22, "bccd193185ad9ba29a875f9554665ba9cc2aa7177e52a93745ff0e63119e913d"],
  [70, 5824, 35, "ee717cb2fe9aa27d9cd76ea178ffb38d419f7554ae1efbf941791aff3840b6fa"],
  [73, 5975, 40, "f3539a31b391fce66b63f41789615765e8de31e238084b6d22934b7b77d59a75"],
  [74, 6109, 37, "80f6d4e70f5032eff721ba69d4c67f51dae1de3f8a6c65801036cb075eb34f31"],
  [79, 6808, 47, "c14a0196d88df46a3cd955c5c60cbda960272009debd985dcd6b12a7665d1c30"],
  [80, 6834, 42, "ab62f26b1eb2c780ba8cb7d6438ae73d55b0b45a0b9c8d3832644b7bee4b5c53"],
  [81, 7088, 53, "30a913cf1d2d2cae479c08c51f6ac2000dcb0e1df08ec7dce82133d25410a034"],
  [82, 7114, 52, "7dedd97ade19f20c2cb45cc0df30bb0fe110f03fb4997941a0e8b5f4424f43e6"],
  [83, 7170, 26, "0210f2fed0d05b53d7a2fa156dbd7669616eb43fe81274b5f32cd0d4d607fe4c"],
  [84, 7217, 32, "f127fc9477c0f2134f8c4051c26e8a34d39874b07056374b488872b8a141aa02"],
  [85, 7229, 23, "b2f6416db6e63ff08e622a161d93e697456aa65103427ebe4ebb27c8732a7f13"],
  [86, 7273, 33, "f3808bb325ea2ea5298b87ecbce125b5c3901505d795720cc33e1ed9db950f19"],
  [87, 7288, 48, "8ad13d2dff760833e8178e9dbcbd669d9ed83ea6b3d700b91a4e6e1ed097b249"],
  [88, 7346, 42, "ecc37b25ff777f6f9845e4d6452330936024d342d71617f9a73217cbd24c324f"],
  [90, 7526, 30, "b341e59b420492d6081f6e16cb76865c0c229e68f7ce2f039ba191fac08b369f"],
  [96, 7723, 29, "ea10dcb51b1bcb5c2d125608b065606e5f74fbcf6285d8b321e2b33095645187"],
  [98, 7815, 14, "b810a92d2685cd0efd9f9e228e7a3a25bb57605f56b56f412b0c30474810be74"],
  [101, 7902, 57, "b748d3c5c5823963d65552a63f2bbf3cd8a8a8834ba984802945c18b433db96c"],
  [103, 8162, 71, "0d53a412cd70abdba15495e3b85a26d5fec19a10489cf35554ca9c4f2d25df3b"],
  [104, 8197, 23, "612ed3609b64cce28a7a093aada2f87015b8eefdf470961c63bae411e145ba8a"],
  [105, 8299, 56, "faefaad3bf5ebf189269f0f3225c33c0f59e281366d3eadc2383ee87dc7f7d06"],
  [107, 8448, 65, "f513d9cca658aa994f231cfe464b65b0620bceb9b1d04fe26015cc23bc0f457f"],
  [108, 8459, 9, "d644770902b3d67e6ce287eb10635f3f78eb85fbad48e49fe90cf1ce5d05f5d4"],
  [109, 8466, 39, "23b03bb150f23f9f4815aecd8f96f4c5edf8db1b1dcb2a6653d91bb6b388a1bb"],
  [111, 8556, 31, "a9180b104ef7796601b9a0e30db7674b06695204cf450671a24ab4d8bba529ea"],
  [112, 8565, 40, "71f684045eff2e9bd4f918d2772ad54e72ef2a57c17d9832f191b6a32577be2e"],
  [113, 8569, 39, "45f3002e1fdf7d63c591c86d3b18b6f0891d70eba654796864e00235664273aa"],
  [114, 8594, 35, "57c7637f89255c0fb8b1d3a8d7c67ee1685e4ab34975713b6ffb8ab0ffa54b8d"],
  [117, 8625, 53, "1e6d21bd6d254d1d2017ecf1f006fc2a9be631cec00d88e69b594d1c08cd9b83"],
];

export const FIXED_ANSWER_KEY_COHORT: readonly FrozenCohortKey[] = FROZEN.map(([answerKeyId, institutionId, fees, fingerprint]) => ({ answerKeyId, institutionId, fees, fingerprint }));

type KeyContent = Pick<ReferenceKeySnapshot, "answerKeyId" | "institutionId" | "contentHash" | "status"> & {
  fees: Array<Pick<ReferenceKeySnapshot["fees"][number], "id" | "canonicalKey" | "amount" | "amountKind" | "status">>;
};

const scoredFees = (key: KeyContent) => key.fees.filter((fee) => fee.status === "confirmed" && fee.canonicalKey !== "unmapped");

/**
 * The key content the score depends on: its document bytes and each scored fee's id, category,
 * amount in cents and amount kind. Equal to the read-only SQL in the 2026-11-02 finding:
 * sha256 of `fixed-answer-key-cohort@1|<key id>|<institution id>|<content hash>` and one
 * `<fee id>|<category>|<cents>|<kind>` line per fee in id order, joined by newlines.
 */
export function cohortKeyFingerprint(key: KeyContent): string {
  const lines = [...scoredFees(key)].sort((a, b) => a.id - b.id)
    .map((fee) => `${fee.id}|${fee.canonicalKey}|${fee.amount == null ? "" : Math.round(fee.amount * 100)}|${fee.amountKind}`);
  const text = [`fixed-answer-key-cohort@${FIXED_COHORT_PROTOCOL}|${key.answerKeyId}|${key.institutionId}|${key.contentHash ?? ""}`, ...lines].join("\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : null);

/**
 * Pure. `keys` is every confirmed answer key read today (null when the read failed); `live` holds
 * each institution's live fees (null when that read failed). Every frozen institution appears in
 * the result, scored or unscored with its reason.
 */
export function scoreFixedCohort(
  keys: KeyContent[] | null,
  live: Map<number, PipelineFee[]> | null,
  at: string,
  cohort: readonly FrozenCohortKey[] = FIXED_ANSWER_KEY_COHORT,
): FixedCohortScore {
  const byId = new Map((keys ?? []).map((key) => [key.answerKeyId, key]));
  const frozen = new Set(cohort.map((row) => row.answerKeyId));
  const institutions: CohortInstitutionScore[] = cohort.map((row) => {
    const base = { answerKeyId: row.answerKeyId, institutionId: row.institutionId, expected: 0, predicted: 0, matched: 0, correct: 0 };
    if (!keys || !live) return { ...base, state: "unscored", reason: "read_failed" };
    const key = byId.get(row.answerKeyId);
    if (!key || key.status !== "confirmed" || key.institutionId !== row.institutionId) return { ...base, state: "unscored", reason: "key_missing" };
    if (cohortKeyFingerprint(key) !== row.fingerprint) return { ...base, state: "unscored", reason: "key_changed" };
    const expected = scoredFees(key).map((fee) => ({ canonicalKey: fee.canonicalKey, amount: fee.amount, amountKind: fee.amountKind as AnswerKeyAmountKind }));
    const predictions = distinctPredictions(live.get(row.institutionId) ?? []);
    return {
      ...base,
      state: "scored",
      expected: expected.length,
      predicted: predictions.length,
      matched: expected.filter((fee) => predictions.some((prediction) => predictionMatches(fee, prediction))).length,
      correct: predictions.filter((prediction) => expected.some((fee) => predictionMatches(fee, prediction))).length,
    };
  });
  const scored = institutions.filter((row) => row.state === "scored");
  const sum = (field: "expected" | "predicted" | "matched" | "correct") => scored.reduce((total, row) => total + row[field], 0);
  const unscoredByReason: Partial<Record<UnscoredReason, number>> = {};
  for (const row of institutions) if (row.reason) unscoredByReason[row.reason] = (unscoredByReason[row.reason] ?? 0) + 1;
  const [expected, predicted, matched, correct] = [sum("expected"), sum("predicted"), sum("matched"), sum("correct")];
  return {
    protocol: FIXED_COHORT_PROTOCOL, cohortId: FIXED_COHORT_ID, frozenAt: FIXED_COHORT_FROZEN_AT, scorerVersion: FIXED_COHORT_SCORER_VERSION, at,
    cohortSize: cohort.length, scored: scored.length, unscored: cohort.length - scored.length, unscoredByReason,
    cohortFees: cohort.reduce((total, row) => total + row.fees, 0),
    expected, matched, predicted, correct, precision: ratio(correct, predicted), recall: ratio(matched, expected),
    noLiveFees: scored.filter((row) => row.predicted === 0).length,
    notInCohort: (keys ?? []).filter((key) => key.status === "confirmed" && !frozen.has(key.answerKeyId)).length,
    institutions,
  };
}

type SqlTag = typeof sql;

/** Each cohort institution's live dollar and rate fees. Read-only. */
export async function readCohortLiveFees(db: SqlTag, institutionIds: number[]): Promise<Map<number, PipelineFee[]>> {
  const live = new Map<number, PipelineFee[]>(institutionIds.map((id) => [id, []]));
  const [dollars, rates] = await Promise.all([
    db<Array<{ institution_id: number | string; canonical_fee_key: string | null; amount: number | string | null }>>`
      SELECT institution_id, canonical_fee_key, amount FROM published_fee_catalog WHERE institution_id = ANY(${institutionIds}::int[])`,
    db<Array<{ institution_id: number | string; canonical_fee_key: string | null; rate_percent: number | string }>>`
      SELECT institution_id, canonical_fee_key, rate_percent FROM published_fee_rate_catalog
       WHERE institution_id = ANY(${institutionIds}::int[]) AND rate_percent IS NOT NULL`,
  ]);
  const num = (value: unknown) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  for (const row of dollars) live.get(Number(row.institution_id))?.push({ canonicalKey: String(row.canonical_fee_key ?? ""), amount: num(row.amount) });
  for (const row of rates) {
    const rate = num(row.rate_percent);
    if (rate != null) live.get(Number(row.institution_id))?.push({ canonicalKey: String(row.canonical_fee_key ?? ""), amount: null, ratePercent: rate });
  }
  return live;
}

export interface FixedCohortRunResult { score: FixedCohortScore; eventId: number | null; recordError: string | null }

/**
 * Scores the cohort and, on a real run, records it as one `deming.fixed_cohort_accuracy` event on
 * the score-answer-key step. A failed read scores every institution as unscored; a failed write is
 * reported, never thrown.
 */
export async function runFixedCohortScore({ db = sql, keys, runId, stepId, dryRun, now = new Date() }: {
  db?: SqlTag; keys: KeyContent[] | null; runId: number | null; stepId: number | null; dryRun: boolean; now?: Date;
}): Promise<FixedCohortRunResult> {
  const live = await inSavepoint(db, (scope) => readCohortLiveFees(scope, FIXED_ANSWER_KEY_COHORT.map((row) => row.institutionId)))
    .catch((error: unknown) => { console.error("Fixed cohort: live fees could not be read", error); return null; });
  const score = scoreFixedCohort(keys, live, now.toISOString());
  if (dryRun || runId == null || stepId == null) return { score, eventId: null, recordError: null };
  try {
    const [row] = await inSavepoint(db, (scope) => scope<{ id: number | string }[]>`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (${runId}, ${stepId}, ${FIXED_COHORT_EVENT}, 'info', ${summarizeFixedCohort(score)}, ${JSON.stringify(score)}::jsonb)
      RETURNING id`);
    return { score, eventId: row ? Number(row.id) : null, recordError: null };
  } catch (error) {
    return { score, eventId: null, recordError: error instanceof Error ? error.message : String(error) };
  }
}
