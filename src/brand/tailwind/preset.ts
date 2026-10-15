// Tailwind CSS v3 preset — requires tokens/tokens.css to be loaded globally.
import type { Config } from "tailwindcss";

const color = (name: string) => `rgb(var(--fi-${name}-rgb) / <alpha-value>)`;

const preset: Partial<Config> = {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        "paper": color("paper"),
        "surface-0": color("surface-0"),
        "surface-200": color("surface-200"),
        "ink": color("ink"),
        "on-ink": color("on-ink"),
        "muted": color("muted"),
        "border": color("border"),
        "control-border": color("control-border"),
        "brick": color("brick"),
        "on-brick": color("on-brick"),
        "brick-tint": color("brick-tint"),
        "brick-ink": color("brick-ink"),
        "above-market": color("above-market"),
        "in-range": color("in-range"),
        "below-market": color("below-market"),
      },
      fontFamily: {
        sans: ["var(--fi-font-sans)"],
        mono: ["var(--fi-font-mono)"],
      },
      spacing: {
        "fi-1": "var(--fi-space-1)",
        "fi-2": "var(--fi-space-2)",
        "fi-3": "var(--fi-space-3)",
        "fi-4": "var(--fi-space-4)",
        "fi-6": "var(--fi-space-6)",
        "fi-8": "var(--fi-space-8)",
        "fi-12": "var(--fi-space-12)",
        "fi-16": "var(--fi-space-16)",
        "fi-24": "var(--fi-space-24)",
      },
      borderRadius: {
        "sm": "var(--fi-radius-sm)",
        "md": "var(--fi-radius-md)",
        "lg": "var(--fi-radius-lg)",
        "tile": "var(--fi-radius-tile)",
      },
      boxShadow: {
        "fi-1": "var(--fi-shadow-1)",
        "fi-2": "var(--fi-shadow-2)",
      },
      fontSize: {
        "fi-display": ["64px", {"lineHeight": "64px", "fontWeight": "800", "letterSpacing": "-0.03em"}],
        "fi-h1": ["44px", {"lineHeight": "48px", "fontWeight": "800", "letterSpacing": "-0.025em"}],
        "fi-h2": ["30px", {"lineHeight": "36px", "fontWeight": "700", "letterSpacing": "-0.02em"}],
        "fi-h3": ["20px", {"lineHeight": "28px", "fontWeight": "700", "letterSpacing": "-0.01em"}],
        "fi-body-lg": ["18px", {"lineHeight": "28px", "fontWeight": "400"}],
        "fi-body": ["15px", {"lineHeight": "24px", "fontWeight": "400"}],
        "fi-small": ["13px", {"lineHeight": "20px", "fontWeight": "400"}],
        "fi-endorsement": ["14px", {"lineHeight": "20px", "fontWeight": "500"}],
        "fi-label": ["12px", {"lineHeight": "16px", "fontWeight": "600", "letterSpacing": "0.06em"}],
        "fi-figure-lg": ["40px", {"lineHeight": "44px", "fontWeight": "600", "letterSpacing": "-0.02em"}],
        "fi-figure": ["14px", {"lineHeight": "20px", "fontWeight": "500"}],
      },
    },
  },
};

export default preset;
