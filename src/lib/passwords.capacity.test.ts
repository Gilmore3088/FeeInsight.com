// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scrypt: vi.fn(), compare: vi.fn() }));
vi.mock("node:crypto", async (original) => ({ ...await original<typeof import("node:crypto")>(), scrypt: mocks.scrypt }));
vi.mock("bcryptjs", () => ({ compare: mocks.compare }));

type Callback = (error: Error | null, key: Buffer) => void;
const callbacks: Callback[] = [];
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const encoded = `$scrypt$v1$N=131072,r=8,p=1$${"a".repeat(32)}$${"b".repeat(128)}`;

describe("bounded password KDF admission", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    callbacks.length = 0;
    mocks.scrypt.mockReset().mockImplementation((_password, _salt, _length, _options, callback) => { callbacks.push(callback); });
    mocks.compare.mockReset().mockResolvedValue(true);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("admits two workers, queues eight FIFO, and rejects further work before allocation", async () => {
    const { hashPassword, PasswordKdfUnavailableError } = await import("./passwords");
    const jobs = Array.from({ length: 10 }, (_, i) => hashPassword(`password ${i}`));
    await flush();
    expect(mocks.scrypt).toHaveBeenCalledTimes(2);
    expect(mocks.scrypt.mock.calls[0][1]).toHaveLength(16);
    expect(mocks.scrypt.mock.calls[0][2]).toBe(64);
    expect(mocks.scrypt.mock.calls[0][3]).toEqual({ N: 131_072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
    await expect(hashPassword("overflow")).rejects.toBeInstanceOf(PasswordKdfUnavailableError);
    for (let i = 0; i < 10; i++) {
      callbacks[i](null, Buffer.alloc(64, i));
      await flush();
      expect(mocks.scrypt).toHaveBeenCalledTimes(Math.min(10, i + 3));
    }
    await Promise.all(jobs);
    expect(mocks.scrypt.mock.calls.map(([password]) => password)).toEqual(Array.from({ length: 10 }, (_, i) => `password ${i}`));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes expired queued work so it can never start when a worker finishes", async () => {
    const { hashPassword } = await import("./passwords");
    const running = [hashPassword("one"), hashPassword("two")];
    const expired = hashPassword("must never start").catch((error: Error) => error);
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await expired).toMatchObject({ name: "PasswordKdfUnavailableError" });
    callbacks[0](null, Buffer.alloc(64));
    callbacks[1](null, Buffer.alloc(64));
    await Promise.all(running);
    expect(mocks.scrypt).toHaveBeenCalledTimes(2);
    const next = hashPassword("new work");
    await flush();
    callbacks[2](null, Buffer.alloc(64));
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases admission after callback errors and synchronous native errors", async () => {
    const { hashPassword } = await import("./passwords");
    mocks.scrypt.mockImplementationOnce(() => { throw new Error("native error"); });
    const failed = hashPassword("throws").catch((error: Error) => error.message);
    const callbackFailed = hashPassword("callback error").catch((error: Error) => error.message);
    const queued = hashPassword("after errors");
    await flush();
    expect(await failed).toBe("native error");
    callbacks[0](new Error("callback error"), Buffer.alloc(64));
    await flush();
    expect(await callbackFailed).toBe("callback error");
    callbacks[1](null, Buffer.alloc(64));
    await queued;
    const subsequent = [hashPassword("new one"), hashPassword("new two")];
    await flush();
    expect(mocks.scrypt).toHaveBeenCalledTimes(5);
    callbacks[2](null, Buffer.alloc(64));
    callbacks[3](null, Buffer.alloc(64));
    await Promise.all(subsequent);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares admission between hashing and verification", async () => {
    const { hashPassword, verifyPassword } = await import("./passwords");
    const jobs = [hashPassword("first"), verifyPassword("second", encoded), hashPassword("third")];
    await flush();
    expect(mocks.scrypt).toHaveBeenCalledTimes(2);
    callbacks[0](null, Buffer.alloc(64));
    await flush();
    expect(mocks.scrypt).toHaveBeenCalledTimes(3);
    callbacks[1](null, Buffer.alloc(64));
    callbacks[2](null, Buffer.alloc(64));
    await Promise.all(jobs);
  });

  it("bounds legacy bcrypt admission too, releasing after compare errors", async () => {
    const { hashPassword, verifyPassword } = await import("./passwords");
    mocks.compare.mockRejectedValueOnce(new Error("compare error"));
    const failure = verifyPassword("bcrypt", `$2b$10$${"a".repeat(53)}`).catch((error: Error) => error.message);
    expect(await failure).toBe("compare error");
    const running = [hashPassword("one"), hashPassword("two")];
    const waiting = verifyPassword("bcrypt", `$2a$16$${"a".repeat(53)}`);
    await flush();
    expect(mocks.compare).toHaveBeenCalledTimes(1);
    callbacks[0](null, Buffer.alloc(64));
    await flush();
    expect(await waiting).toEqual({ valid: true, needsRehash: false });
    callbacks[1](null, Buffer.alloc(64));
    await Promise.all(running);
  });

  it.each([
    encoded.replace("N=131072", "N=1073741824"), encoded.replace("v1", "v2"), `${encoded}a`, `${encoded}\n`,
    encoded.replace("r=8", "r=1"), encoded.replace("p=1", "p=16"), encoded.replace("a".repeat(32), "a".repeat(34)),
    `$2b$17$${"a".repeat(53)}`, `$2a$31$${"a".repeat(53)}`, `$2b$03$${"a".repeat(53)}`, "$2b$10$short", `$2b$10$${"a".repeat(53)}\n`,
  ])("rejects unknown or excessive encoded policy before expensive work (%s)", async (stored) => {
    const { verifyPassword } = await import("./passwords");
    expect(await verifyPassword("password", stored)).toEqual({ valid: false, needsRehash: false });
    expect(mocks.scrypt).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });
});
