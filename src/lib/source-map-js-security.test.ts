// @vitest-environment node
import { createRequire } from "node:module";
import postcss, { type Root } from "postcss";
import { describe, expect, it } from "vitest";
import type { RawSourceMap, SourceMapConsumer as Consumer } from "source-map-js";

const { SourceMapConsumer, SourceMapGenerator, SourceNode } = createRequire(import.meta.url)("source-map-js") as typeof import("source-map-js");
const leaf = () => ({ version: 3, sources: ["input.js"], sourcesContent: ["var x;\n"], names: [], mappings: "AAAA" });
const indexed = (line: unknown, column: unknown = 0, map: unknown = leaf()) => ({
  version: 3, sections: [{ offset: { line, column }, map }],
});
const consume = (map: unknown) => new SourceMapConsumer(map as RawSourceMap);
type IndexedConsumer = Consumer & { _sections: Array<{ consumer: IndexedConsumer }> };

describe("actual source-map-js indexed-map resource controls", () => {
  const invalid = [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined, {}];
  it.each(invalid.flatMap((value, index) => ["line", "column"].map((field) => ({ value, index, field }))))(
    "rejects invalid $field integer (fixture $index) before mapping expansion", ({ value, field }) => {
      const map = indexed(0);
      if (field === "line") map.sections[0].offset.line = value;
      else map.sections[0].offset.column = value;
      expect(() => consume(map)).toThrow();
    },
  );

  it("rejects an excessive line offset in the constructor without expanding mappings", () => {
    expect(() => consume(indexed(10_000_001))).toThrow(/must not exceed/);
  });

  it("applies the line bound to summed nested offsets", () => {
    expect(() => consume(indexed(5_000_000, 0, indexed(5_000_001)))).toThrow(/including offsets of nested sections/);
  });

  it("accepts the boundary and a large valid column without serializing a line gap", () => {
    const atBoundary = consume(indexed(5_000_000, 0, indexed(5_000_000)));
    expect(atBoundary.originalPositionFor({ line: 10_000_001, column: 1 })).toMatchObject({ source: "input.js", line: 1, column: 0 });
    const wide = consume(indexed(0, 5_000_000));
    expect(wide.originalPositionFor({ line: 1, column: 5_000_001 })).toMatchObject({ source: "input.js", line: 1, column: 0 });
  });

  it("reads each nested section's sources once, without a timing assertion", () => {
    const depth = 6;
    let map: unknown = leaf();
    for (let index = 0; index < depth; index++) map = indexed(0, 0, map);
    const consumer = consume(map) as IndexedConsumer;
    let innermost = consumer;
    for (let index = 0; index < depth; index++) innermost = innermost._sections[0].consumer;
    const sources = innermost.sources;
    let reads = 0;
    Object.defineProperty(innermost, "sources", { get: () => { reads++; return sources; } });
    expect(consumer.sources).toEqual(["input.js"]);
    expect(reads).toBe(1);
  });

  it("stops padding when real generated code is exhausted", () => {
    const node = SourceNode.fromStringWithSourceMap("var x;\n", consume(indexed(12)));
    expect(node.toString()).toBe("var x;\n");
    expect((node as typeof node & { children: unknown[] }).children.length).toBeLessThan(5);
    const contents: Record<string, string> = {};
    node.walkSourceContents((source, content) => { contents[source] = content; });
    expect(contents).toEqual({ "input.js": "var x;\n" });
  });

  it("retains ordinary mappings, names, source contents and round-trip code", () => {
    const generator = new SourceMapGenerator({ file: "output.js" });
    generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 1, column: 0 }, source: "input.js", name: "x" });
    generator.setSourceContent("input.js", "var x;\n");
    const consumer = consume(generator.toJSON());
    expect(consumer.originalPositionFor({ line: 1, column: 0 })).toEqual({ source: "input.js", line: 1, column: 0, name: "x" });
    expect(consumer.sourceContentFor("input.js")).toBe("var x;\n");
    const roundTrip = SourceNode.fromStringWithSourceMap("var x;\n", consumer).toStringWithSourceMap({ file: "roundtrip.js" });
    expect(roundTrip.code).toBe("var x;\n");
    expect(consume(roundTrip.map.toJSON()).originalPositionFor({ line: 1, column: 0 })).toMatchObject({ source: "input.js", line: 1 });
  });

  it("serializes small generated-line gaps with the expected mappings", () => {
    const generator = new SourceMapGenerator({ file: "gaps.js" });
    for (const line of [1, 3, 13]) generator.addMapping({ generated: { line, column: 0 } });
    expect(generator.toJSON().mappings).toBe(`A;;A${";".repeat(10)}A`);
  });
});

describe("installed PostCSS source-map integration", () => {
  it("consumes an ordinary previous map and preserves original CSS provenance", async () => {
    const previous = new SourceMapGenerator({ file: "/fixture/generated.css" });
    previous.addMapping({ generated: { line: 1, column: 0 }, original: { line: 1, column: 0 }, source: "/fixture/original.css" });
    previous.setSourceContent("/fixture/original.css", "a { color: red }\n");
    const result = await postcss([(root: Root) => { root.walkDecls((declaration) => { declaration.value = "blue"; }); }]).process("a { color: red }\n", {
      from: "/fixture/generated.css", to: "/fixture/output.css", map: { prev: previous.toString(), inline: false, annotation: false, sourcesContent: true },
    });
    expect(result.css).toBe("a { color: blue }\n");
    expect(result.map).toBeDefined();
    const consumer = consume(result.map!.toJSON());
    expect(consumer.originalPositionFor({ line: 1, column: 4 })).toMatchObject({ source: "/fixture/original.css", line: 1, column: 0 });
    expect(consumer.sourceContentFor("/fixture/original.css")).toBe("a { color: red }\n");
  });
});
