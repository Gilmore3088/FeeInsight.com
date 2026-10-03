import { describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, serializeJsonParam } from "./connection";

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
