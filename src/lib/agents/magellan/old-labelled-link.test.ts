import { describe, expect, it } from "vitest";
import { oldLabelledAddress, oldLabelledLink, oldLabelledLinkWords, oldLabelledPrefilterSql } from "./old-labelled-link";

// The five documents behind live fees on Nov 3 (prod, read-only), and the two other stored links.
const OLD_ADDRESSES = [
  "https://westreet.org/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf",
  "https://www.winsouthcu.com/_/kcms-doc/1526/59288/PDF.FEE.SCHED.716.OLD.pdf",
  "https://cjpolicefirefcu.org/old-web-site/",
  "https://www.cbt-co.com/deposit-accounts/schedule-of-fees-old",
  "https://www.clackamascountybank.com/archive-2021/personal-checking.php",
  "https://cleostatebank.com/old-home.html",
  "https://www.accessmycu.org/pdf/truthnsavings_old.pdf",
  "https://bank.example/docs/old-fee-schedule.pdf",
  "https://bank.example/docs/FeeScheduleOld.pdf",
  "https://bank.example/docs/fee-schedule-old-2021.pdf",
  "https://bank.example/archive/2019/fees.pdf",
  "https://bank.example/disclosures/prior-disclosures/",
  "https://bank.example/fees/previous-fee-schedule.pdf",
  "https://bank.example/fees/schedule%20(superseded).pdf",
  "https://bank.example/fees/obsolete/fee-schedule.pdf",
];

// Addresses that look close but are current pages (several are live documents on prod, Nov 3).
const CURRENT_ADDRESSES = [
  "https://bank.example/older-adults-checking",
  "https://bank.example/prior-notice",
  "https://bank.example/fees/prior-notice-required.pdf",
  "https://www.oldnational.com/fees.pdf",
  "https://oldsecond.com/fee-schedule",
  "https://www.oldpoint.com/personal/fee-schedule",
  "https://bank.example/old-national-fee-schedule.pdf",
  "https://bank.example/senior-savings",
  "https://bank.example/goldstar/fees",
  "https://bank.example/bold/fees",
  "https://www.linconefcu.org/files/lincone/1/file/Compliance-Folder/02.01.2025-Fee-Schedule.pdf",
  "https://www.dirigofcu.com/wp-content/uploads/2022/02/Schedule-of-Fees-2022-No-Bold.pdf",
  "https://www.americanexpress.com/content/dam/amex/en-us/company/legal/cardmember-agreements/american-express-gold-card-06-30-2026.pdf",
  "https://www.bankofhope.com/personal-banking/priority-checking",
  "https://www.springhillbank.com/personal-banking/golden-eagle-club-account/",
  "https://www.golden1.com/-/media/Golden1/Site%20Documents/Disclosures/C-14",
  "https://www.safcu.com/storage/UserFileFolder/Fee_Schedule_eff_1-1-2026.pdf",
  "https://bank.example/retired-military-checking",
  "https://bank.example/fees/hold-policy",
  "https://bank.example/fee-schedule",
];

describe("oldLabelledAddress", () => {
  it.each(OLD_ADDRESSES)("marks %s old", (url) => {
    expect(oldLabelledAddress(url)).not.toBeNull();
  });

  it.each(CURRENT_ADDRESSES)("leaves %s alone", (url) => {
    expect(oldLabelledAddress(url)).toBeNull();
  });

  it("names the word it matched", () => {
    expect(oldLabelledAddress("https://www.clackamascountybank.com/archive-2021/personal-checking.php")).toBe("archive");
    expect(oldLabelledAddress("https://cjpolicefirefcu.org/old-web-site/")).toBe("old");
  });

  it("never reads the host", () => {
    expect(oldLabelledAddress("https://old.bank.example/fee-schedule.pdf")).toBeNull();
    expect(oldLabelledAddress("https://archive.bank.example/fees")).toBeNull();
  });

  it("reads nothing from an empty or broken address", () => {
    expect(oldLabelledAddress(null)).toBeNull();
    expect(oldLabelledAddress("")).toBeNull();
    expect(oldLabelledAddress("not a url")).toBeNull();
  });
});

describe("oldLabelledLinkWords", () => {
  it.each(["Old Fee Schedule", "Fee Schedule (Archived)", "Previous Disclosures", "Fee Schedule - Old", "Prior Fee Schedule", "Archived Fee Schedules", "Fee Schedule 2021 (old)"])(
    "marks the label %s old",
    (label) => expect(oldLabelledLinkWords(label)).not.toBeNull(),
  );

  it.each(["Prior Notice Required", "Old National Bank Fee Schedule", "Old Second Fees", "Older Adults Checking", "Senior Savings", "Fee Schedule", "View our archive", "Old Point Financial", "previously found link"])(
    "leaves the label %s alone",
    (label) => expect(oldLabelledLinkWords(label)).toBeNull(),
  );
});

describe("oldLabelledLink", () => {
  it("reads the address, then the label", () => {
    expect(oldLabelledLink("https://bank.example/fee-schedule.pdf", "Old Fee Schedule")).toBe("old");
    expect(oldLabelledLink("https://bank.example/fee-schedule.pdf", "Fee Schedule")).toBeNull();
  });
});

describe("oldLabelledPrefilterSql", () => {
  it("is looser than the exact rule: every old address passes its pattern", () => {
    const pattern = /(old|archiv|previous|prior|supersed|expired|obsolete|outdated)/;
    for (const url of OLD_ADDRESSES) {
      const path = decodeURIComponent(url.replace(/^[a-z]+:\/\/[^/]+/i, "")).toLowerCase();
      expect(pattern.test(path) || pattern.test(url.replace(/^[a-z]+:\/\/[^/]+/i, "").toLowerCase())).toBe(true);
    }
    expect(oldLabelledPrefilterSql("sd.document_url")).toContain("sd.document_url");
  });
});
