# 2026-11-01: a loan's estimated payment was read and published as a fee (#2854)
**What happened:** Pelican Credit Union (institution 7482, pelicancu.com/fees-and-disclosures, document
31892, stored text 29794) has four live fees named "Loan Documentation Fee, estimated payment", filed
`other_lending_fee`, published Oct 13 (batch `agentic-run-5440`): 141052 ($1,473.89), 141053
($1,172.15), 141054 ($622.75) and 141055 ($870.78). The bank's own words, each in a sample-loan rate
disclosure:

> APR = Annual Percentage Rate. Sample auto loan is $50,000 for 36 months at a rate of 3.89%. APR is
> 3.99%, which includes a $75.00 Loan Documentation Fee, estimated payment of $1,473.89, with a maximum
> LTV of 100%, and a minimum credit score of 775.

The $1,473.89 is the monthly payment on the sample loan, not a charge. The real fee in the sentence, the
$75 Loan Documentation Fee, is live on its own (80375). The four payments inflated `other_lending_fee`
for this bank and any median it feeds.

**Cause (Knox, extraction):** the rules pass cut the sentence at the commas and read the clause "Loan
Documentation Fee, estimated payment of $1,473.89" (raw 669616-669619): a fee word before a price, so
it took the price and named it by every word before it. Knox had no rule that a payment example or
amortization figure is never a charge. Darwin verified the four and Hamilton published them because the
name and price trace to the text: the shared check (`checkFeeAgainstSource`) passes all four (it traces
the sentence), so no later step could see the problem.

**Fix (Knox v153, drop-only):** `loanPaymentExample` in `knox/rules.ts`, asked by the rules pass and the
family experts, sets a price aside when the words right before it are an estimated, sample, example,
approximate, typical, scheduled, regular or total payment, a monthly payment "of" or "would be" a
figure, a count of payments ("60 monthly payments of"), the total of payments or the amount financed;
when "per $1,000 borrowed" (financed, of the loan) follows it; or when "for 60 months" follows it after
payment words with no fee word between. A fee word between the payment words and the price keeps the
price (skip-a-payment, late payment, "Monthly Payment Late Fee (After 15 days) ..... $15"), and finance
charges are not on the list (prepaid finance charge, cash advance finance charge). The drop is counted
as `loan_payment_example` on the run ledger. On Pelican's stored text Knox now reads none of the five
payments (four live, one held: "APR and the estimated monthly payment" $2,201.09) and still holds the
$75 documentation fee as before. The shared check is unchanged. The stale-read floor stays at v97.

**Live re-check (Darwin, `darwin/loan-payment-example-check.ts`, switch off):** each verify step reads
every live flat fee above $0 whose stored line has payment words, the amount financed, per $1,000 or "for
N months", and asks Knox's own test at every place the line prints the fee's price; a line that also
prints that price as a fee is kept, and admin-corrected fees are never read. The switch is the
environment variable `DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE` (off unless "true"). On, a match goes
through the 12-hour second look and is rolled back as `loan_payment_example: ...`, its verified row
rejected with that flag.

**Dry run (prod, read-only, Nov 1):** the prefilter selects 443 live flat fees, none admin-corrected; 4
match, all at one institution:

| live fee | institution | amount | name | stored line |
|---|---|---|---|---|
| 141052 | 7482 | $1,473.89 | Loan Documentation Fee, estimated payment | Loan Documentation Fee, estimated payment of $1,473.89 |
| 141053 | 7482 | $1,172.15 | Loan Documentation Fee, estimated payment | Loan Documentation Fee, estimated payment of $1,172.15 |
| 141054 | 7482 | $622.75 | Loan Documentation Fee, estimated payment | Loan Documentation Fee, estimated payment of $622.75 |
| 141055 | 7482 | $870.78 | Loan Documentation Fee, estimated payment | Loan Documentation Fee, estimated payment of $870.78 |

Each was checked against the bank's stored text with `checkFeeAgainstSource`: all four trace to the
sample-loan sentence ("Sample ... loan is $50,000 for N months ... estimated payment of $X"), which is
the payment, so all four are wrong and the sample is clean. The wider class was looked for beyond name
matches and read by eye: every live fee over $300 in a lending, loan, late, mortgage or origination
category, or with "payment" in its stored line (all rows), and the 80 largest live fees whose name says
payment or whose stored line says "payment(s) of $", "per $1,000", "for N months", "repayment" or
"amortiz". No other payment example is live. (Seen on the way, not this class: 101826, a $500 appraisal
fee reimbursement, is money paid to the customer, the #2137 reward shape.) The 7 live fees issue #2854 measured that
name a payment (101785, 101786, 20778, 141417, 141418, 53579, 104015) are kept by both Knox and Darwin.
775 stored texts at 169 institutions print a payment-example phrase; only Pelican's got live, but a
re-read of any of them would no longer read one.

**Lesson:** a price that traces to the bank's text is not thereby a fee: a loan's payment example is the
rate disclosure's arithmetic, and a fee name right before the payment words in the same sentence does
not make the payment the fee's price.

**Agent lesson:** knox/issue-2854-loan-payment-example-is-no-charge, darwin/issue-2854-a-traced-price-can-still-be-no-charge
**Guard:** `src/lib/agents/knox/loan-payment-example.test.ts`, `src/lib/agents/darwin/loan-payment-example-check.test.ts`
