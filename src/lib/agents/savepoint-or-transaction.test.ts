import { describe, expect, it, vi } from "vitest";
import { inSavepointOrTransaction } from "./savepoint";

type Db = Parameters<typeof inSavepointOrTransaction>[0];

describe("inSavepointOrTransaction", () => {
  it("uses a savepoint inside a transaction", async () => {
    const scope = { name: "savepoint-scope" };
    const savepoint = vi.fn(async (work: (s: unknown) => Promise<unknown>) => work(scope));
    const begin = vi.fn();
    const result = await inSavepointOrTransaction({ savepoint, begin } as unknown as Db, async (s) => s);
    expect(result).toBe(scope);
    expect(begin).not.toHaveBeenCalled();
  });

  it("opens a transaction on the plain pool, where provider steps settle (run 17912)", async () => {
    const tx = { name: "transaction" };
    const begin = vi.fn(async (work: (s: unknown) => Promise<unknown>) => work(tx));
    const result = await inSavepointOrTransaction({ begin } as unknown as Db, async (s) => s);
    expect(result).toBe(tx);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("runs work directly on a test double with neither", async () => {
    const db = {} as unknown as Db;
    expect(await inSavepointOrTransaction(db, async (s) => s)).toBe(db);
  });
});
