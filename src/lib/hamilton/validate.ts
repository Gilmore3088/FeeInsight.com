/**
 * Hamilton Numeric Validator
 * Cross-checks every number in Hamilton's output against source data JSON.
 * Zero tolerance for invented statistics.
 */

import type { ValidationResult } from "./types";

/**
 * Regex patterns for extracting numeric tokens from narrative text.
 * Ordered from most-specific to least-specific to avoid double-counting.
 */
const NUMERIC_PATTERNS: RegExp[] = [
  // Currency: $1,234.56 or $1,234 or $12.50
  /\$[\d,]+(?:\.\d+)?/g,
  // Percentage: 23.4% or 23%
  /\d+(?:\.\d+)?%/g,
  // Standalone decimal: 12.50 (not already captured by currency/percent)
  /\b\d+\.\d+\b/g,
  // Standalone integer: 1,234 or 12
  /\b\d{1,3}(?:,\d{3})*\b|\b\d+\b/g,
];

/**
 * Parse a numeric string to a float, stripping currency and formatting symbols.
 */
function parseNumericToken(token: string): number {
  // Strip $, commas, %
  const cleaned = token.replace(/[$,%]/g, "").replace(/,/g, "");
  return parseFloat(cleaned);
}

/**
 * Extract all numeric tokens from a text string.
 * Returns raw token strings (preserving formatting) and their parsed values.
 */
export function extractNumericTokens(text: string): Array<{ raw: string; value: number }> {
  const seen = new Set<string>();
  const results: Array<{ raw: string; value: number }> = [];

  // Remove patterns in order, tracking position to avoid double-counting
  // Strategy: work on a masked copy where matched tokens are replaced with spaces
  let masked = text;

  for (const pattern of NUMERIC_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;

    // Reset pattern
    globalPattern.lastIndex = 0;

    while ((match = globalPattern.exec(masked)) !== null) {
      const raw = match[0];
      const value = parseNumericToken(raw);

      // Skip if not a valid number, or already captured at this exact position
      if (isNaN(value) || seen.has(raw + "_" + match.index)) {
        continue;
      }
      seen.add(raw + "_" + match.index);
      results.push({ raw, value });
    }

    // Mask matched tokens so subsequent patterns don't double-count
    masked = masked.replace(new RegExp(pattern.source, "g"), (m) => " ".repeat(m.length));
  }

  return results;
}

/**
 * Recursively flatten a nested data object to extract all numeric leaf values.
 */
export function flattenSourceValues(data: Record<string, unknown>): number[] {
  const values: number[] = [];

  function traverse(node: unknown): void {
    if (typeof node === "number" && !isNaN(node)) {
      values.push(node);
    } else if (typeof node === "string") {
      const parsed = parseFloat(node.replace(/[$,%,]/g, ""));
      if (!isNaN(parsed)) {
        values.push(parsed);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    } else if (node !== null && typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) {
        traverse(value);
      }
    }
  }

  traverse(data);
  return values;
}

/**
 * Check if a narrative numeric value matches any source value within tolerance.
 *
 * Tolerance rules:
 * - Currency/decimal values: within ±$0.01 (rounding to cents)
 * - Percentage values: within ±0.05 (allows rounding from 23.43% displayed as 23.4%)
 * - Integer values: exact match or within ±0.5 (integer rounding)
 */
function isValueGrounded(
  narrativeValue: number,
  rawToken: string,
  sourceValues: number[]
): boolean {
  const isPercentage = rawToken.includes("%");
  const isCurrency = rawToken.includes("$");

  const tolerance = isPercentage ? 0.05 : isCurrency ? 0.01 : 0.5;

  return sourceValues.some((sourceVal) => Math.abs(narrativeValue - sourceVal) <= tolerance);
}

/**
 * Validate that every numeric value in Hamilton's narrative is present in source data.
 *
 * @param narrative - The generated narrative text from Hamilton
 * @param sourceData - The original data object passed to generateSection()
 * @returns ValidationResult with pass/fail status and any invented numbers
 */
export function validateNumerics(
  narrative: string,
  sourceData: Record<string, unknown>
): ValidationResult {
  const tokens = extractNumericTokens(narrative);
  const sourceValues = flattenSourceValues(sourceData);

  const inventedNumbers: string[] = [];

  for (const token of tokens) {
    if (!isValueGrounded(token.value, token.raw, sourceValues)) {
      inventedNumbers.push(token.raw);
    }
  }

  return {
    passed: inventedNumbers.length === 0,
    inventedNumbers,
    checkedCount: tokens.length,
    sourceValues,
  };
}
