#!/usr/bin/env node
// Builds the public deployment directory (default: dist/) from an explicit
// runtime allowlist. Only files listed here can ever be served by Vercel.
// Node built-ins only; works on Windows, macOS and Linux.
//
// Usage: node scripts/build-public.mjs [--out <dir>] [--manifest]
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Runtime allowlist (the deploy contract). Paths are repo-relative, "/"-separated.
// ---------------------------------------------------------------------------
export const ALLOWED_FILES = [
  "index.html",                     // CRM shell (served at /crm, /crm/*)
  "website/index.html",             // Public Catalog (served at /)
  "admin/index.html",               // Product Admin (served at /admin, /admin/*)
  "qr/e-structure.html",            // E-STRUCTURE landing (served at /qr/e-structure)
  "public/videos/e-structure.mp4"   // served at /videos/e-structure.mp4
];

// Directories copied recursively; only the listed extensions / exact files are allowed inside.
export const ALLOWED_TREES = [
  { dir: "css", extensions: [".css"], exactFiles: [] },
  { dir: "js", extensions: [".js", ".mjs"], exactFiles: ["js/vendor/pdfjs/LICENSE"] }
];

// Files the runtime cannot work without. The build fails if any is missing.
export const REQUIRED_FILES = [
  ...ALLOWED_FILES,
  "css/styles.css",
  "css/catalog-website.css",
  "css/catalog-admin.css",
  "js/app.js",
  "js/supabase-config.js",
  "js/firebase.js",
  "js/features/crm-app.js",
  "js/vendor/supabase/supabase.js",
  "js/vendor/supabase/591.supabase.js", // dynamically loaded webpack chunk of supabase.js
  "js/website/catalog-bootstrap.js",
  "js/admin/catalog-admin-bootstrap.js",
  "js/config/maintenance.generated.js"
];

// Generated into the output (never copied from the source tree).
export const MAINTENANCE_FILE = "js/config/maintenance.generated.js";

export const ALLOWED_TOP_LEVEL = ["index.html", "website", "admin", "qr", "public", "css", "js"];

const FORBIDDEN_EXTENSIONS = [
  ".sql", ".md", ".markdown", ".toml", ".env", ".py", ".ps1", ".sh", ".bat", ".cmd",
  ".bundle", ".zip", ".tar", ".gz", ".7z", ".dump", ".backup", ".bak", ".csv", ".xlsx", ".xls",
  ".log", ".txt", ".yml", ".yaml", ".pem", ".key", ".map"
];
// Server-side Supabase source lives at the repo top level (supabase/); the browser
// client bundle under js/vendor/supabase/ is runtime and allowed.
const FORBIDDEN_TOP_LEVEL = ["supabase"];
const FORBIDDEN_SEGMENTS = [
  "scripts", "docs", "claude", "reconciliation-evidence", "release-evidence",
  "release-evidence-2026-10-07", "firebase-legacy-redirect", "node_modules", "fixtures", "tests", "test"
];
const FORBIDDEN_NAME_PATTERNS = [/^readme/i, /^agents/i, /^vercel\.json$/i, /^package(-lock)?\.json$/i];

export function forbiddenReason(relPath) {
  const parts = relPath.split("/");
  const name = parts[parts.length - 1];
  const lower = name.toLowerCase();
  if (parts.some(part => part.startsWith("."))) return "dot-file or dot-directory";
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  if (FORBIDDEN_EXTENSIONS.includes(ext)) return `forbidden extension ${ext}`;
  if (FORBIDDEN_TOP_LEVEL.includes(parts[0].toLowerCase())) return "forbidden top-level directory";
  if (parts.slice(0, -1).some(part => FORBIDDEN_SEGMENTS.includes(part.toLowerCase()))) return "forbidden directory";
  if (FORBIDDEN_NAME_PATTERNS.some(pattern => pattern.test(name))) return "forbidden file name";
  if (!ALLOWED_TOP_LEVEL.includes(parts[0])) return `top-level entry ${parts[0]} is not allowlisted`;
  return null;
}

const toPosix = value => value.split(sep).join("/");
const sha256 = buffer => createHash("sha256").update(buffer).digest("hex");

export function maintenanceEnabled(env = process.env, root = ROOT) {
  const truthy = value => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
  return existsSync(resolve(root, ".maintenance-on")) || truthy(env.VITE_MAINTENANCE_MODE);
}

// Byte-identical to scripts/generate-maintenance-config.mjs output.
export function maintenanceSource(enabled) {
  return `export const MAINTENANCE_CONFIG = {\n  enabled: ${enabled}\n};\n`;
}

function fail(message) {
  console.error(`build-public: FAIL — ${message}`);
  process.exit(1);
}

function resolveOutDir(argOut) {
  const out = resolve(ROOT, argOut || "dist");
  const rel = relative(out, ROOT);
  // Refuse the repo root, any ancestor of it, or anything inside a source/allowlisted/.git path.
  if (out === ROOT || rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) fail(`unsafe output directory ${out}`);
  const insideRoot = relative(ROOT, out);
  if (!insideRoot.startsWith("..") && !isAbsolute(insideRoot)) {
    const first = toPosix(insideRoot).split("/")[0];
    if (first !== "dist" || toPosix(insideRoot) !== "dist") fail(`output inside the repository must be exactly dist/ (got ${insideRoot})`);
  }
  return out;
}

function walk(dirAbs, relBase, collected) {
  for (const entry of readdirSync(dirAbs).sort()) {
    const abs = join(dirAbs, entry);
    const rel = `${relBase}/${entry}`;
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) fail(`symbolic link not allowed in runtime tree: ${rel}`);
    if (stat.isDirectory()) walk(abs, rel, collected);
    else if (stat.isFile()) collected.push(rel);
    else fail(`unsupported file type: ${rel}`);
  }
}

export function collectSources(root = ROOT) {
  const files = [];
  for (const file of ALLOWED_FILES) {
    const abs = resolve(root, file);
    if (!existsSync(abs)) fail(`required runtime file missing: ${file}`);
    if (!lstatSync(abs).isFile()) fail(`not a regular file: ${file}`);
    files.push(file);
  }
  for (const tree of ALLOWED_TREES) {
    const abs = resolve(root, tree.dir);
    if (!existsSync(abs)) fail(`required runtime directory missing: ${tree.dir}`);
    const found = [];
    walk(abs, tree.dir, found);
    for (const rel of found) {
      if (rel === MAINTENANCE_FILE) continue; // generated below
      const lower = rel.toLowerCase();
      const allowed = tree.exactFiles.includes(rel) || tree.extensions.some(ext => lower.endsWith(ext));
      if (!allowed) fail(`file not covered by the runtime allowlist: ${rel} (add it deliberately or remove it)`);
      files.push(rel);
    }
  }
  return files.sort();
}

export function build({ out: argOut, quiet = false } = {}) {
  const out = resolveOutDir(argOut);
  const sources = collectSources(ROOT);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const rel of sources) {
    const target = join(out, ...rel.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(ROOT, ...rel.split("/")), target);
  }
  const enabled = maintenanceEnabled();
  const maintenanceTarget = join(out, ...MAINTENANCE_FILE.split("/"));
  mkdirSync(dirname(maintenanceTarget), { recursive: true });
  writeFileSync(maintenanceTarget, maintenanceSource(enabled), "utf8");

  // Post-build assertion over what actually landed in the output.
  const written = [];
  for (const entry of readdirSync(out).sort()) {
    const abs = join(out, entry);
    if (lstatSync(abs).isDirectory()) walk(abs, entry, written);
    else written.push(entry);
  }
  written.sort();
  const violations = written.map(rel => [rel, forbiddenReason(rel)]).filter(([, reason]) => reason);
  if (violations.length) fail(`forbidden content in output:\n${violations.map(([rel, reason]) => `  ${rel} (${reason})`).join("\n")}`);
  const expected = [...sources, MAINTENANCE_FILE].sort();
  if (JSON.stringify(expected) !== JSON.stringify(written)) fail("output file set differs from the allowlisted source set");
  for (const rel of REQUIRED_FILES) if (!written.includes(rel)) fail(`required runtime file missing from output: ${rel}`);

  let bytes = 0;
  const manifest = written.map(rel => {
    const data = readFileSync(join(out, ...rel.split("/")));
    bytes += data.length;
    return `${sha256(data)}  ${data.length}  ${rel}`;
  });
  const manifestHash = sha256(Buffer.from(manifest.join("\n") + "\n"));
  if (!quiet) {
    console.log(`Maintenance mode: ${enabled ? "ON" : "OFF"}`);
    console.log(`build-public: ${written.length} files, ${bytes} bytes -> ${toPosix(relative(ROOT, out)) || out}`);
    console.log(`build-public: manifest sha256 ${manifestHash}`);
  }
  return { out, files: written, bytes, manifest, manifestHash, maintenanceEnabled: enabled };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const result = build({ out: outIndex >= 0 ? args[outIndex + 1] : undefined });
  if (args.includes("--manifest")) console.log(result.manifest.join("\n"));
}
