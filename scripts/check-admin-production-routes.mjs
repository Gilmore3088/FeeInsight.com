import { readFile } from "node:fs/promises";

const manifestPath = new URL("../.next/server/app-paths-manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const requiredRoutes = [
  "/admin/page",
  "/admin/magellan/page",
  "/admin/darwin/page",
  "/admin/knox/page",
  "/admin/hamilton/page",
  "/admin/data/page",
  "/admin/leads/page",
  "/admin/agents/page",
  "/admin/customers/page",
  "/admin/publishing/page",
  "/admin/controls/page",
  "/admin/agents/learning/page",
];

const missingRoutes = requiredRoutes.filter((route) => !(route in manifest));

if (missingRoutes.length > 0) {
  throw new Error(
    `Production build is missing canonical admin routes: ${missingRoutes.join(", ")}`,
  );
}

console.log(`Verified ${requiredRoutes.length} canonical admin routes.`);
