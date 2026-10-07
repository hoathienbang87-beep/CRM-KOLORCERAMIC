#!/usr/bin/env node
// Release gate: the public deployment surface must contain runtime files only.
// Builds the public output twice into temporary directories and asserts:
//   - Vercel serves the generated directory (outputDirectory "dist" + build-public);
//   - required runtime files exist, forbidden categories do not;
//   - every local asset/module reference resolves inside the output;
//   - routes/rewrites point at files that exist in the output;
//   - maintenance config is generated correctly; MP4 bytes are unchanged;
//   - only the intentional browser anon Supabase key is present;
//   - the build is byte-for-byte reproducible.
// Usage: node scripts/test-public-deploy-surface.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_TOP_LEVEL, MAINTENANCE_FILE, REQUIRED_FILES, build, forbiddenReason, maintenanceEnabled, maintenanceSource
} from "./build-public.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_MP4_SHA256 = "1e1557127a5e11f2eafd24da4feb2d9e35cdebe8df763b8f7c6dc4c8f8e71afe";
const sha256 = buffer => createHash("sha256").update(buffer).digest("hex");
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks += 1; };

// 1. Vercel contract -----------------------------------------------------------
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
check(vercel.outputDirectory === "dist", "vercel.json outputDirectory is dist");
check(vercel.buildCommand === "node scripts/build-public.mjs", "vercel.json buildCommand runs build-public");
check(vercel.framework === null, "no framework preset");
check(vercel.redirects.some(r => r.source === "/catalog" && r.destination === "/" && r.permanent === true), "/catalog -> / (308)");
check(vercel.redirects.some(r => r.source === "/CRM" && r.destination === "/crm" && r.permanent === true), "/CRM -> /crm (308)");
check(vercel.routes.some(r => r.src === "^/$" && r.dest === "/website/index"), "/ routes to website/index");
const rewrites = Object.fromEntries(vercel.rewrites.map(r => [r.source, r.destination]));
check(rewrites["/videos/:path*"] === "/public/videos/:path*", "/videos rewrite preserved");
check(rewrites["/admin"] === "/admin/index" && rewrites["/admin/:path*"] === "/admin/index", "/admin rewrites preserved");
check(rewrites["/crm"] === "/index" && rewrites["/crm/:path*"] === "/index", "/crm rewrites preserved");

// 2. Build twice ---------------------------------------------------------------
const dirs = [mkdtempSync(join(tmpdir(), "public-surface-a-")), mkdtempSync(join(tmpdir(), "public-surface-b-"))];
try {
  const first = build({ out: dirs[0], quiet: true });
  const second = build({ out: dirs[1], quiet: true });
  check(first.manifestHash === second.manifestHash, "build is reproducible (identical manifests)");
  check(JSON.stringify(first.manifest) === JSON.stringify(second.manifest), "build manifests identical line by line");
  const out = first.out;
  const files = new Set(first.files);
  const read = rel => readFileSync(join(out, ...rel.split("/")));

  // 3. Required / forbidden ----------------------------------------------------
  for (const rel of REQUIRED_FILES) check(files.has(rel), `required runtime file present: ${rel}`);
  for (const rel of files) check(forbiddenReason(rel) === null, `allowed path: ${rel}`);
  const topLevel = new Set([...files].map(rel => rel.split("/")[0]));
  for (const entry of topLevel) check(ALLOWED_TOP_LEVEL.includes(entry), `top-level allowlisted: ${entry}`);
  const counts = { sql: 0, md: 0, tests: 0, supabaseSource: 0, dot: 0 };
  for (const rel of files) {
    if (/\.sql$/i.test(rel)) counts.sql += 1;
    if (/\.(md|markdown)$/i.test(rel) || /(^|\/)readme/i.test(rel)) counts.md += 1;
    if (/(^|\/)(scripts|tests?|fixtures)\//i.test(rel) || /(^|\/)test-[^/]*$/i.test(rel)) counts.tests += 1;
    if (/^supabase\//i.test(rel) || /(^|\/)config\.toml$/i.test(rel)) counts.supabaseSource += 1;
    if (rel.split("/").some(part => part.startsWith("."))) counts.dot += 1;
  }
  check(Object.values(counts).every(value => value === 0), `no forbidden categories ${JSON.stringify(counts)}`);
  for (const probe of [
    "README.md", "vercel.json", ".gitignore", ".vercelignore", ".gitattributes", "supabase/config.toml",
    "supabase-phase-kpi2-final-consolidated.sql", "scripts/test-app-routing-09.mjs", "scripts/build-public.mjs",
    "KPI-2-PRODUCTION-RUNBOOK.md", "PHASE-4-13-DATA-SAFETY-BACKUP.md", "docs", "firebase-legacy-redirect/firebase.json",
    "reconciliation-evidence", ".vercel/project.json", ".env"
  ]) check(!existsSync(join(out, ...probe.split("/"))), `not published: ${probe}`);

  // 4. Generated maintenance config -------------------------------------------
  check(read(MAINTENANCE_FILE).toString("utf8") === maintenanceSource(maintenanceEnabled()), "maintenance config generated");
  if (!maintenanceEnabled()) check(/enabled: false/.test(read(MAINTENANCE_FILE).toString("utf8")), "maintenance OFF by default");

  // 5. Media bytes ------------------------------------------------------------
  const mp4 = read("public/videos/e-structure.mp4");
  check(sha256(mp4) === sha256(readFileSync(join(ROOT, "public/videos/e-structure.mp4"))), "MP4 copied byte-for-byte");
  check(sha256(mp4) === CANONICAL_MP4_SHA256, "MP4 matches canonical SHA-256");
  for (const rel of files) if (rel !== MAINTENANCE_FILE) check(read(rel).equals(readFileSync(join(ROOT, ...rel.split("/")))), `byte-identical copy: ${rel}`);

  // 6. Local reference resolution --------------------------------------------
  const resolveUrlPath = urlPath => {
    let p = urlPath.split(/[?#]/)[0];
    if (p.startsWith("/videos/")) p = `/public${p}`;
    return p.replace(/^\/+/, "");
  };
  const missing = [];
  for (const html of ["index.html", "website/index.html", "admin/index.html", "qr/e-structure.html"]) {
    const text = read(html).toString("utf8");
    for (const [, url] of text.matchAll(/(?:src|href|poster)="([^"]+)"/g)) {
      if (!url.startsWith("/") || url.startsWith("//")) continue;
      if (!/^\/(js|css|videos|public)\//.test(url)) continue; // page routes are covered by the route checks
      if (!files.has(resolveUrlPath(url))) missing.push(`${html} -> ${url}`);
    }
  }
  for (const rel of [...files].filter(rel => /\.m?js$/.test(rel) && !rel.startsWith("js/vendor/"))) {
    const text = read(rel).toString("utf8");
    const specs = [
      ...[...text.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(m => m[1]),
      ...[...text.matchAll(/\bimport\s*\(\s*["'`]([^"'`$]+)["'`]\s*\)/g)].map(m => m[1]),
      ...[...text.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)].map(m => m[1]),
      ...[...text.matchAll(/["'](\/js\/[^"'?#]+)/g)].map(m => m[1])
    ];
    for (const spec of specs) {
      let target;
      if (spec.startsWith("./") || spec.startsWith("../")) target = posix.normalize(posix.join(posix.dirname(rel), spec.split(/[?#]/)[0]));
      else if (spec.startsWith("/")) target = resolveUrlPath(spec);
      else continue; // bare/external specifiers
      if (!files.has(target)) missing.push(`${rel} -> ${spec}`);
    }
  }
  const supabaseLoader = read("js/vendor/supabase/supabase.js").toString("utf8");
  check(supabaseLoader.includes('.supabase.js"'), "supabase loader uses numbered chunks");
  check(files.has("js/vendor/supabase/591.supabase.js"), "dynamic supabase chunk 591 present");
  check(missing.length === 0, `all local references resolve: ${missing.join(", ") || "ok"}`);

  // 7. Route destinations exist in the output ----------------------------------
  const pageExists = dest => files.has(`${dest.replace(/^\/+/, "")}.html`) || files.has(dest.replace(/^\/+/, ""));
  for (const route of vercel.routes) if (route.dest) check(pageExists(route.dest), `route destination in output: ${route.dest}`);
  for (const rewrite of vercel.rewrites) {
    const dest = rewrite.destination.replace("/:path*", "");
    check(dest.includes("public/videos") ? [...files].some(rel => rel.startsWith("public/videos/")) : pageExists(dest), `rewrite destination in output: ${rewrite.destination}`);
  }

  // 8. Only the intentional browser anon key is public --------------------------
  for (const rel of files) {
    const text = read(rel).toString("latin1");
    check(!/service_role|sb_secret_|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `no server secret markers: ${rel}`);
    for (const [jwt] of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
      check(payload.role === "anon", `embedded JWT is anon only (${rel})`);
    }
  }

  console.log(`public deploy surface: PASS (${checks} checks, ${files.size} files, ${first.bytes} bytes, manifest ${first.manifestHash})`);
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
