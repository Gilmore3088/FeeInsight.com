import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { getGoldStandardCandidates, getSourceSubmissionCounts } from "@/lib/admin-queries";
import { loadLabelQueue } from "@/lib/agents/knox/label-queue";
import { answerKeySchemaReady, banksToCheck, listAnswerKeyInstitutions } from "@/lib/data-store/answer-key";
import { contentSchemaReady, listContentDrafts } from "@/lib/data-store/content-drafts";
import { workPiles } from "@/lib/admin-work-piles";
import { PileList, RoomHeader } from "../room-hub";

export const dynamic = "force-dynamic";

const VERIFY_LIMIT = 50;

async function read<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`Your work: ${what} could not be read`, error);
    return null;
  }
}

/**
 * The "Your work" room (#1122 step 3): what only James can do. Each pile shows its size, its oldest
 * item when the pile keeps one, and where to act. A pile whose read fails says so.
 */
export default async function YourWorkPage() {
  await requireAuth("view");
  const [labels, answerKeyRows, trust, drafts, verify] = await Promise.all([
    read("fee-name labels", async () => (await loadLabelQueue(sql)).length),
    read("answer key", async () => ((await answerKeySchemaReady()) ? banksToCheck(await listAnswerKeyInstitutions()).length : 0)),
    read("trust review", async () => (await getSourceSubmissionCounts()).pending),
    read("content drafts", async () => ((await contentSchemaReady()) ? (await listContentDrafts(80)).filter((draft) => draft.status === "draft") : [])),
    read("verify candidates", async () => (await getGoldStandardCandidates(VERIFY_LIMIT)).length),
  ]);
  const piles = workPiles({
    labels,
    answerKeyToCheck: answerKeyRows,
    trustPending: trust,
    contentDrafts: drafts,
    verifyCandidates: verify,
    verifyLimit: VERIFY_LIMIT,
  });
  return (
    <div className="space-y-8 pb-10">
      <RoomHeader room="work" />
      <PileList piles={piles} />
    </div>
  );
}
