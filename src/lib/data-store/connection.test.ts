import { describe, expect, it } from "vitest";
import {
  JSON_TEXT_PASSTHROUGH,
  NUMERIC_AS_NUMBER,
  serializeJsonParam,
  stripNulChars,
  TEXT_WITHOUT_NUL,
  usesTransactionPooler,
} from "./connection";

describe("usesTransactionPooler", () => {
  it("is true only for the 6543 pooler port, so idle_session_timeout is sent only direct", () => {
    expect(usesTransactionPooler("postgresql://postgres:pw@db.ref.supabase.co:6543/postgres")).toBe(true);
    expect(usesTransactionPooler("postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres")).toBe(true);
    expect(usesTransactionPooler("postgresql://postgres:pw@db.ref.supabase.co:5432/postgres")).toBe(false);
    expect(usesTransactionPooler("not a url")).toBe(false);
  });
});

describe("NUMERIC_AS_NUMBER", () => {
  it("parses postgres NUMERIC (oid 1700) text into numbers", () => {
    expect(NUMERIC_AS_NUMBER.from).toEqual([1700]);
    expect(NUMERIC_AS_NUMBER.parse("35.00")).toBe(35);
    expect(NUMERIC_AS_NUMBER.parse("0.50")).toBe(0.5);
  });

  it("serializes numbers back to text for parameters", () => {
    expect(NUMERIC_AS_NUMBER.serialize(12.5)).toBe("12.5");
  });
});

describe("JSON_TEXT_PASSTHROUGH", () => {
  it("handles both json (114) and jsonb (3802) parameters", () => {
    expect(JSON_TEXT_PASSTHROUGH.from).toEqual([114, 3802]);
  });

  it("passes JSON text through instead of encoding it a second time", () => {
    const flags = JSON.stringify(["needs_darwin_verification", "canonical_hint:overdraft"]);
    expect(serializeJsonParam(flags)).toBe(flags);
    expect(JSON.parse(serializeJsonParam(flags))).toEqual(["needs_darwin_verification", "canonical_hint:overdraft"]);
    expect(serializeJsonParam('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("encodes objects, arrays and plain strings as before", () => {
    expect(serializeJsonParam({ a: 1 })).toBe('{"a":1}');
    expect(serializeJsonParam(["x"])).toBe('["x"]');
    expect(serializeJsonParam("hello")).toBe('"hello"');
    expect(serializeJsonParam("[not json")).toBe('"[not json"');
    expect(serializeJsonParam(42)).toBe("42");
  });

  it("parses json results", () => {
    expect(JSON_TEXT_PASSTHROUGH.parse('["a"]')).toEqual(["a"]);
  });
});

describe("NUL characters", () => {
  it("strips NUL from text, bpchar and varchar parameters", () => {
    expect(TEXT_WITHOUT_NUL.to).toBe(25);
    expect(TEXT_WITHOUT_NUL.from).toEqual([25, 1042, 1043]);
    expect(TEXT_WITHOUT_NUL.serialize("Over\u0000draft fee\u0000")).toBe("Overdraft fee");
    expect(TEXT_WITHOUT_NUL.serialize("clean")).toBe("clean");
    expect(stripNulChars("\u0000\u0000")).toBe("");
  });

  it("strips NUL from json parameters, whether objects or JSON text", () => {
    expect(serializeJsonParam({ error: "bad\u0000byte", n: 1 })).toBe('{"error":"badbyte","n":1}');
    expect(serializeJsonParam(JSON.stringify({ error: "bad\u0000byte" }))).toBe('{"error":"badbyte"}');
    // A literal backslash-u sequence is data, not a NUL, and survives.
    expect(JSON.parse(serializeJsonParam({ note: "\\u0000" }))).toEqual({ note: "\\u0000" });
  });
});
