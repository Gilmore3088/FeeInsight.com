import { describe, expect, it } from "vitest";
import { ROOMS, findRoomPage, roomForPath, searchScreens } from "./admin-rooms";

describe("admin rooms", () => {
  it("has six rooms, each with a landing page listed first", () => {
    expect(ROOMS.map((room) => room.label)).toEqual(["Today", "Agents", "Data", "Customers", "Publishing", "Controls"]);
    for (const room of ROOMS) expect(room.pages[0].href).toBe(room.href);
  });

  it("puts each screen in its room", () => {
    expect(roomForPath("/admin").key).toBe("today");
    expect(roomForPath("/admin/live").key).toBe("agents");
    expect(roomForPath("/admin/states/TX/runs/12").key).toBe("agents");
    expect(roomForPath("/admin/institution/281").key).toBe("data");
    expect(roomForPath("/admin/leads").key).toBe("customers");
    expect(roomForPath("/admin/growth").key).toBe("customers");
    expect(roomForPath("/admin/hamilton/reports").key).toBe("publishing");
    expect(roomForPath("/admin/api-trust").key).toBe("controls");
  });

  it("picks the most specific screen", () => {
    expect(findRoomPage("/admin/agents/health")?.page.label).toBe("Health");
    expect(findRoomPage("/admin/agents")?.page.label).toBe("Overview");
    expect(findRoomPage("/admin/agents/knox/reviews/4")?.page.label).toBe("Knox");
    expect(findRoomPage("/admin/hamilton/research/usage")?.room.key).toBe("customers");
    expect(findRoomPage("/admin/hamilton/research/darwin")?.room.key).toBe("publishing");
  });

  it("does not light a page for a path that only shares its prefix", () => {
    expect(findRoomPage("/admin/institutions")?.page.label).toBe("Institutions");
    expect(findRoomPage("/admin/datafoo")).toBeNull();
    expect(roomForPath("/admin/datafoo").key).toBe("today");
  });
});

describe("searchScreens", () => {
  it("finds screens by name, purpose or room", () => {
    expect(searchScreens("learn")[0]).toEqual({ href: "/admin/agents/learning", label: "Learning", room: "Agents" });
    expect(searchScreens("spend").map((match) => match.href)).toContain("/admin/api-trust");
    expect(searchScreens("controls")[0]).toEqual({ href: "/admin/controls", label: "Controls", room: "Controls" });
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
