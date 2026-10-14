import { describe, expect, it, vi } from "vitest";

import { bankOwnedHost, loadOwnHosts, onBankHosts } from "./own-hosts";

type DbMock = ReturnType<typeof vi.fn>;
const text = (strings: TemplateStringsArray) => strings.join("?");
const asDb = (db: DbMock) => db as unknown as Parameters<typeof loadOwnHosts>[0];

describe("a bank's other own hosts (#1251)", () => {
  it("keeps the website's name with another ending, and .bank domains", () => {
    // Pairs measured on production, 2026-10-14 (stored website -> host of a stored document).
    expect(bankOwnedHost("machiassavings.bank", "https://www.machiassavings.com")).toBe(true);
    expect(bankOwnedHost("healthplusfcu.org", "http://healthplusfcu.com")).toBe(true);
    expect(bankOwnedHost("cvb.bank", "https://www.cashmerevalleybank.com")).toBe(true);
    expect(bankOwnedHost("vallant.bank", "https://pinnaclebank.com")).toBe(true);
  });

  it("refuses file hosts, short names, the website itself and unrelated domains", () => {
    expect(bankOwnedHost("static1.squarespace.com", "https://www.harpethbank.com")).toBe(false);
    expect(bankOwnedHost("cdn.firstbranchcms.com", "https://soundcb.com")).toBe(false);
    expect(bankOwnedHost("docs.google.com", "https://example-bank.com")).toBe(false);
    expect(bankOwnedHost("southeastbank.com.bd", "https://southeasternbank.com")).toBe(false);
    // "imcu" is too short to match on the name alone.
    expect(bankOwnedHost("imcu.com", "https://imcu.org")).toBe(false);
    expect(bankOwnedHost("machiassavings.com", "https://www.machiassavings.com")).toBe(false);
    expect(bankOwnedHost("docs.secumd.org", "https://www.secumd.org")).toBe(false);
    expect(bankOwnedHost("10.0.0.1", "https://www.machiassavings.com")).toBe(false);
    expect(bankOwnedHost("machiassavings.bank", null)).toBe(false);
  });

  it("accepts an answer on the bank's domain or on one of its own hosts, and nothing else", () => {
    const website = "https://www.machiassavings.com";
    expect(onBankHosts("https://www.machiassavings.com/fees.pdf", website, [])).toBe(true);
    expect(onBankHosts("https://machiassavings.bank/fees.pdf", website, [])).toBe(false);
    expect(onBankHosts("https://machiassavings.bank/fees.pdf", website, ["machiassavings.bank"])).toBe(true);
    expect(onBankHosts("https://docs.machiassavings.bank/fees.pdf", website, ["machiassavings.bank"])).toBe(true);
    expect(onBankHosts("https://notmachiassavings.bank/fees.pdf", website, ["machiassavings.bank"])).toBe(false);
  });

  it("reads every bank's hosts in one query and keeps only the ones the bank owns", async () => {
    const db = vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>>((strings) => {
      expect(text(strings)).toContain("bank-owned document hosts");
      return Promise.resolve([
        { institution_id: 7, host: "machiassavings.bank" },
        { institution_id: 7, host: "machiassavings.com" },
        { institution_id: 7, host: "static1.squarespace.com" },
        { institution_id: "8", host: "cvb.bank" },
        { institution_id: 9, host: null },
      ]);
    });
    const hosts = await loadOwnHosts(asDb(db), [
      { id: 7, website_url: "https://www.machiassavings.com" },
      { id: "8", website_url: "https://cashmerevalleybank.com" },
      { id: 9, website_url: "https://nine.example" },
    ]);
    expect(db).toHaveBeenCalledTimes(1);
    expect(db.mock.calls[0][1]).toEqual([7, 8, 9]);
    expect(hosts.get(7)).toEqual(["machiassavings.bank"]);
    expect(hosts.get(8)).toEqual(["cvb.bank"]);
    expect(hosts.has(9)).toBe(false);
  });

  it("returns no hosts, and runs no query, for no banks or a failed read", async () => {
    const none = vi.fn();
    expect((await loadOwnHosts(asDb(none), [])).size).toBe(0);
    expect(none).not.toHaveBeenCalled();
    const failing = vi.fn(() => Promise.reject(new Error("timeout")));
    expect((await loadOwnHosts(asDb(failing), [{ id: 1, website_url: "https://a.example" }])).size).toBe(0);
  });
});
