# 2026-11-02: the international-direction takedown removed real outgoing wire prices

**What happened:** `INTERNATIONAL_DIRECTION_TAKEDOWN_LIVE` (PR #2762, #1912) was sampled before it
went on, under the sampled-clean rule (DECISIONS 2026-10-20). The prod step's last full pass, still
in report mode, matched about 420 live fees. In a sample of 20 of its stored matches, 19 were real
international wire fees, priced the way outgoing wires are, for example:
- 90279: "- Incoming Wire Transfers | Free" above "- International Wire Transfers | $50.00".
- 73732: "Domestic wire (incoming) | FREE" above "International wire | $35.00".
- 70332: "Wire Transfers – Incoming | $15 each" above "International Wires | $60 + costs per wire".

They were taken down as `direction_missing` only because their own line does not say "outgoing".
The one right takedown was 137423, a $55 international wire that the bank says it does not offer.

**Cause:** the live re-check reused verify's admission rule unchanged. A new international wire is
admitted only when its own line states its direction, and holding one at verify is cheap. Applied to
live fees, the same rule takes down a real price for lacking a word, even when the rest of the
schedule makes the direction plain.

**Fix (Darwin's direction check v2):** `undirectedWireReading` reads the fee's whole document. It
looks only at the document's other wire lines: a line with a wire word, or one under an unpriced
wire heading at most six lines up. It reads each with the review's own words (`wireScopeFacts`).
An undirected international wire filed `wire_intl_outgoing` stays live (`undirectedOutgoing`) when:
- another wire line names incoming wires (71822: "Wire Transfers:" over "Incoming | $20.00",
  "International | $65.00", "Outgoing | $30.00"), or
- no wire line names a direction.

It is still a match when:
- its own line says the bank does not offer it (`not_offered`, 137423);
- another line prices an international wire as outgoing;
- the document names outgoing wires and never incoming ones;
- it is filed incoming.

Only the live re-check reads it. Verify, Knox's eligibility and Hamilton's publication still admit
a new international wire only on its own stated direction (#2386), and a hold takes nothing down.

**Count:** prod, read-only, Nov 2. All 2,458 live wire fees the check reads were run through
`findInternationalDirections` locally, with their 1,955 stored texts; each text's sha256 equals its
stored `text_hash`.
- At v1, 420 match, the same as the prod step's last pass.
- At v2, 65 match at 63 institutions:
  - 61 `direction_missing`: 46 on a schedule that names outgoing wires and never incoming ones,
    13 beside another line pricing an international wire as outgoing, and 2 filed incoming;
  - 3 `direction_mismatch`;
  - 1 `not_offered` (137423).
- 355 are kept. 510 are unproven and 199 are left for Knox, as before.

**Sample (seed sw-2026-11-02, 20 of the 65):** 3 are right:
- 137423 is a service the bank does not offer;
- 87860 is "Wire Transfer Foreign | $35.00 in", filed outgoing;
- 147524 is "International in Euros", filed incoming with no direction on its line.

17 are wrong. Each is a real international wire price, mostly on a schedule that lists an
outgoing domestic wire and never an incoming one. Examples:
- 65352: "Outgoing Wire Fee | $30.00" over "Foreign Wire Fee | $50.00".
- 68406: "International Wire $40.00" beside "Outgoing Wire $22.50".
- 86541: "Domestic wire transfers | Outgoing: $20 each" over "International wire transfers | $40 each".
- 138958: "Outgoing Wire Fee | $20.00 per request" over "International Wire Fee | $30.00 per request".
- 126523: "International Wire (US currency) | $25.00" under "Wire Origination (through Business
  Electronic Banking)".
- 139028: an all-$0 schedule's "Wire Transfer Fee (International) | $0.00".
- Also 92835, 125389, 120671, 88563, 150864, 121545, 131206, 131964, 110741, 125902 and 83070.

At v2 the switch stayed off, because what was left would still take down real prices.

**Fix (v3, same day):** an undirected international wire filed `wire_intl_outgoing` is the outgoing
international price. That holds on a schedule that prices only outgoing wires (65352: "Outgoing Wire
Fee | $30.00" over "Foreign Wire Fee | $50.00"). It also holds beside another line pricing an
international wire as outgoing, which is a duplicate or a second tier, not a direction error. A fee
comes down only when:
- its own line says the bank does not offer the service (`not_offered`, 137423);
- its own words name the other direction (`direction_mismatch`: 87860 "Wire Transfer Foreign |
  $35.00 in", filed outgoing);
- it is filed incoming and its line names no direction (147524 "International in Euros | $20.00 per
  item"), since the undirected line is the outgoing price;
- the document prices an incoming international wire on its own line at exactly this fee's price.

Two refinements came from the first v3 count of 9:
- A price both directions share is no evidence. 139028's fee-free schedule prints "Incoming Wire –
  International | $0.00" and "Outgoing Wire – International Wire (USD) | $0.00".
- Only schedule lines (160 characters or fewer) are read for that incoming price. Embers CU's
  paragraph "There is a $40 fee for international wires. Because international wire requirements can
  vary by country and receiving financial institution, ..." names no incoming wire (139807).

**v3 count** (same 2,458 rows and texts): 7 match at 7 institutions. 413 undirected wires filed
outgoing are kept; 510 are unproven and 199 are left for Knox, as before.
- 3 `direction_mismatch`: 87860; 100178 ("Wire Transfers – (International) $30.00 Incoming Wire
  Fee", filed outgoing at $30, while the bank's outgoing is $50.00); 109961 ("International Wire
  Transfers | $20.00 (Incoming) | $40.00 (Outgoing)", filed outgoing at $20).
- 3 `direction_missing`:
  - 92821, filed incoming at $50, is "Foreign Wires - Manual/ In-Branch | $50.00" beside the bank's
    "Incoming | $5.00".
  - 147524 is filed incoming.
  - 152355 is "International Wire Module | $20.00 | Per Month", filed outgoing. Fulton's
    "International Incoming | $20.00 | Per Wire" has the same price. The fee is a monthly module,
    not Fulton's outgoing international wire ($35.00 to $70.00), so the takedown is right, though
    the price match is a coincidence.
- 1 `not_offered`: 137423.

**Sample (seed sw-2026-11-02-v3):** all 7, since fewer than 20 remain. Each was read against its
stored text, and every one is right. **The switch is on.**

**v4 (PR #2890 review, Nov 2):** the independent review built schedules where v3's price match took a
real outgoing wire down: an international ACH or app transfer line ("International ACH transfers
received | $25.00") read as the incoming wire price, a correspondent-fee ceiling ("$15.00 plus
correspondent bank fees up to $35.00") read as a second incoming price, and a bank charging the same
both ways ("International Wire Transfer | $15.00" beside "Incoming International Wire | $15.00").
v4 reads a price, in either direction, only from a wire's own price line (no ACH, IAT, app
transfer, amendment, recall or trace) and only its first price ("Free ($10.00 if under $100)" is
free), and counts an equal incoming price only when the document also prices an outgoing
international wire at another price. A second review pass found the outgoing side unscreened; it
now uses the same filters. Same rows: 6
match at 6 institutions, the v3 set minus 152355. Fulton's document prices no outgoing
international wire on a line the check reads, so its equal price is no longer evidence. Its fee
stays live: it is a monthly module filed as a wire, a category error for Knox's re-read, not a
direction error. All 6 were among the 7 checked right at v3.

**Lesson:** a re-check that takes live fees down needs evidence that the fee is wrong, not just a
missing word that verify asks for on new rows. Read the whole document before calling a price wrong;
for an undirected international wire, the evidence is the document's own incoming international
price.

**Agent lesson:** darwin/issue-1912-undirected-international-wire-is-outgoing,
darwin/issue-1912-undirected-wire-down-only-at-the-incoming-price
**Guard:** `src/lib/agents/darwin/international-direction-check.test.ts` (verbatim lines of 90279,
73732, 70332, 71822, 137423, 65352, 109961, 139028, 139807 and 152355, and the v4 review's ACH,
correspondent-fee and same-both-ways schedules)
