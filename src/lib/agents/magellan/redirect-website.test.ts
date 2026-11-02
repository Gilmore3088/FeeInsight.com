import { describe, expect, it } from "vitest";

import { savesMovedWebsite } from "./discovery";
import { judgeRedirectWebsite, REDIRECT_WEBSITE_PROOF_LIVE, registrableDomain } from "./redirect-website";

const cbi = { id: 700, institution_name: "CBI Bank & Trust", city: "Muscatine", state_code: "IA", cert_number: "12345" };

function judge(stored: string, landed: string, html = "", institution: Parameters<typeof judgeRedirectWebsite>[0]["institution"] = cbi) {
  return judgeRedirectWebsite({ institution, stored: new URL(stored), landed: new URL(landed), html });
}

describe("judgeRedirectWebsite (Nov 2 audit, gap 8)", () => {
  it("proves a landing under the stored website's own domain", () => {
    expect(judge("https://www.acmebank.com", "https://online.acmebank.com")).toMatchObject({ proof: "same_domain", proven: true });
    expect(registrableDomain("home.bank.co.uk")).toBe("bank.co.uk");
  });

  it("proves a rebrand whose host spells the institution's name (civistabank.com -> civista.bank)", () => {
    const civista = { id: 332, institution_name: "Civista Bank", city: "Sandusky", state_code: "OH", cert_number: "6767" };
    expect(judge("https://www.civistabank.com", "https://www.civista.bank", "", civista)).toMatchObject({ proof: "host_names_own", proven: true });
  });

  it("does not take a host name as proof when another institution has the same name", () => {
    const shared = { id: 3323, institution_name: "Family Bank", city: "Pikeville", state_code: "KY", cert_number: "1", name_shared: true };
    expect(judge("https://www.familybank.com", "https://www.familybankonline.com", "", shared)).toMatchObject({ proof: "unproven", proven: false });
  });

  it("proves a landing whose homepage names the institution and its city", () => {
    const html = "<title>CBI Bank &amp; Trust</title><p>Serving Muscatine since 1865</p>";
    expect(judge("https://www.cbibt.com", "https://www.newsite.example", html)).toMatchObject({ proof: "homepage_names_own", proven: true });
  });

  it("refuses bot walls, hosting copies, cloud buckets and university or social sites (prod landings, Oct 5 - Nov 1)", () => {
    for (const landed of [
      "http://validate.perfdrive.com",
      "https://jamestown2dev.wpengine.com",
      "https://wwwmaxwellstate.z19.web.core.windows.net",
      "https://www.facebook.com",
    ]) {
      expect(judge("https://www.cbibt.com", landed, "<title>CBI Bank &amp; Trust, Muscatine</title>")).toMatchObject({ proof: "not_own_site", proven: false });
    }
    expect(judge("https://www.cbibt.com", "https://www.other.example", "<html><title>Just a moment...</title>cf-chl</html>").proven).toBe(false);
  });

  it("leaves a parked or unrelated landing unproven", () => {
    expect(judge("https://www.apericia.com", "https://www.tallautosales.com", "<title>Tall Auto Sales</title>")).toMatchObject({ proof: "unproven", proven: false });
  });
});

describe("savesMovedWebsite", () => {
  const proof = (kind: "same_domain" | "not_own_site" | "bot_challenge" | "unproven", proven: boolean) => ({ proof: kind, proven, reason: "" });

  it("saves a proven landing, never a refused one, and an unproven one only while the switch is off", () => {
    expect(savesMovedWebsite({ movedTo: null, movedToProof: null })).toBe(false);
    expect(savesMovedWebsite({ movedTo: "https://a.example", movedToProof: proof("same_domain", true) })).toBe(true);
    expect(savesMovedWebsite({ movedTo: "https://a.example", movedToProof: proof("not_own_site", false) })).toBe(false);
    expect(savesMovedWebsite({ movedTo: "https://a.example", movedToProof: proof("bot_challenge", false) })).toBe(false);
    expect(savesMovedWebsite({ movedTo: "https://a.example", movedToProof: proof("unproven", false) })).toBe(!REDIRECT_WEBSITE_PROOF_LIVE);
  });
});
