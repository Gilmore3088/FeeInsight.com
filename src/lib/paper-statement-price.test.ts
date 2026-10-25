import { describe, expect, it } from "vitest";
import { paperStatementPriceOnLine } from "@/lib/paper-statement-price";

describe("paperStatementPriceOnLine (#1947)", () => {
  // Live fees filed as monthly maintenance, each its own stored line (Oct 25).
  it.each([
    ["Paper statements: $3 monthly fee", 3], // TD Bank 152525 (#1947)
    ["Paper (mailed) Statement Fee **** | $2.00 Monthly Fee", 2], // 126632
    ["Service charge | $3.00 paper statement fee each statement cycle that you receive printed statements by mail", 3], // 129872
    ["Personal Checking | $4.00 per month paper statement fee, unless enrolled in eStatements", 4], // 123289
    ["Silver+ Checking | Maintenance fees: A $2.00 monthly paper statement fee will be charged", 2], // 136154
    ["No. Scott Credit Union checking accounts do not charge a monthly maintenance fee. A $2 paper statement fee applies if you are not enrolled in eStatements.", 2], // 107916
    ["*$5 monthly service charge when balance falls below $300. $2 paper statement fee.", 2], // 125163
    ["Monthly maintenance fee + $5 paper statement fee", 5], // 103917
    ["In addition to the monthly maintenance fee, the Credit Union assesses a $3.50 charge for each original paper statement printed and mailed per statement cycle unless your specific", 3.5], // 62259
    ["** To avoid a Monthly Service Fee of $5 per paper statement, you must enroll for E-Statements within 30 days of account opening.", 5], // 131970
    ["Monthly Service Charge / $3 monthly service charge for paper statements", 3], // 82929
    ["*A monthly fee of $3 applies if you choose to receive paper statements.", 3], // 128394
    ["**A monthly fee of $5.00 may be charged to accounts receiving a paper statement.", 5], // 137254
    ["Waive this monthly service charge if requirements below are met / $2 per month paper statement fee", 2], // 135980
    ["Prime Checking Account | $1.00 per month (paper statement)", 1], // 138716
    ["• Everyday Checking: $2.50 per month if member receives mailed, paper statements", 2.5], // 95610
    ["*For eBanking Checking there is a $5 monthly fee if you receive a printed statement by mail", 5], // 121064
    ["Monthly Service Fees | $5.00 fee per cycle period for requested paper statement | $10.00 if balance falls below $5,000", 5], // 85521
    ["Monthly Service Fees | None | $5 per paper statement if not enrolled in eStatements within 30 days of account opening** | $6 if $300 minimum balance", 5], // 147192
    ["A $6.00 monthly paper statement service charge will apply when not enrolled.", 6], // 14316 (taken down)
  ])("%s ($%s) is the paper statement charge", (line, amount) => {
    expect(paperStatementPriceOnLine(line, amount)).not.toBeNull();
  });

  it.each([
    // The account's own fee for paper holders, beside an electronic price.
    ["Checking Monthly fee $4 for paper statement or $3 for estatement", 4],
    ["Monthly Service Charge $7 with paper statement; $5 with electronic statement", 7],
    ["Monthly service charge is $12 with online banking and eStatements or $14 with paper statements", 12],
    ["Service Charge / $7 Monthly Service Charge w/Paper Statement", 7],
    ["Monthly Service Charge | $3 with paper statement", 3],
    // The paper charge is another price on the line.
    ["Maintenance Fee | $7 per month with eStatements4 Paper statements available for an additional $3 per month", 7],
    ["Monthly Base Fee in Service Charge $4.00 eStatements included. Paper statements optional - $2.00 per month", 4],
    ["*$5 monthly service charge when balance falls below $300. $2 paper statement fee.", 5],
    ["Monthly fee.................................................................. | $5 | Paper statement ........ | $2", 5],
    // A balance or another condition decides the fee.
    ["There is a $3.00 monthly fee for FirstLink Basic if the daily balance falls below $100 or you opt for paper statements.", 3],
    ["Maintenance Fee | $1.00 plus $0.10 per check or paper draft with a limit of 15 per statement cycle.", 1],
    ["Monthly Service Fee | $3 (To avoid a monthly fee, switch to a Free Checking Account by electing to receive eStatements instead of paper statements)", 3],
    ["Monthly fee: $15", 15],
    ["Monthly Service Fees | $5.00 fee per cycle period for requested paper statement | $10.00 if balance falls below $5,000", 10],
    ["♦ Low Monthly Service Charge – All of these great benefits for a monthly service charge of just $6.95 (includes a paper statement) or $5.00 if you enroll in eStatements.", 6.95],
    ["$5.00 monthly service charge, reduced to $3.00 if customer goes “paperless”", 5],
    ["Monthly Service Charge | $3.00 Fee may be waived if statements are received electronically in lieu of paper statements(9)", 3],
    ["Monthly Service fee (Checking opened on or after 08/01/24): | $2.00* per month; if enrolled in Paperless Statements, fee is waived", 2],
    ["eStyle Account Monthly Service Charge: $5.00 | Paper Statement Fee:", 5],
    ["Accounts not maintaining a $250 balance will be assessed a monthly service fee of either $2.50 with eStatements or $5.00 with paper statements", 5],
    ["Paper statements: $3 monthly fee", 0],
  ])("%s ($%s) is not", (line, amount) => {
    expect(paperStatementPriceOnLine(line, amount)).toBeNull();
  });
});
