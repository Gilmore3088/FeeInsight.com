// @vitest-environment node
/** Exact finite coverage tradeoffs for #2278. These are prospective scope holds/declines,
 * not certifications that the hand-keyed numeric prices are wrong. The original answer
 * keys, their amounts/categories and all wrong-read ceilings remain unchanged. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { gateKeyFor, gateReads, type AnswerKeyDocument } from "@/lib/agents/knox/answer-key-gate";
import { internationalWireEligibility } from "@/lib/agents/knox/international-wire-eligibility";
import { sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";

const boundaries = [
  {
    "frame": "texas",
    "tid": 2451,
    "textHash": "fcdca0d4857a15c55b7b1da964231298f22b36b1507c0a150de932c0d1fbf348",
    "key": "wire_intl_outgoing:4000",
    "keyed": true,
    "candidate": {
      "feeName": "Wire Transfer - Outgoing Foreign Currency, Customer only, each plus cost",
      "amount": 40,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "Wire Transfer - Outgoing Foreign Currency, Customer only, each plus cost ...........................$40 | Temporary Checks Fee, per 12 checks ....................................................................................................... $5"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "ambiguous_owner"
    },
    "review": {
      "kind": "decline",
      "reason": "ambiguous_owner"
    }
  },
  {
    "frame": "texas",
    "tid": 2414,
    "textHash": "f6e1f74a107dd676ac65c0ab2a5c75810fb579f30e1df8ab130b83ae712e1435",
    "key": "wire_intl_outgoing:5000",
    "keyed": true,
    "candidate": {
      "feeName": "Wire Transfers (VeraBank customers only) - International Wires",
      "amount": 50,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "Wire Transfers (VeraBank customers only) - International Wires | $50.00"
    },
    "scope": {
      "kind": "owned",
      "geography": "international",
      "directions": []
    },
    "review": {
      "kind": "hold",
      "reason": "direction_missing"
    }
  },
  {
    "frame": "texas",
    "tid": 2420,
    "textHash": "890fbfcfd0e23b3bd11d1797c7018d9ae40d1ac6fe805a393afeec6e42a0512c",
    "key": "wire_intl_outgoing:4500",
    "keyed": true,
    "candidate": {
      "feeName": "Wire Transfers Outgoing (Foreign)",
      "amount": 45,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "Wire Transfers Outgoing (Foreign) | $45.00 each"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "ambiguous_owner"
    },
    "review": {
      "kind": "decline",
      "reason": "ambiguous_owner"
    }
  },
  {
    "frame": "texas",
    "tid": 2424,
    "textHash": "65649bfca2bc828d31d0da9b3ed0c0b050328ad525c4bb686dc55137893bd5bf",
    "key": "wire_intl_outgoing:4500",
    "keyed": true,
    "candidate": {
      "feeName": "Foreign Wire",
      "amount": 45,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "Foreign Wire: | $45.00"
    },
    "scope": {
      "kind": "owned",
      "geography": "international",
      "directions": []
    },
    "review": {
      "kind": "hold",
      "reason": "direction_missing"
    }
  },
  {
    "frame": "texas",
    "tid": 2425,
    "textHash": "f8ca9ef29821dce9cec170a43ce836dc3cb608dab9d3e698605977292a652d87",
    "key": "wire_intl_outgoing:6100",
    "keyed": true,
    "candidate": {
      "feeName": "Wire Transfer Fee – International",
      "amount": 61,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "Wire Transfer Fee – International $61.00"
    },
    "scope": {
      "kind": "owned",
      "geography": "international",
      "directions": []
    },
    "review": {
      "kind": "hold",
      "reason": "direction_missing"
    }
  },
  {
    "frame": "texas",
    "tid": 2426,
    "textHash": "82d16ab0d75e5130b9d59d03d84ae9ac2cdc545b9312152e7ccb7ebbf7cdb710",
    "key": "wire_intl_outgoing:3500",
    "keyed": true,
    "candidate": {
      "feeName": "International Outbound Wires (Online)",
      "amount": 35,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "International Outbound Wires (Online/Manual) | $35/$75 | $35/$75"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "missing_owner"
    },
    "review": {
      "kind": "decline",
      "reason": "missing_owner"
    }
  },
  {
    "frame": "texas",
    "tid": 2426,
    "textHash": "82d16ab0d75e5130b9d59d03d84ae9ac2cdc545b9312152e7ccb7ebbf7cdb710",
    "key": "wire_intl_outgoing:7500",
    "keyed": true,
    "candidate": {
      "feeName": "International Outbound Wires (Manual)",
      "amount": 75,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "International Outbound Wires (Online/Manual) | $35/$75 | $35/$75"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "missing_owner"
    },
    "review": {
      "kind": "decline",
      "reason": "missing_owner"
    }
  },
  {
    "frame": "texas",
    "tid": 2437,
    "textHash": "20489e3a084314547c5d4b07ef74fdc9466b745cc80ebaacae9c0da1e54ca451",
    "key": "wire_intl_outgoing:5000",
    "keyed": true,
    "candidate": {
      "feeName": "Wire Transfers: International (each attempt)",
      "amount": 50,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "Wire Transfers International (each attempt) | $50"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "missing_owner"
    },
    "review": {
      "kind": "decline",
      "reason": "missing_owner"
    }
  },
  {
    "frame": "state",
    "tid": 3981,
    "textHash": "0f617d16c999595d74696bbd18e99559ab36be7a64fc3802b8034cee36b6b29b",
    "key": "wire_intl_outgoing:4500",
    "keyed": true,
    "candidate": {
      "feeName": "Wire Transfer - International",
      "amount": 45,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "Wire Transfer - International............................................... $45.00 | NSF Withdrawal-Courtesy pay ................................ $14.00 per use"
    },
    "scope": {
      "kind": "owned",
      "geography": "international",
      "directions": []
    },
    "review": {
      "kind": "hold",
      "reason": "direction_missing"
    }
  },
  {
    "frame": "state",
    "tid": 5608,
    "textHash": "f709a09a13da55acd9798c89bc2dbffa890211a42efba570b702018c40c20a11",
    "key": "wire_intl_outgoing:3000",
    "keyed": true,
    "candidate": {
      "feeName": "Int’l Wire Fee Out +",
      "amount": 30,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "The total fee for an Outgoing International Wire Transfer sent in foreign currency is $75. ($45 Int’l Wire Fee Out + $30 Wire FX Fee)"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "missing_owner"
    },
    "review": {
      "kind": "decline",
      "reason": "missing_owner"
    }
  },
  {
    "frame": "state",
    "tid": 5608,
    "textHash": "f709a09a13da55acd9798c89bc2dbffa890211a42efba570b702018c40c20a11",
    "key": "wire_intl_outgoing:7500",
    "keyed": false,
    "candidate": {
      "feeName": "Total fee for an Outgoing International Wire Transfer sent in foreign currency is",
      "amount": 75,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "The total fee for an Outgoing International Wire Transfer sent in foreign currency is $75. ($45 Int’l Wire Fee Out + $30 Wire FX Fee)"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "missing_owner"
    },
    "review": {
      "kind": "decline",
      "reason": "missing_owner"
    }
  },
  {
    "frame": "state",
    "tid": 7450,
    "textHash": "3dfb175890bfe1c24e9dca4db0ea2bb16e0d2aad684eab14b9c6ef2d3385a629",
    "key": "wire_intl_incoming:1000",
    "keyed": true,
    "candidate": {
      "feeName": "Incoming Wire Tranfer - International",
      "amount": 10,
      "canonicalHint": "wire_intl_incoming",
      "excerpt": "Incoming Wire Tranfer - International $10 $10 $10 $10 $10"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "unsupported_shape"
    },
    "review": {
      "kind": "decline",
      "reason": "unsupported_shape"
    }
  },
  {
    "frame": "state",
    "tid": 3554,
    "textHash": "70a8bd7da47322b61141995852cd35b400c6af6e9b929f0e8e3e9ca50fc50c41",
    "key": "wire_intl_outgoing:5000",
    "keyed": true,
    "candidate": {
      "feeName": "WIRE TRANSFER: FOREIGN",
      "amount": 50,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "WIRE TRANSFER FOREIGN | N/A | $50"
    },
    "scope": {
      "kind": "unresolved",
      "reason": "missing_owner"
    },
    "review": {
      "kind": "decline",
      "reason": "missing_owner"
    }
  },
  {
    "frame": "state",
    "tid": 10279,
    "textHash": "3507d67a4188003f778806438b36ba4bf3d2885481a2d38efd340b6f6a2b4dcf",
    "key": "wire_intl_outgoing:7500",
    "keyed": true,
    "candidate": {
      "feeName": "International Wire Transfer",
      "amount": 75,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "International Wire Transfer | $75.00/transfer"
    },
    "scope": {
      "kind": "owned",
      "geography": "international",
      "directions": []
    },
    "review": {
      "kind": "hold",
      "reason": "direction_missing"
    }
  },
  {
    "frame": "state",
    "tid": 12030,
    "textHash": "6b945e6a8cb6e89bd4d74ab0dbcfe94e4936019265e457840216f0e354ce8f2c",
    "key": "wire_intl_outgoing:6000",
    "keyed": true,
    "candidate": {
      "feeName": "Wire Fee Foreign",
      "amount": 60,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "Wire Fee Foreign / $60.00"
    },
    "scope": {
      "kind": "owned",
      "geography": "international",
      "directions": []
    },
    "review": {
      "kind": "hold",
      "reason": "direction_missing"
    }
  },
  {
    "frame": "state",
    "tid": 7114,
    "textHash": "28655b68a830f52ba4a9df58760f0627033932e62184416c480df6c655e039fe",
    "key": "wire_intl_outgoing:5000",
    "keyed": true,
    "candidate": {
      "feeName": "International wire transfer",
      "amount": 50,
      "canonicalHint": "wire_intl_outgoing",
      "excerpt": "International wire transfer $50.00 per wire | 7Fees for expedited payments are assessed by bill pay provider and"
    },
    "scope": {
      "kind": "owned",
      "geography": "international",
      "directions": []
    },
    "review": {
      "kind": "hold",
      "reason": "direction_missing"
    }
  }
] as const;
const documents = new Map<string, AnswerKeyDocument>();
for (const frame of ["texas", "state"] as const) {
  const file = join(process.cwd(), `src/lib/agents/knox/__fixtures__/${frame}-answer-keys.json.gz`);
  const fixture = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as { keys: AnswerKeyDocument[] };
  for (const document of fixture.keys) documents.set(`${frame}:${document.tid}`, document);
}
const readOnce = new Map<string, Set<string>>();
describe("explicit international-wire scope coverage tradeoffs (#2278)", () => {
  it.each(boundaries)("$tid $key remains withheld for $review.kind/$review.reason", boundary => {
    const id = `${boundary.frame}:${boundary.tid}`;
    const document = documents.get(id);
    if (!document) throw new Error(`Missing exact saved answer-key document ${id}`);
    expect(createHash("sha256").update(document.text).digest("hex")).toBe(boundary.textHash);
    const originalExpected = new Set(document.fees.map(fee => gateKeyFor(fee, document.text)));
    expect(originalExpected.has(boundary.key)).toBe(boundary.keyed);
    expect(sourceOwnedWireScope(document.text, boundary.candidate.feeName, boundary.candidate.amount)).toMatchObject(boundary.scope);
    expect(internationalWireEligibility(document.text, boundary.candidate)).toMatchObject(boundary.review);
    if (!readOnce.has(id)) readOnce.set(id, gateReads(document.text));
    expect(readOnce.get(id)!.has(boundary.key)).toBe(false);
    // A whole saved document is read through every Knox pass and the shared check (about 4 s for
    // tid 2451 on a laptop), so the default 5 s limit fails on a loaded CI runner.
  }, 20_000);
});
