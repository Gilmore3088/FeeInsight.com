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

**The switch stays off.** What is left would still take down real prices. The next step is a rule
for the 46 `outgoing_only` and 13 `other_international_outgoing` rows. On these schedules an
undirected international line beside a domestic outgoing line is still the outgoing price. Then
re-count and re-sample.

**Lesson:** a re-check that takes live fees down needs evidence that the fee is wrong, not just a
missing word that verify asks for on new rows. Read the whole document before calling a price wrong.

**Agent lesson:** darwin/issue-1912-undirected-international-wire-is-outgoing
**Guard:** `src/lib/agents/darwin/international-direction-check.test.ts` (verbatim lines of 90279,
73732, 70332, 71822 and 137423)
