import { describe, expect, it } from "vitest";
import { apiFeeName, feeDisplayName, isCutFeeName } from "@/lib/fee-display-name";

describe("feeDisplayName", () => {
  it("names a safe deposit box row that states only its size (101392)", () => {
    expect(feeDisplayName("3 X 10", "safe_deposit_box")).toBe("Safe Deposit Box 3 X 10");
    expect(feeDisplayName("10x10", "safe_deposit_box")).toBe("Safe Deposit Box 10x10");
    expect(feeDisplayName("5” x 10” Box", "safe_deposit_box")).toBe("Safe Deposit Box 5” x 10”");
    expect(feeDisplayName('3" x 5"', "safe_deposit_box")).toBe('Safe Deposit Box 3" x 5"');
    expect(feeDisplayName("10 x 10 x 22", "safe_deposit_box")).toBe("Safe Deposit Box 10 x 10 x 22");
  });

  it("leaves every other name as stored", () => {
    expect(feeDisplayName("Safe Deposit Box 3 x 5", "safe_deposit_box")).toBe("Safe Deposit Box 3 x 5");
    expect(feeDisplayName("Drilling", "safe_deposit_box")).toBe("Drilling");
    expect(feeDisplayName("3 x 10", "check_printing")).toBe("3 x 10");
    expect(feeDisplayName("3 x 10", null)).toBe("3 x 10");
  });

  it("shows the category's name for a name cut from its line (#1180)", () => {
    expect(feeDisplayName("Chase Mobile to send a wire from your account to", "wire_domestic_outgoing")).toBe("Wire Transfer (Domestic Out)");
    expect(feeDisplayName("Fees: o A Minimum Balance Fee", "monthly_maintenance")).toBe("Monthly Maintenance");
  });

  it("flags the API name when the category's name stands in for a cut name (#1482)", () => {
    expect(apiFeeName("Chase Mobile to send a wire from your account to", "wire_domestic_outgoing")).toEqual({
      fee_name: "Wire Transfer (Domestic Out)",
      name_is_category_fallback: true,
    });
    expect(apiFeeName("3 X 10", "safe_deposit_box")).toEqual({ fee_name: "Safe Deposit Box 3 X 10", name_is_category_fallback: false });
    expect(apiFeeName("Overdraft Fee", "overdraft")).toEqual({ fee_name: "Overdraft Fee", name_is_category_fallback: false });
  });

  it("keeps a cut name when there is no known category to fall back to", () => {
    expect(feeDisplayName("Chase Mobile to send a wire from your account to", null)).toBe("Chase Mobile to send a wire from your account to");
    expect(feeDisplayName("Chase Mobile to send a wire from your account to", "not_a_category")).toBe("Chase Mobile to send a wire from your account to");
  });

  it("leaves whole names alone, including ones that only look odd", () => {
    for (const name of ["OVERDRAFT FEE", "Monthly Service Fee", "Stop Payment", "Loan Application, each", "N/A", "e-Statement fee"]) {
      expect(isCutFeeName(name)).toBe(false);
      expect(feeDisplayName(name, "overdraft")).toBe(name);
    }
  });

  it("shows the stored name when a pronoun sits only inside a parenthetical (#1443)", () => {
    // Darwin's live check exempts these, so the page agrees: the stored name is a real fee name.
    expect(isCutFeeName("Stop Payment (per item, if you request it)")).toBe(false);
    expect(feeDisplayName("Stop Payment (per item, if you request it)", "stop_payment")).toBe("Stop Payment (per item, if you request it)");
    // Outside the parenthetical the pronoun is still a cut name.
    expect(isCutFeeName("Stop Payment (per item) if you request it")).toBe(true);
  });

  it("shows all-capitals names ending on a letter or an article as stored, as main does (#1499)", () => {
    // Darwin's all-capitals article rule lives in the live fragment check only; the public name is unchanged.
    for (const name of ["SAFE DEPOSIT BOX SIZE A", "CHECKING PLAN A", "OPTION A", "SCHEDULE A", "BOX A", "CLUB A",
      "WIRE FEE FOR THE", "TRANSFER TO A", "SERVICE CHARGE A", "BILL PAY A", "MONTHLY SERVICE CHARGE A"]) {
      expect(isCutFeeName(name)).toBe(false);
      expect(feeDisplayName(name, "wire_domestic_outgoing")).toBe(name);
      expect(feeDisplayName(name, "safe_deposit_box")).toBe(name);
    }
  });
});

describe("fee-name helpers stay pure (#1483)", () => {
  it("import no agent, database or crypto code, so public pages can use them", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { dirname, join, normalize } = await import("node:path");
    // Follow every import, relative or "@/", through the files it reaches (#1586): a check of
    // direct "@/lib/agents" imports alone misses "../agents/x" or a helper that reads the database.
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
      if (!base) return null;
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return normalize(candidate);
      }
      return null;
    };
    const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
    const BANNED_PACKAGE = /^(?:node:|crypto$|fs$|path$|postgres$|@supabase\/)/;
    const seen = new Set<string>();
    const queue = ["src/lib/fee-display-name.ts", "src/lib/fee-name-fragments.ts", "src/lib/coverage-labels.ts"];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      expect(file, "reached an agent or database module").not.toMatch(/^src\/lib\/(?:agents|data-store)\//);
      for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const spec = m[1] ?? m[2] ?? m[3];
        expect(spec, `${file} imports ${spec}`).not.toMatch(BANNED_PACKAGE);
        const next = resolve(file, spec);
        if (next) queue.push(next);
      }
    }
    // The walk reached past the three entry files (fee-taxonomy, fee-fold).
    expect(seen.size).toBeGreaterThan(3);
  });
});
