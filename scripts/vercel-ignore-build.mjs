// Vercel's ignored build step (vercel.json "ignoreCommand"): exit 0 skips the build, exit 1
// builds. The decision lives in vercel-ignore-build-lib.mjs.
//
// 2026-10-20-vercel-skip-check-fails-open: this file used to run only when process.argv[1]
// matched its own path, so a symlinked or otherwise different path ran nothing and exited 0,
// skipping every build. It now has no entry guard: loading it always decides, and the exit
// code defaults to 1 so any path that never reaches an explicit skip builds.
process.exitCode = 1;

const { decideFromRepo, exitCodeFor } = await import("./vercel-ignore-build-lib.mjs");

process.exit(exitCodeFor(decideFromRepo, (line) => process.stdout.write(line)));
