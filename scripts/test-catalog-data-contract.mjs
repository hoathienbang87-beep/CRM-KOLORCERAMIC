import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const backupRoot = "D:/SUPABASE/BACKUPS/CRM-KOLORCERAMIC/2026-09-22_13-13-13";
const contractPath = path.join(repoRoot, "docs/catalog-integration-runbook/PRODUCT_DATA_CONTRACT.md");
const manifestPath = path.join(backupRoot, "manifest.json");
const summaryPath = path.join(backupRoot, "reconciliation/_work/analysis-summary.json");
const finalizedPath = path.join(backupRoot, "reconciliation/product-review-finalized.xlsx");
const supabasePath = path.join(backupRoot, "supabase/products.json");
const firebasePath = path.join(backupRoot, "firebase/products.json");
const currentSchemaPath = path.join(repoRoot, "supabase-phase-product-r2-clean-rebuild.sql");
const decisionsPath = path.join(repoRoot, "docs/catalog-integration-runbook/DECISIONS.md");

let checks = 0;
const failures = [];
function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const contract = fs.readFileSync(contractPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const supabase = JSON.parse(fs.readFileSync(supabasePath, "utf8")).rows;
const firebaseRaw = JSON.parse(fs.readFileSync(firebasePath, "utf8"));
const currentSchema = fs.readFileSync(currentSchemaPath, "utf8");
const decisions = fs.readFileSync(decisionsPath, "utf8");

const productExports = new Map(
  manifest.exports
    .filter((entry) => entry.object === "products")
    .map((entry) => [entry.source, entry])
);

check(summary.sources.supabase === 75, "Reconciliation must contain 75 Supabase products.");
check(summary.sources.firebase === 406, "Reconciliation must contain 406 Firebase products.");
check(summary.sources.excel === 224, "Reconciliation must contain 224 Excel rows.");
check(supabase.length === 75, "Supabase snapshot row count drifted from 75.");
check(firebaseRaw.documents?.length === 406, "Firebase snapshot row count drifted from 406.");
check(supabase.every((row) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)), "All 75 Supabase product IDs must remain UUIDs.");
check(supabase.every((row) => Number(row.width_cm) > 0 && Number(row.height_cm) > 0 && Number(row.price_per_m2) > 0), "Existing Supabase products must be safely backfillable to READY.");
check(productExports.get("supabase")?.sha256 === sha256(supabasePath), "Supabase products checksum must match manifest.");
check(productExports.get("firebase")?.sha256 === sha256(firebasePath), "Firebase products checksum must match manifest.");
check(sha256(finalizedPath) === "bdbe0ac5c1832391db83a9a55a6b90eb4359efd8644df4b45336c465ae7e1dd8", "Finalized workbook checksum drifted.");
check(/alter table public\.products alter column id type uuid/i.test(currentSchema), "Current Product baseline must use UUID IDs.");
check(/add column width_cm numeric\(9,3\) not null/i.test(currentSchema), "Current Product baseline width_cm contract was not found.");
check(/add column price_per_m2 numeric\(18,0\) not null/i.test(currentSchema), "Current Product baseline price contract was not found.");
check(decisions.includes("width_mm") && decisions.includes("height_mm"), "Approved decisions must require canonical millimetres.");

const requiredContractTerms = [
  "width_mm", "height_mm", "price_per_m2", "product_source_mappings",
  "UPDATING", "READY", "is_published", "EXCLUDED_BY_REVIEW",
  "Public catalog whitelist", "Snapshot báo giá", "STT 22 và 24",
  "95", "7", "406", "75", "359", "Không viết/chạy migration SQL"
];
for (const term of requiredContractTerms) {
  check(contract.includes(term), `Contract is missing required term: ${term}`);
}
check(!/service[_-]?role[_-]?key\s*[:=]\s*["'][^"']+/i.test(contract), "Contract must not contain a service-role credential.");
check(!/supabase\.co\/rest\/v1[^\n]*apikey/i.test(contract), "Contract must not embed API credentials.");

const python = [
  "from openpyxl import load_workbook",
  "import json,sys",
  "wb=load_workbook(sys.argv[1],read_only=True,data_only=True)",
  "ws=wb['Đã chốt']",
  "rows=[r for r in ws.iter_rows(min_row=9,values_only=True) if r[0] is not None]",
  "rm=wb['Đã loại']",
  "removed=[r for r in rm.iter_rows(min_row=9,values_only=True) if r[0] is not None]",
  "print(json.dumps({'retained':len(rows),'ready':sum(r[18]=='SẴN SÀNG' for r in rows),'updating':sum(r[18]=='ĐANG CẬP NHẬT' for r in rows),'missing_size':sum(not r[12] for r in rows),'missing_price':sum(r[14] is None for r in rows),'removed':[r[0] for r in removed]},ensure_ascii=False))",
].join(";");
const workbookResult = spawnSync("python", ["-c", python, finalizedPath], { encoding: "utf8" });
check(workbookResult.status === 0, `Finalized workbook must be readable: ${workbookResult.stderr.trim()}`);
if (workbookResult.status === 0) {
  const workbook = JSON.parse(workbookResult.stdout.trim());
  check(workbook.retained === 102, "Finalized workbook must retain 102 rows.");
  check(workbook.ready === 95, "Finalized workbook must contain 95 READY rows.");
  check(workbook.updating === 7, "Finalized workbook must contain 7 UPDATING rows.");
  check(workbook.missing_size === 3, "Finalized workbook must contain 3 rows missing size.");
  check(workbook.missing_price === 6, "Finalized workbook must contain 6 rows missing price.");
  check(JSON.stringify(workbook.removed) === JSON.stringify([22, 24]), "Only STT 22 and 24 may be excluded by review.");
}

if (failures.length) {
  console.error(`Catalog data contract: FAIL (${failures.length}/${checks})`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log(`Catalog data contract: PASS (${checks} checks)`);
