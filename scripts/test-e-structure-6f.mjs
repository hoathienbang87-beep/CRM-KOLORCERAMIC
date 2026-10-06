import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file));
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

const htmlBytes = read("qr/e-structure.html");
const videoBytes = read("public/videos/e-structure.mp4");
const html = htmlBytes.toString("utf8");

assert.equal(
  sha256(htmlBytes),
  "f3526646447d395f556087cc75679a9dae2dcc5c57d58e5cde1d6910d3d89fa5",
  "E-STRUCTURE HTML must remain byte-identical to Recovery HEAD"
);
assert.equal(
  sha256(videoBytes),
  "1e1557127a5e11f2eafd24da4feb2d9e35cdebe8df763b8f7c6dc4c8f8e71afe",
  "E-STRUCTURE video must remain byte-identical to Recovery HEAD"
);
assert.ok(videoBytes.length > 4_000_000, "video payload must not be replaced by a stub");
assert.equal(videoBytes.subarray(4, 8).toString("ascii"), "ftyp", "video must be an MP4 container");
assert.match(html, /<video[\s\S]*\bautoplay\b[\s\S]*\bmuted\b[\s\S]*\bplaysinline\b/i);
assert.match(html, /<source src="\/videos\/e-structure\.mp4" type="video\/mp4">/);
assert.match(html, /prefers-reduced-motion/);
assert.match(html, /NotAllowedError/);
assert.match(html, /id="soundButton"/);
assert.match(html, /id="motionButton"/);

console.log("PASS: E-STRUCTURE static integrity, media source, autoplay fallback and accessibility contract.");
