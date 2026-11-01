/**
 * #1908 review (Oct 25): excerpts of stored texts (agent_source_texts, latest per document, non-empty
 * lines as stored) where an early draft of Knox v116 left out real fees. Each one is the account's fee
 * or the card's purchase price, and Knox must keep reading it.
 */
export const CARD_SECTION_KEEP_DOCS: Record<string, string> = {
  // AltaOne (doc 7837, live 76947-76949): the gift and reloadable cards' purchase prices by audience.
  "7837": [
    "Visa NSF / Insufficient Funds Payment Fee | $25",
    "Visa Share Secured Annual Fee | $30",
    "Visa Non-Reloadable Gift Cards",
    "Members | $3",
    "Non-Members | $5",
    "Inactivity Fee | $2.95",
    "Visa Reloadable Cards (General Purpose Card, Travel Card, Youth Card)",
    "Members | $5",
    "Non-Members | $9",
  ].join("\n"),
  // Doc 13154 (also 19662, 38787): gift card prices for members and non-members.
  "13154": [
    "International ATM/Debit Card Transactions* | Variable",
    "Garnishment or IRS Levy Fee | $50.00",
    "Gift Cards",
    "Members | $2.50",
    "Non-members | $4.50",
    "With Reward Checking, Kasasa Cash & Kasasa Cash Back | FREE",
    "With Perks+ Checking & Kasasa Tunes | FREE",
    "NSF – Nonsufficient Funds Fee | $25.00",
    "Online Banking / Bill Pay | FREE",
    "Overdraft Privilege NSF Fee | $25.00",
  ].join("\n"),
  // Doc 28000: stacked labels, "Per card $2.50" under "Gift Cards".
  "28000": [
    "Per card $5.00",
    "Gift Cards",
    "Per card $2.50",
    "Notice of LEVY charge",
    "Per notice $150.00",
    "Notary Fee",
    "Customer FREE",
    "Non-Customer Not Available",
  ].join("\n"),
  // Doc 28784: a header row, then member and non-member prices per card.
  "28784": [
    "Document Copy | $15",
    "Visa® Gift Cards (non-reloadable)",
    "Fee Type | Fee Amount",
    "Member | $2.50/card",
    "Non-Member | $5/card",
  ].join("\n"),
  // Doc 29093: the gift card's customer price, then the account's wire fees.
  "29093": [
    "Telephone transfer request | $5",
    "VISA® Gift card or VISA® Money card",
    "Customer | $5",
    "(See VISA® terms & conditions for additional usage fees which may apply)",
    "Wire transfers: Outgoing domestic (customer) | $25",
    "Outgoing international (customer) | $50",
    "Incoming domestic (customer) | $5",
    "Incoming international (customer) | $10",
  ].join("\n"),
  // Doc 32047 (also 38488): gift card prices, then the account's external loan payments.
  "32047": [
    "Statement Copy/ Account Printout | $2",
    "VISA Gift Card",
    "— Member | $3",
    "— NON-Member | $5",
    "VISA CUMONEY Travel Card | $7",
    "— Reload | $2",
    "External Payment Online | $8",
    "External Payment By Phone | $10",
  ].join("\n"),
  // Doc 38218: "Per card" under "Gift Cards", then the debit card section.
  "38218": [
    "Rush Card | $65.00",
    "Gift Cards",
    "Per card | $3.95",
    "Debit Cards",
    "Replacement card | $15.00",
    "Rush Card | $65.00",
  ].join("\n"),
  // Doc 24508 (also 34116): a checking account's perk line, then its monthly fee.
  "24508": [
    "No Charge for Notary",
    "No Purchase Fee VISA Travel Money Cards & Gift Cards",
    "Avoid $18 Monthly Fee with:",
    "$4,000 minimum daily balance OR",
    "$6,000 average daily balance OR",
  ].join("\n"),
  // Doc 29762: a wrapped card row ("... Visa $5.00" / "Travel Card"), then share and draft fees.
  "29762": [
    "Business Account Service Charge | $12-$20 monthly",
    "Debit Card Replacement/ Visa Gift Card/Reloadable Card/ Visa $5.00",
    "Travel Card",
    "Inactivity Fee (defined as no activity for 6 months on any share or $5.00 per month",
    "draft)",
    "Dormancy Fee (defined as no activity for 24 months with balances $5.00 per month",
    "<$1,000)",
    "Subpoena/Levy/Garnishment | $35.00 each",
  ].join("\n"),
  // Doc 16435: a business package column interleaved with the travel card rows.
  "16435": [
    "Gift Cards | $4 per card | Small Business Package Free",
    "non-reloadable, other fees may apply",
    "Standard Business Package $10 monthly",
    "Visa Travel Cards",
    "reloadable for 12 months, other fees may | $10 per card",
    "Commercial Business Package $30 monthly",
    "apply",
  ].join("\n"),
  // ELGA (doc 20767, also 18437): the account's column interleaved with "Prepaid Cards:".
  "20767": [
    "Charged per withdrawal after one per year",
    "Prepaid Cards:",
    "Collection Item Processing (All Other Currency) ................... $95.00",
    "Gift Card ................................................................................. $3.00",
    "Early Closure .......................................................................... $5.00",
    "If an account is closed within the first six months of opening | In Branch Reload Service ....................................................... $2.00",
    "ELGA Perks ................................................................. $6.95/month | Online Reload Service .............................................................. Free",
    "Focus Checking…………………….…………………… $10.00/month | Prepaid Reloadable Card ....................................................... $5.00",
    "For all other Prepaid credit card service charges, see our Gift Card",
  ].join("\n"),
};
