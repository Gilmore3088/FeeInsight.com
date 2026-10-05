import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, organizationSlug } from "./api-keys";

describe("generateApiKey", () => {
  it("issues bfi_ keys that api-auth accepts and stores only the hash", () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key.startsWith("bfi_")).toBe(true);
    expect(key.length).toBeGreaterThan(30);
    expect(key.startsWith(prefix)).toBe(true);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).not.toContain(key);
  });

  it("never repeats", () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });
});

describe("organizationSlug", () => {
  it("makes a stable partner slug", () => {
    expect(organizationSlug("betteranalyst.com")).toBe("api-betteranalyst-com");
    expect(organizationSlug("  !!  ")).toBe("api-partner");
  });
});
