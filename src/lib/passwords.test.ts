// @vitest-environment node
import { createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";

describe("versioned full-input passwords", () => {
  it("uses independent salts and verifies new native scrypt hashes", async () => {
    const [first, second] = await Promise.all([hashPassword("correct password"), hashPassword("correct password")]);
    expect(first).toMatch(/^\$scrypt\$v1\$N=131072,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(second).not.toBe(first);
    expect(await verifyPassword("correct password", first)).toEqual({ valid: true, needsRehash: false });
    expect(await verifyPassword("wrong password", first)).toEqual({ valid: false, needsRehash: false });
  });

  it.each(["a".repeat(72), "\u00e9".repeat(40)])("preserves every byte beyond the bcrypt limit (%s)", async (prefix) => {
    const first = `${prefix}first suffix`;
    const second = `${prefix}other suffix`;
    const stored = await hashPassword(first);
    expect(await verifyPassword(first, stored)).toMatchObject({ valid: true });
    expect(await verifyPassword(second, stored)).toMatchObject({ valid: false });
  });

  it("does not silently normalize Unicode", async () => {
    const stored = await hashPassword("caf\u00e9 password");
    expect(await verifyPassword("cafe\u0301 password", stored)).toMatchObject({ valid: false });
  });

  it("matches the full legacy UTF-8 input and upgrades only a successful verifier", async () => {
    const password = `${"\u00e9".repeat(40)}suffix`;
    const stored = `legacy-salt:${createHash("sha256").update(`legacy-salt:${password}`).digest("hex")}`;
    expect(await verifyPassword(password, stored)).toEqual({ valid: true, needsRehash: true });
    expect(await verifyPassword(`${"\u00e9".repeat(40)}other`, stored)).toEqual({ valid: false, needsRehash: false });
  });

  it.each(["s".repeat(200), "$scrypt$v1$", "$2b$10$", "salt\nwith newline"])("preserves a valid historical salt (%s)", async (salt) => {
    const stored = `${salt}:${createHash("sha256").update(`${salt}:password`).digest("hex")}`;
    expect(await verifyPassword("password", stored)).toEqual({ valid: true, needsRehash: true });
  });

  it.each(["", "salt:", "salt:aa", `salt:${"a".repeat(64)}:extra`, `:${"a".repeat(64)}`, `salt:${"z".repeat(64)}`, `salt:${"a".repeat(64)}\n`])(
    "rejects malformed legacy encodings without throwing (%s)", async (stored) => {
      expect(await verifyPassword("password", stored)).toEqual({ valid: false, needsRehash: false });
    },
  );

  it.each(["2a", "2b"])("keeps existing bcrypt %s byte semantics without rewriting", async (variant) => {
    const password = `${"a".repeat(72)}original suffix`;
    const stored = (await bcrypt.hash(password, 4)).replace("$2b$", `$${variant}$`);
    expect(await verifyPassword(`${"a".repeat(72)}different suffix`, stored)).toEqual({ valid: true, needsRehash: false });
    expect(await verifyPassword("wrong", stored)).toEqual({ valid: false, needsRehash: false });
  });

  it("verifies the repository's previous bcrypt writer cost", async () => {
    const stored = await bcrypt.hash("previous password", 10);
    expect(await verifyPassword("previous password", stored)).toEqual({ valid: true, needsRehash: false });
  });
});
