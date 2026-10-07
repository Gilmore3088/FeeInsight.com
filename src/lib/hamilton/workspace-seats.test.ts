import { describe, expect, it } from "vitest";
import { WORKSPACE_SEAT_LIMIT, countWorkspaceSeats, hasOpenSeat, seatLimitMessage } from "./workspace-seats";

const now = new Date("2026-10-07T12:00:00Z");
const later = "2026-11-01T00:00:00Z";
const earlier = "2026-10-01T00:00:00Z";

describe("team seat count", () => {
  it("allows five seats per institution account", () => {
    expect(WORKSPACE_SEAT_LIMIT).toBe(5);
  });

  it("counts the owner and other active members plus pending, unexpired invitations", () => {
    const members = [
      { userId: 1, userEmail: "owner@bank.com" },
      { userId: 2, userEmail: "analyst@bank.com" },
    ];
    const invitations = [
      { email: "new1@bank.com", status: "pending", expiresAt: later },
      { email: "new2@bank.com", status: "pending", expiresAt: later },
    ];
    expect(countWorkspaceSeats(members, invitations, now)).toBe(4);
  });

  it("skips expired and non-pending invitations", () => {
    const members = [{ userId: 1, userEmail: "owner@bank.com" }];
    const invitations = [
      { email: "old@bank.com", status: "pending", expiresAt: earlier },
      { email: "gone@bank.com", status: "revoked", expiresAt: later },
      { email: "done@bank.com", status: "accepted", expiresAt: later },
    ];
    expect(countWorkspaceSeats(members, invitations, now)).toBe(1);
  });

  it("counts a member who also has a pending invite once, ignoring email case", () => {
    const members = [{ userId: 2, userEmail: "Analyst@Bank.com" }];
    const invitations = [{ email: "analyst@bank.com", status: "pending", expiresAt: later }];
    expect(countWorkspaceSeats(members, invitations, now)).toBe(1);
  });

  it("counts members without an email by user id", () => {
    const members = [
      { userId: 1, userEmail: null },
      { userId: 2, userEmail: null },
    ];
    expect(countWorkspaceSeats(members, [], now)).toBe(2);
  });

  it("has an open seat at four and none at five", () => {
    expect(hasOpenSeat(4)).toBe(true);
    expect(hasOpenSeat(5)).toBe(false);
    expect(hasOpenSeat(6)).toBe(false);
    expect(seatLimitMessage()).toContain("All 5 seats");
  });
});
