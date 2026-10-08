import { describe, expect, it, vi } from "vitest";

import { otherInstitutionAtHost, urlHost } from "./other-bank-host";

describe("other bank host", () => {
  it("reads an address's host without www", () => {
    expect(urlHost("https://www.peoplesbank-wa.com/wp-content/uploads/2024/11/Personal-Fee-Schedule.pdf")).toBe("peoplesbank-wa.com");
    expect(urlHost("peoples-ebank.com")).toBe("peoples-ebank.com");
    expect(urlHost("mailto:hello@bank.test")).toBeNull();
    expect(urlHost(null)).toBeNull();
  });

  it("names the institution whose own website holds the link (Peoples Bank WA for Peoples Bank IA)", async () => {
    const db = vi.fn(() => Promise.resolve([{ id: 505, institution_name: "Peoples Bank", state_code: "WA" }]));
    const other = await otherInstitutionAtHost(db as never, 915, "https://www.peoplesbank-wa.com/Personal-Fee-Schedule.pdf");
    expect(other).toEqual({ institutionId: 505, institutionName: "Peoples Bank", stateCode: "WA", host: "peoplesbank-wa.com" });
    expect((db.mock.calls[0] as unknown[]).slice(1)).toEqual([915, "peoplesbank-wa.com", 915, "peoplesbank-wa.com"]);
  });

  it("finds none for an address that is no web address", async () => {
    const db = vi.fn();
    expect(await otherInstitutionAtHost(db as never, 915, "not a url ::")).toBeNull();
    expect(db).not.toHaveBeenCalled();
  });
});
