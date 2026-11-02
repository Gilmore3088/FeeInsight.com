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

  it("refuses bot walls, hosting copies, cloud buckets and social sites (prod landings, Oct 5 - Nov 1)", () => {
    for (const landed of [
      "http://validate.perfdrive.com",
      "https://jamestown2dev.wpengine.com",
      "https://wwwmaxwellstate.z19.web.core.windows.net",
      "https://cbibt.s3.amazonaws.com",
      "https://d1234abcd.cloudfront.net",
      "https://www.facebook.com",
    ]) {
      expect(judge("https://www.cbibt.com", landed, "<title>CBI Bank &amp; Trust, Muscatine</title>")).toMatchObject({ proof: "not_own_site", proven: false });
    }
  });

  it("refuses a social or site-builder host before the same-domain proof", () => {
    expect(judge("https://www.facebook.com/cbibt", "https://m.facebook.com")).toMatchObject({ proof: "not_own_site", proven: false });
    expect(judge("https://cbibt.wixsite.com", "https://other.wixsite.com")).toMatchObject({ proof: "not_own_site", proven: false });
  });

  it("does not refuse a bank host that only contains a file-host word (cms, static, assets, homecu)", () => {
    const cms = { id: 1, institution_name: "CMS Bank", city: "White Plains", state_code: "NY", cert_number: "33456" };
    expect(judge("https://www.cmsbank.net", "https://www.cmsbank.com", "<title>CMS Bank | White Plains, New York</title>", cms))
      .toMatchObject({ proven: true });
    const statik = { id: 2, institution_name: "Static Savings Bank", city: "Lipan", state_code: "TX", cert_number: "4321" };
    expect(judge("https://www.staticsavings.com", "https://www.staticbank.com", "<title>Static Savings Bank, Lipan</title>", statik))
      .toMatchObject({ proven: true });
    const assets = { id: 3, institution_name: "First Assets Federal Credit Union", city: "Erie", state_code: "PA", cert_number: "5678" };
    expect(judge("https://www.firstassetsfcu.org", "https://www.firstassets.org", "<title>First Assets Federal Credit Union, Erie</title>", assets))
      .toMatchObject({ proven: true });
    const homecu = { id: 4, institution_name: "My Home Credit Union", city: "Akron", state_code: "OH", cert_number: "9876" };
    expect(judge("https://www.myhomecreditunion.com", "https://www.myhomecu.org", "<title>My Home Credit Union, Akron</title>", homecu))
      .toMatchObject({ proven: true });
  });

  it("leaves a rebrand behind a bot challenge unproven, not refused", () => {
    const challenge = "<html><title>Just a moment...</title><script>window._cf_chl_opt={}</script></html>";
    expect(judge("https://www.cbibt.com", "https://www.cbibt.bank", challenge)).toMatchObject({ proof: "unproven", proven: false });
    const lipan = { id: 5, institution_name: "Lipan Valley Bank", city: "Lipan", state_code: "TX", cert_number: "1111" };
    expect(judge("https://www.lipanvalley.com", "https://www.lipanvalleybank.com", challenge, lipan)).toMatchObject({ proof: "unproven", proven: false });
    expect(judge("https://www.lipanvalley.com", "https://www.lipanvalleybank.com", "", lipan)).toMatchObject({ proof: "host_names_own", proven: true });
  });

  it("with a shared name, still proves the landing by its homepage, never by its host", () => {
    const shared = { id: 3323, institution_name: "Family Bank", city: "Pikeville", state_code: "KY", cert_number: "1", name_shared: true };
    expect(judge("https://www.familybank.com", "https://www.familybankonline.com", "<title>Family Bank | Pikeville, Kentucky</title>", shared))
      .toMatchObject({ proof: "homepage_names_own", proven: true });
    expect(judge("https://www.familybank.com", "https://www.familybankonline.com", "<title>Family Bank | Moultrie, Georgia</title>", shared))
      .toMatchObject({ proof: "unproven", proven: false });
  });

  it("leaves a parked or unrelated landing unproven", () => {
    expect(judge("https://www.apericia.com", "https://www.tallautosales.com", "<title>Tall Auto Sales</title>")).toMatchObject({ proof: "unproven", proven: false });
  });
});

describe("savesMovedWebsite", () => {
  const proof = (kind: "same_domain" | "not_own_site" | "unproven", proven: boolean) => ({ proof: kind, proven, reason: "" });

  it("saves a proven landing, never a refused one, and an unproven one only while the switch is off", () => {
    expect(savesMovedWebsite({ movedTo: null, movedToProof: null })).toBe(false);
    expect(savesMovedWebsite({ movedTo: "https://a.example", movedToProof: proof("same_domain", true) })).toBe(true);
    expect(savesMovedWebsite({ movedTo: "https://a.example", movedToProof: proof("not_own_site", false) })).toBe(false);
    expect(savesMovedWebsite({ movedTo: "https://a.example", movedToProof: proof("unproven", false) })).toBe(!REDIRECT_WEBSITE_PROOF_LIVE);
  });
});
