// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/lib/hamilton/uploads/limits";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), premium: vi.fn(), receive: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/access", () => ({ canAccessPremium: mocks.premium }));
vi.mock("@/lib/hamilton/uploads/service", () => ({ receiveUpload: mocks.receive }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: 7 });
  mocks.premium.mockReturnValue(true);
});

describe("upload route byte boundary", () => {
  it("rejects an over-limit file before copying bytes or calling the service", async () => {
    const file = new File(["synthetic"], "fees.csv");
    Object.defineProperty(file, "size", { value: MAX_UPLOAD_BYTES + 1 });
    const copy = vi.spyOn(file, "arrayBuffer");
    const form = new FormData();
    form.set("file", file);
    const response = await POST({ formData: async () => form } as Request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "The file is over 2 MB. Export a smaller data range and upload it again." });
    expect(copy).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it("keeps authorization ahead of multipart parsing", async () => {
    mocks.premium.mockReturnValue(false);
    const formData = vi.fn();
    const response = await POST({ formData } as unknown as Request);
    expect(response.status).toBe(401);
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });
});
