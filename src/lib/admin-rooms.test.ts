import { describe, expect, it } from "vitest";
import { ROOMS, findRoomPage, roomForPath } from "./admin-rooms";

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
