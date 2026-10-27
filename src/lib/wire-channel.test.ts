import { describe, expect, it } from "vitest";

import { PROD_WIRE_CHANNEL_SQL } from "./__fixtures__/wire-channel-names-2026-10-27";
import { CHANNEL_SQL, NEGATED_STANDARD_SQL, NOTICE_SQL, STANDARD_SQL, WIRE_CHANNEL_CATEGORIES, namesWireChannel, wireChannelSql } from "./wire-channel";

describe("namesWireChannel (#1912)", () => {
  it("reads a channel or set-up-in-advance wire", () => {
    for (const name of [
      "Online Outgoing Domestic Wire",
      "Wire transfers: Domestic outgoing (online)",
      "Domestic outgoing wire transfer (self-service in digital banking)",
      "Chase Mobile to send a wire from your account to",
      "Outgoing Telephone Wire Transfer with PIN (Consumer)",
      "Wire Transfers – Outgoing Wire: PIN - Domestic",
      "Wire Transfers: Domestic Outgoing (Phone)",
      "Fax Request Outgoing Wire - Domestic",
      "Electronically submitted Outgoing Domestic Wire Transfer",
      "Wire Transfer - Outgoing Originated on Website - Domestic (per transfer) with dual",
      "Foreign Wire Transfer (eBranch form)",
      "Wire Transfer - Incoming using EBANK instructions",
      "Repetitive Wire - Domestic",
      "Recurring Wire Out",
      "Outgoing Domestic Wire Template Fee",
      "Standing wire transfer",
      "Outgoing e-mail wire request",
    ]) {
      expect(namesWireChannel(name), name).toBe(true);
    }
  });

  it("reads the standard channel and plain names as general", () => {
    for (const name of [
      "Outgoing Domestic Wire",
      "Wire transfers: Domestic outgoing (in branch)",
      "Domestic Outbound Wires (Manual)",
      "Outgoing Domestic Wire (in person)",
      "Domestic Wire - Agent-Assisted Outgoing",
      "Outgoing Wire Transfer within USA by IBC Representative",
      // A channel beside a standard one is the bank's general price.
      "Outgoing Domestic Wire (Phone/Branch)",
      "Outgoing Wire Transfer – Domestic (In Person/By Fax/Email)",
      "Wire Transfers - Outgoing Domestic (initiated in person or through electronic banking)",
      "Fee charged to send a non-recurring domestic wire transfer",
      "Funds Domestic Outgoing Wire (Customer) Repetitive Non-Repetitive",
      "Wire transfer- outgoing not initiated online",
      // A wire is an electronic transfer: a bare "electronic" is a heading, not a channel.
      "ELECTRONIC FUND TRANSFERS: Outgoing Consumer Domestic Wire Transfer fee",
      // Business services are an audience matter (rule 6), not a channel.
      "Cash Management Outgoing Wire Transfer Fee",
      "Domestic Outgoing via Treasury Passport wire",
      // "pin" and "app" only as words.
      "Pinnacle Outgoing Wire",
      "Outgoing Wire (App Required)",
      "",
      null,
      undefined,
    ]) {
      expect(namesWireChannel(name), String(name)).toBe(false);
    }
  });

  it("v2: reads a negated standard channel as the premium channel (Sound Community Bank 978, fee 15716)", () => {
    for (const name of [
      "Wire Transfers: Outgoing Domestic - Not in Person",
      "Outgoing Domestic Wire (not in-person)",
      "Outgoing Wire - Non-Branch",
      "Outgoing wire requested outside the branch",
      "Outgoing wire other than in person",
      "Wire Transfer - Remote Outgoing",
    ]) {
      expect(namesWireChannel(name), name).toBe(true);
    }
    // The plain standard channel stays general, and so does a name that also states one.
    expect(namesWireChannel("Wire Transfers: Outgoing Domestic")).toBe(false);
    expect(namesWireChannel("Outgoing Domestic Wire (in person)")).toBe(false);
    expect(namesWireChannel("Outgoing Wire (In Person or Not in Person)")).toBe(false);
  });

  it("v2: a phone, fax or email notice names how the bank tells the customer, not a channel", () => {
    for (const name of [
      "Incoming Wire with Phone Notification",
      "Incoming Wires: Email or Fax Confirmation",
      "Incoming wire, notice by phone",
    ]) {
      expect(namesWireChannel(name), name).toBe(false);
    }
    // A wire requested by phone is still a channel, notice or not.
    expect(namesWireChannel("Outgoing Wire by Phone with Email Confirmation")).toBe(true);
  });

  it("covers the four wire categories", () => {
    expect([...WIRE_CHANNEL_CATEGORIES].sort()).toEqual(["wire_domestic_incoming", "wire_domestic_outgoing", "wire_intl_incoming", "wire_intl_outgoing"]);
  });

  it("agrees with PostgreSQL on every live wire name it might apply to (prod, 2026-10-27)", () => {
    expect(PROD_WIRE_CHANNEL_SQL.length).toBeGreaterThan(150);
    for (const [name, sqlSays] of PROD_WIRE_CHANNEL_SQL) expect(namesWireChannel(name), name).toBe(sqlSays);
  });

  it("states the same rule in SQL, static columns only", () => {
    expect(wireChannelSql("ef.fee_name")).toBe(
      `COALESCE((regexp_replace(ef.fee_name, '${NOTICE_SQL}', ' ', 'gi') ~* '${CHANNEL_SQL}' OR ef.fee_name ~* '${NEGATED_STANDARD_SQL}')`
      + ` AND regexp_replace(ef.fee_name, '${NEGATED_STANDARD_SQL}', ' ', 'gi') !~* '${STANDARD_SQL}', false)`,
    );
    for (const pattern of [NOTICE_SQL, NEGATED_STANDARD_SQL]) {
      expect(pattern).not.toContain("\\b");
      expect(pattern).not.toContain("'");
    }
    expect(CHANNEL_SQL).toMatch(/^\\y\(\?:online\|/);
    expect(CHANNEL_SQL).not.toContain("\\b");
    expect(STANDARD_SQL).not.toContain("'");
    expect(() => wireChannelSql("fee_name")).toThrow();
    expect(() => wireChannelSql("ef.fee_name; drop")).toThrow();
  });
});
