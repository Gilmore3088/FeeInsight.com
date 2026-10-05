import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,

  // Hosted/sample Competitive Fee Position reports are read from disk at request time
  // (src/lib/hosted-reports.ts); make sure the studio files ship with the server bundle.
  // Rosetta's free OCR (src/lib/agents/rosetta/ocr.ts) runs tesseract.js in a worker
  // thread that loads its script, WebAssembly core and English model from disk, so the
  // package stays external and those files ship with the routes that run agent steps.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  outputFileTracingIncludes: {
    "/r/**": ["./Reports/studio/out/*.html", "./Reports/studio/hosted-reports.json"],
    "/reports/sample-competitive-fee-position": ["./Reports/studio/sample/*.html"],
    "/api/admin/**": [
      "./node_modules/tesseract.js/package.json",
      "./node_modules/tesseract.js/src/**",
      "./node_modules/tesseract.js-core/package.json",
      "./node_modules/tesseract.js-core/index.js",
      // Every core build: tesseract.js 7 passes a boolean where getCore expects an OEM
      // number, so it loads the non-LSTM build even for an LSTM worker. Shipping only the
      // `*lstm*` files broke OCR in production (2026-10-05) while tests, which see the
      // whole node_modules, passed. src/lib/agents/rosetta/ocr-bundle.test.ts guards this list.
      "./node_modules/tesseract.js-core/tesseract-core*",
      "./node_modules/@tesseract.js-data/eng/package.json",
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**",
      "./node_modules/{bmp-js,idb-keyval,is-url,regenerator-runtime,wasm-feature-detect,zlibjs}/**",
    ],
  },

  // The sample report PDF is offline until it is re-rendered from live, source-checked
  // data (SAMPLE_REPORT_LIVE in src/lib/constants.ts). Old links and emails land on the
  // sample page's "new sample coming soon" note. Remove this when the sample is back.
  async redirects() {
    return [
      {
        source: "/reports/sample-competitive-fee-position.pdf",
        destination: "/reports/sample-competitive-fee-position",
        permanent: false,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://plausible.io https://js.stripe.com https://va.vercel-scripts.com",
              // Google Fonts stylesheet (Material Symbols Outlined for /pro icons)
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob:",
              // Google Fonts font files (Material Symbols served from gstatic)
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://plausible.io https://api.stripe.com https://vitals.vercel-insights.com",
              "frame-src 'self' https://js.stripe.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
