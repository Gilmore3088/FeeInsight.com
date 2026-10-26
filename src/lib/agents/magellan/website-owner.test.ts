import { describe, expect, it, vi } from "vitest";

import {
  hostNamesInstitution,
  judgeWebsiteOwner,
  reviewWebsiteOwners,
  sameHoldingCompany,
  WEBSITE_OWNER_STRATEGY,
  type WebsiteOwnerInstitution,
} from "./website-owner";

const bluegrass: WebsiteOwnerInstitution = {
  id: 5756, institution_name: "Bluegrass Community Federal Credit Union", city: "Ashland", state_code: "KY", cert_number: "12648", charter_type: "credit_union",
};
const ukfcu: WebsiteOwnerInstitution = {
  id: 6729, institution_name: "University Of Kentucky Federal Credit Union", city: "Lexington", state_code: "KY", cert_number: "6729", charter_type: "credit_union",
};
const fnbOldham: WebsiteOwnerInstitution = {
  id: 1903, institution_name: "First National Bank", city: "Oldham", state_code: "SD", cert_number: "25894", charter_type: "commercial",
  holding_company_rssd: "1133567", holding_company_name: "FULDA BCORP INC",
};
const fnbFortPierre: WebsiteOwnerInstitution = {
  id: 582, institution_name: "First National Bank", city: "Fort Pierre", state_code: "SD", cert_number: "3218", charter_type: "commercial",
  holding_company_rssd: "1127294", holding_company_name: "CAPITOL BCORP",
};
const metrowest: WebsiteOwnerInstitution = {
  id: 4884, institution_name: "Metrowest Community Federal Credit Union", city: "FRAMINGHAM", state_code: "MA", cert_number: "4731", charter_type: "credit_union",
};
const stMarys: WebsiteOwnerInstitution = {
  id: 8298, institution_name: "St. Mary'S Federal Credit Union", city: "MARLBOROUGH", state_code: "MA", cert_number: "8298", charter_type: "credit_union",
};
const pinnacle: WebsiteOwnerInstitution = {
  id: 543, institution_name: "Pinnacle Bank", city: "Elberton", state_code: "GA", cert_number: "14065", charter_type: "commercial",
  holding_company_rssd: "1084893", holding_company_name: "VALLANT FINANCIAL INC",
};

const UK_HOME = "<html><head><title>UK Federal Credit Union | Lexington, KY</title></head><body>" +
  "<nav><a href='/rates'>Rates</a></nav><p>University of Kentucky Federal Credit Union serves Lexington and Central Kentucky.</p>" +
  "<footer>Federally insured by NCUA.</footer></body></html>";
// firstnationalbanks.bank lists Fort Pierre's branches, not Oldham (stored copies, Oct 7-18).
const FNB_HOME = "<html><head><title>First National Bank</title></head><body><h1>First National Bank</h1>" +
  "<ul><li>Fort Pierre, SD</li><li>Pierre</li><li>Murdo, SD</li><li>Rapid City, SD</li><li>Huron, SD</li></ul></body></html>";
const ST_MARYS_HOME = "<html><head><title>St. Mary's Credit Union</title></head><body>" +
  "<p>St. Mary's Federal Credit Union, Marlborough, Massachusetts. Welcome, former MetroWest members!</p></body></html>";

describe("judgeWebsiteOwner (#1455)", () => {
  it("flags a website whose homepage is another, unrelated institution's", () => {
    const judgement = judgeWebsiteOwner({ institution: bluegrass, host: "ukcreditunion.org", sharers: [ukfcu], html: UK_HOME });
    expect(judgement).toMatchObject({ verdict: "other_institution", ownerId: 6729 });
    expect(judgement.checks.find((check) => check.institution_id === 6729)).toMatchObject({ ok: true, city_matched: true });
  });

  it("keeps the website for the institution its homepage names", () => {
    expect(judgeWebsiteOwner({ institution: ukfcu, host: "ukcreditunion.org", sharers: [bluegrass], html: UK_HOME }).verdict).toBe("own");
  });

  it("tells two institutions with one name apart by the city the homepage names", () => {
    expect(judgeWebsiteOwner({ institution: fnbOldham, host: "firstnationalbanks.bank", sharers: [fnbFortPierre], html: FNB_HOME }))
      .toMatchObject({ verdict: "other_institution", ownerId: 582 });
    expect(judgeWebsiteOwner({ institution: fnbFortPierre, host: "firstnationalbanks.bank", sharers: [fnbOldham], html: FNB_HOME }).verdict).toBe("own");
  });

  it("flags a merged credit union's old record whose homepage names only its city-less brand", () => {
    // "MetroWest" is on the page but not Framingham or the charter number: St. Mary's passes the check.
    expect(judgeWebsiteOwner({ institution: metrowest, host: "stmaryscu.org", sharers: [stMarys], html: ST_MARYS_HOME }))
      .toMatchObject({ verdict: "other_institution", ownerId: 8298 });
  });

  it("never reads a shared site inside one holding company as another bank's", () => {
    const sister = { ...fnbFortPierre, holding_company_rssd: fnbOldham.holding_company_rssd };
    expect(judgeWebsiteOwner({ institution: fnbOldham, host: "firstnationalbanks.bank", sharers: [sister], html: FNB_HOME }).verdict).toBe("sibling");
  });

  it("keeps a renamed bank's new domain: the host spells its holding company's name", () => {
    // Pinnacle Bank, Elberton GA (543): vallant.bank served the same PDF bytes as pinnaclebank.com
    // (docs 270 and 12678); its holding company is Vallant Financial. Another record on the host
    // does not hand it away, and the homepage is not even read.
    const other = { ...bluegrass, id: 9001, institution_name: "Some Other Bank", city: "Elberton", state_code: "GA" };
    const judgement = judgeWebsiteOwner({
      institution: pinnacle, host: "vallant.bank", sharers: [other],
      html: "<title>Some Other Bank, Elberton</title><p>Some Other Bank, Elberton GA</p>",
    });
    expect(judgement.verdict).toBe("host_names_own");
    expect(hostNamesInstitution("vallant.bank", pinnacle)).toBe(true);
    expect(hostNamesInstitution("pinnaclebank.com", pinnacle)).toBe(true);
    expect(hostNamesInstitution("ukcreditunion.org", bluegrass)).toBe(false);
  });

  it("flags nothing without positive evidence", () => {
    const energyPlus = { ...metrowest, id: 7819, institution_name: "Energy Plus Federal Credit Union", city: "Indianapolis", state_code: "IN" };
    const harvester = { ...metrowest, id: 8548, institution_name: "Harvester Financial Federal Credit Union", city: "Indianapolis", state_code: "IN" };
    // Both merged into Origins FCU, which the homepage names; neither record is named.
    const origins = "<title>Origins Federal Credit Union</title><p>Origins FCU, Indianapolis</p>";
    expect(judgeWebsiteOwner({ institution: energyPlus, host: "originscu.org", sharers: [harvester], html: origins }).verdict).toBe("unclear");
    // Both named: a shared site, not another bank's.
    const both = "<p>University of Kentucky Federal Credit Union, Lexington. Bluegrass Community Federal Credit Union, Ashland.</p>";
    expect(judgeWebsiteOwner({ institution: bluegrass, host: "ukcreditunion.org", sharers: [ukfcu], html: both }).verdict).toBe("shared");
    // Unread homepage.
    expect(judgeWebsiteOwner({ institution: bluegrass, host: "ukcreditunion.org", sharers: [ukfcu], html: null }).verdict).toBe("unread");
  });

  it("never flags on name words alone: a place-name word is on every local homepage (review of #2674)", () => {
    const heritage = { ...bluegrass, id: 9101, institution_name: "Bluegrass Heritage Federal Credit Union" };
    const kentuckyBank = { ...ukfcu, id: 9102, institution_name: "Kentucky Bank", city: "Paris", cert_number: "9102", charter_type: "commercial" };
    const home = "<title>Bluegrass Credit Union</title><p>Serving eastern Kentucky families.</p><p>Branches in Ashland.</p>";
    expect(judgeWebsiteOwner({ institution: heritage, host: "bgcu.org", sharers: [kentuckyBank], html: home }).verdict).not.toBe("other_institution");
  });

  it("compares holding companies by RSSD, else by name", () => {
    expect(sameHoldingCompany(fnbOldham, fnbFortPierre)).toBe(false);
    expect(sameHoldingCompany({ ...bluegrass, holding_company_name: "X Corp" }, { ...ukfcu, holding_company_name: "x corp" })).toBe(true);
    expect(sameHoldingCompany(bluegrass, ukfcu)).toBe(false);
    expect(sameHoldingCompany({ ...bluegrass, holding_company_rssd: "0" }, { ...ukfcu, holding_company_rssd: "0" })).toBe(false);
  });
});

const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));

describe("reviewWebsiteOwners", () => {
  function createDb(rows: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (text(strings).includes("website owner review")) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
  }

  it("records one attempt per website and a run event, and flags the other institution's site", async () => {
    const db = createDb([{ ...bluegrass, website_url: "https://www.ukcreditunion.org", host: "ukcreditunion.org", sharers: JSON.stringify([ukfcu]) }]);
    const fetchImpl = vi.fn(async () => new Response(UK_HOME, { status: 200, headers: { "content-type": "text/html" } }));
    const result = await reviewWebsiteOwners({
      db: db as never, fetchImpl: fetchImpl as never, runId: 7, stepId: 9, stateCode: "KY",
    });
    expect(result).toMatchObject({ checked: 1, flagged: 1, verdicts: { other_institution: 1 } });
    expect(fetchImpl).toHaveBeenCalledWith("https://www.ukcreditunion.org", expect.anything());
    const attempt = db.mock.calls.find((call) => text(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toBeDefined();
    expect(attempt?.[4]).toBe(WEBSITE_OWNER_STRATEGY.strategy);
    expect(attempt?.[7]).toBe("rejected");
    expect(JSON.parse(String(attempt?.[13]))).toMatchObject({ website_host: "ukcreditunion.org", verdict: "other_institution", owner_id: 6729 });
    expect(db.mock.calls.some((call) => text(call[0]).includes("'magellan.website_owner'"))).toBe(true);
  });

  it("records an unread homepage as a retryable outcome that flags nothing", async () => {
    const db = createDb([{ ...bluegrass, website_url: "https://www.ukcreditunion.org", host: "ukcreditunion.org", sharers: [ukfcu] }]);
    const fetchImpl = vi.fn(async () => new Response("no", { status: 503 }));
    const result = await reviewWebsiteOwners({ db: db as never, fetchImpl: fetchImpl as never, runId: 7 });
    expect(result).toMatchObject({ checked: 1, flagged: 0, verdicts: { unread: 1 } });
    const attempt = db.mock.calls.find((call) => text(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt?.[7]).toBe("http_5xx");
  });

  it("reads and writes nothing on a dry run", async () => {
    const db = createDb([]);
    const fetchImpl = vi.fn();
    expect(await reviewWebsiteOwners({ db: db as never, fetchImpl: fetchImpl as never, runId: 7, dryRun: true })).toMatchObject({ checked: 0, dryRun: true });
    expect(db).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
