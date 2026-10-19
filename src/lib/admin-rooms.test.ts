import { describe, expect, it } from "vitest";
import { ROOMS, findRoomPage, roomForPath, searchScreens } from "./admin-rooms";

describe("admin rooms", () => {
  it("has the seven rooms of the redesign (#1122), each with a landing page listed first", () => {
    expect(ROOMS.map((room) => room.label)).toEqual(["Today", "Pipeline", "Your work", "Data", "Hamilton", "Growth", "Settings"]);
    for (const room of ROOMS) expect(room.pages[0].href).toBe(room.href);
  });

  it("puts each screen in one room only", () => {
    const hrefs = ROOMS.flatMap((room) => room.pages.map((page) => page.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("puts each screen in its room", () => {
    expect(roomForPath("/admin").key).toBe("today");
    expect(roomForPath("/admin/live").key).toBe("today");
    expect(roomForPath("/admin/scoreboard").key).toBe("today");
    expect(roomForPath("/admin/states/TX/runs/12").key).toBe("pipeline");
    expect(roomForPath("/admin/answer-key/12").key).toBe("work");
    expect(roomForPath("/admin/customers/marketing").key).toBe("work");
    expect(roomForPath("/admin/institution/281").key).toBe("data");
    expect(roomForPath("/admin/leads").key).toBe("hamilton");
    expect(roomForPath("/admin/hamilton/reports").key).toBe("hamilton");
    expect(roomForPath("/admin/growth").key).toBe("growth");
    expect(roomForPath("/admin/agents/marketing").key).toBe("growth");
    expect(roomForPath("/admin/api-trust").key).toBe("settings");
  });

  it("picks the most specific screen", () => {
    expect(findRoomPage("/admin/agents/health")?.page.label).toBe("Health");
    expect(findRoomPage("/admin/agents")?.page.label).toBe("Overview");
    expect(findRoomPage("/admin/verify/42")?.page.label).toBe("Knox");
    expect(findRoomPage("/admin/hamilton/research/usage")?.page.label).toBe("Usage");
    expect(findRoomPage("/admin/hamilton/research/darwin")?.page.label).toBe("Research agents");
  });

  it("does not light a page for a path that only shares its prefix", () => {
    expect(findRoomPage("/admin/institutions")?.page.label).toBe("Institutions");
    expect(findRoomPage("/admin/datafoo")).toBeNull();
    expect(roomForPath("/admin/datafoo").key).toBe("today");
  });
});

describe("searchScreens", () => {
  it("finds screens by name, purpose or room", () => {
    expect(searchScreens("learn")[0]).toEqual({ href: "/admin/agents/learning", label: "Learning", room: "Pipeline" });
    expect(searchScreens("spend").map((match) => match.href)).toContain("/admin/api-trust");
    expect(searchScreens("controls")[0]).toEqual({ href: "/admin/controls", label: "Settings", room: "Settings" });
    expect(searchScreens("   ")).toEqual([]);
  });

  it("finds Controls by the words people use for its switches and caps", () => {
    for (const query of ["safety", "pause", "budget", "stop"]) {
      expect(searchScreens(query).map((match) => match.href)).toContain("/admin/controls");
    }
  });

  it("describes Replay as the read-only trace it is", () => {
    const replay = ROOMS.flatMap((room) => room.pages).find((page) => page.href === "/admin/agents/replay");
    expect(replay?.role).toBe("Trace a run");
  });
});
