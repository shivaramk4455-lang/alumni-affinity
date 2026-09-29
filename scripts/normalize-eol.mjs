/**
 * One-shot working-tree line-ending normaliser.
 *
 * The repo's blobs are stored with LF, but this Windows checkout (core.autocrlf=true)
 * wrote them back as CRLF, which made prettier -- wired into ESLint via
 * eslint-plugin-prettier -- report every line as a `Delete ␍` error.
 *
 * `.gitattributes` (`* text=auto eol=lf`) stops it recurring; this script fixes
 * the files already on disk. It only touches files git tracks as text, skips
 * anything that looks binary, and is a no-op when the tree is already LF.
 *
 * Usage: node scripts/normalize-eol.mjs [--check]
 *   --check  report only, exit 1 if anything still needs converting (for CI)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".mp4",
  ".webm",
  ".ttf",
  ".otf",
  ".eot",
]);
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".pdf",
]);

const checkOnly = process.argv.includes("--check");

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

const changed = [];
let skippedUnreadable = 0;

for (const file of tracked) {
  const ext = extname(file).toLowerCase();
  if (SKIP_EXT.has(ext) || BINARY_EXT.has(ext)) continue;

  const abs = join(process.cwd(), file);
  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    skippedUnreadable++;
    continue;
  }

  // A NUL byte in the first 8 KB is the standard "this is binary" heuristic.
  if (buf.subarray(0, 8000).includes(0)) continue;

  const hasCrlf = buf.includes(0x0d);
  const text = buf.toString("utf8");

  // Only strip CR when it is genuinely part of a CRLF pair. A lone CR in a
  // file that otherwise has no CRLF is meaningful content, not a line ending.
  const fixed = text.replace(/\r\n/g, "\n");

  if (fixed === text) continue;
  changed.push(file);
  if (!checkOnly) writeFileSync(abs, fixed, "utf8");
}

if (changed.length === 0) {
  console.log("All tracked text files already use LF.");
  process.exit(0);
}

const verb = checkOnly ? "would normalise" : "normalised";
console.log(`${verb} ${changed.length} file(s) to LF:`);
for (const f of changed.slice(0, 40)) console.log("  " + f);
if (changed.length > 40) console.log(`  ...and ${changed.length - 40} more`);

if (checkOnly) process.exit(1);
