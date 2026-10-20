// Fee Insight design tokens — generated from tokens.json. Do not edit by hand.

export const colors = {
  light: {
    "paper": "#f3efe6",
    "surface-0": "#fbf9f4",
    "surface-200": "#ebe5d9",
    "ink": "#132338",
    "on-ink": "#f3efe6",
    "muted": "#55606f",
    "border": "#ddd5c6",
    "control-border": "#767c87",
    "brick": "#b23a32",
    "on-brick": "#ffffff",
    "brick-tint": "#f1d5d0",
    "brick-ink": "#7f2620",
    "above-market": "#b23a32",
    "in-range": "#5a646e",
    "below-market": "#3b6350",
  },
  dark: {
    "paper": "#132338",
    "surface-0": "#1a2c44",
    "surface-200": "#0e1a2b",
    "ink": "#f3efe6",
    "on-ink": "#132338",
    "muted": "#a9b3c1",
    "border": "#263a55",
    "control-border": "#5d6f87",
    "brick": "#e0716a",
    "on-brick": "#132338",
    "brick-tint": "#4a2430",
    "brick-ink": "#f3efe6",
    "above-market": "#e0716a",
    "in-range": "#a3adb8",
    "below-market": "#7fb59b",
  },
} as const;

export const space = {
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "6": "24px",
  "8": "32px",
  "12": "48px",
  "16": "64px",
  "24": "96px",
} as const;

export const radius = {
  "sm": "4px",
  "md": "8px",
  "lg": "12px",
  "tile": "22%",
} as const;

export const typography = {
  "display": { family: "sans", fontSize: "64px", lineHeight: "64px", fontWeight: 800, letterSpacing: "-0.03em" },
  "h1": { family: "sans", fontSize: "44px", lineHeight: "48px", fontWeight: 800, letterSpacing: "-0.025em" },
  "h2": { family: "sans", fontSize: "30px", lineHeight: "36px", fontWeight: 700, letterSpacing: "-0.02em" },
  "h3": { family: "sans", fontSize: "20px", lineHeight: "28px", fontWeight: 700, letterSpacing: "-0.01em" },
  "body-lg": { family: "sans", fontSize: "18px", lineHeight: "28px", fontWeight: 400 },
  "body": { family: "sans", fontSize: "15px", lineHeight: "24px", fontWeight: 400 },
  "small": { family: "sans", fontSize: "13px", lineHeight: "20px", fontWeight: 400 },
  "endorsement": { family: "sans", fontSize: "14px", lineHeight: "20px", fontWeight: 500 },
  "label": { family: "sans", fontSize: "12px", lineHeight: "16px", fontWeight: 600, letterSpacing: "0.06em" },
  "figure-lg": { family: "mono", fontSize: "40px", lineHeight: "44px", fontWeight: 600, letterSpacing: "-0.02em" },
  "figure": { family: "mono", fontSize: "14px", lineHeight: "20px", fontWeight: 500 },
} as const;
export type Theme = keyof typeof colors;
