import { beforeEach, describe, expect, it, vi } from "vitest";

const setContentDraftStatusMock = vi.fn();
const getContentDraftMock = vi.fn();
const recordSkipLessonMock = vi.fn();
const withdrawSkipLessonMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => ({ id: 1, email: "james@example.com" })) }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/content-drafts", () => ({
  CONTENT_DRAFT_STATUSES: ["draft", "approved", "skipped", "posted"],
  setContentDraftStatus: setContentDraftStatusMock,
  getContentDraft: getContentDraftMock,
  updateContentDraftCaption: vi.fn(),
}));
vi.mock("@/lib/agents/growth/lessons", () => ({
  recordSkipLesson: recordSkipLessonMock,
  withdrawSkipLesson: withdrawSkipLessonMock,
}));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("the Skip form teaches the agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContentDraftMock.mockResolvedValue({ id: 12, agent: "murrow", skipReason: "Metro too small" });
  });

  it("records a lesson when a draft is skipped with a reason", async () => {
    const { setDraftStatusAction } = await import("./actions");
    await setDraftStatusAction(form({ id: "12", status: "skipped", reason: "Metro too small" }));
    expect(setContentDraftStatusMock).toHaveBeenCalledWith(12, "skipped", "james@example.com", undefined, "Metro too small");
    expect(recordSkipLessonMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 12 }), "Metro too small");
  });

  it("records nothing for a skip without a reason", async () => {
    const { setDraftStatusAction } = await import("./actions");
    await setDraftStatusAction(form({ id: "12", status: "skipped", reason: "  " }));
    expect(recordSkipLessonMock).not.toHaveBeenCalled();
  });

  it("withdraws the lesson when the draft goes back to review", async () => {
    const { setDraftStatusAction } = await import("./actions");
    await setDraftStatusAction(form({ id: "12", status: "draft" }));
    expect(withdrawSkipLessonMock).toHaveBeenCalledWith(expect.anything(), 12);
  });

  it("keeps the skip even when the lesson can't be written", async () => {
    recordSkipLessonMock.mockRejectedValue(new Error("no table"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { setDraftStatusAction } = await import("./actions");
    await expect(setDraftStatusAction(form({ id: "12", status: "skipped", reason: "No" }))).resolves.toBeUndefined();
    expect(setContentDraftStatusMock).toHaveBeenCalled();
    errors.mockRestore();
  });
});
