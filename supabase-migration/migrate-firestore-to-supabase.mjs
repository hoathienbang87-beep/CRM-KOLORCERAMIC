import "dotenv/config";
import fs from "node:fs";
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const batchSize = Number(process.env.BATCH_SIZE || 300);

const collectionPlans = [
  { source: "users", target: "app_users", map: mapUser },
  { source: "settings", target: "settings", map: mapSettings },
  { source: "customers", target: "customers", map: mapCustomer },
  { source: "careLogs", target: "care_logs", map: mapCareLog },
  { source: "deals", target: "deals", map: mapDeal },
  { source: "products", target: "products", map: mapProduct },
  { source: "kpiRules", target: "kpi_rules", map: mapKpiRule },
  { source: "kpiProposals", target: "kpi_proposals", map: mapKpiProposal },
  { source: "phoneIndex", target: "phone_index", map: mapPhoneIndex },
  { source: "auditLogs", target: "audit_logs", map: mapAuditLog },
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it.`);
  return value;
}

function initFirebase() {
  if (admin.apps.length) return;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID });
    return;
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath && fs.existsSync(credentialPath)) {
    const credential = admin.credential.cert(JSON.parse(fs.readFileSync(credentialPath, "utf8")));
    admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID });
    return;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

function initSupabase() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function nullable(value) {
  const text = clean(value);
  return text || null;
}

function bool(value, fallback = false) {
  if (value === true || value === "true" || value === "TRUE" || value === "active") return true;
  if (value === false || value === "false" || value === "FALSE" || value === "inactive") return false;
  return fallback;
}

function num(value) {
  if (value === "" || value == null) return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function timestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000)).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function raw(data) {
  return JSON.parse(JSON.stringify(data, (_key, value) => {
    if (value && typeof value.toDate === "function") return value.toDate().toISOString();
    if (value && typeof value === "object" && typeof value.seconds === "number") return timestamp(value);
    return value;
  }));
}

function base(doc) {
  return {
    id: doc.id,
    raw_data: raw(doc.data),
  };
}

function mapUser(doc) {
  const d = doc.data;
  return {
    ...base(doc),
    email: nullable(d.email),
    name: nullable(d.name),
    role: nullable(d.role) || "sale",
    active: bool(d.active, d.status === "active"),
    can_export: bool(d.canExport),
    team: nullable(d.team || d.department),
    phone: nullable(d.phone || d.phoneRaw),
    created_at: timestamp(d.createdAt),
    updated_at: timestamp(d.updatedAt),
  };
}

function mapSettings(doc) {
  return {
    id: doc.id,
    data: raw(doc.data),
    raw_data: raw(doc.data),
    updated_at: timestamp(doc.data.updatedAt),
  };
}

function mapCustomer(doc) {
  const d = doc.data;
  return {
    ...base(doc),
    name: nullable(d.name),
    company_name: nullable(d.companyName),
    phone_raw: nullable(d.phoneRaw),
    phone_normalized: nullable(d.phoneNormalized),
    no_phone: bool(d.noPhone),
    address: nullable(d.address),
    channel: nullable(d.channel),
    owner: nullable(d.owner),
    owner_email: nullable(d.ownerEmail),
    created_by_email: nullable(d.createdByEmail),
    status: nullable(d.status),
    follow: nullable(d.follow),
    next_care_date: timestamp(d.nextCareDate),
    last_contact_at: timestamp(d.lastContactAt),
    note: nullable(d.note),
    need: nullable(d.need),
    is_deleted: bool(d.isDeleted),
    deleted_at: timestamp(d.deletedAt),
    deleted_by_email: nullable(d.deletedByEmail),
    created_at: timestamp(d.createdAt),
    updated_at: timestamp(d.updatedAt),
  };
}

function mapCareLog(doc) {
  const d = doc.data;
  return {
    ...base(doc),
    customer_id: nullable(d.customerId),
    customer_name: nullable(d.customerName),
    phone_normalized: nullable(d.phoneNormalized),
    phone_raw: nullable(d.phoneRaw),
    owner: nullable(d.owner),
    owner_email: nullable(d.ownerEmail),
    created_by_email: nullable(d.createdByEmail),
    status: nullable(d.status),
    follow: nullable(d.follow),
    care_channel: nullable(d.careChannel),
    care_result: nullable(d.careResult),
    next_care_date: timestamp(d.nextCareDate),
    note: nullable(d.note),
    is_deleted: bool(d.isDeleted),
    deleted_at: timestamp(d.deletedAt),
    deleted_by_email: nullable(d.deletedByEmail),
    created_at: timestamp(d.createdAt),
    updated_at: timestamp(d.updatedAt),
  };
}

function mapDeal(doc) {
  const d = doc.data;
  return {
    ...base(doc),
    customer_id: nullable(d.customerId),
    customer_name: nullable(d.orderCustomerName || d.customerName),
    phone_normalized: nullable(d.phoneNormalized),
    phone_raw: nullable(d.orderPhone || d.phoneRaw),
    owner: nullable(d.owner),
    owner_email: nullable(d.ownerEmail),
    deal_status: nullable(d.dealStatus),
    product: nullable(d.product),
    items_text: nullable(d.itemsText),
    amount: num(d.amount),
    revenue: num(d.revenue || d.amount),
    completed: bool(d.completed),
    completed_at: timestamp(d.completedAt),
    canceled: bool(d.canceled),
    canceled_at: timestamp(d.canceledAt),
    note: nullable(d.note),
    is_deleted: bool(d.isDeleted),
    created_at: timestamp(d.createdAt || d.dealDate),
    updated_at: timestamp(d.updatedAt),
  };
}

function mapProduct(doc) {
  const d = doc.data;
  return {
    ...base(doc),
    name: nullable(d.name),
    sku: nullable(d.sku || d.code),
    price: num(d.price),
    unit: nullable(d.unit),
    active: bool(d.active, true),
    created_at: timestamp(d.createdAt),
    updated_at: timestamp(d.updatedAt),
  };
}

function mapKpiRule(doc) {
  const d = doc.data;
  return {
    ...base(doc),
    month: nullable(d.month),
    name: nullable(d.name),
    description: nullable(d.description),
    target: num(d.target),
    count_mode: nullable(d.countMode),
    assigned_owners: Array.isArray(d.assignedOwners) ? d.assignedOwners : [],
    owner_targets: d.ownerTargets && typeof d.ownerTargets === "object" ? d.ownerTargets : {},
    active: bool(d.active, true),
    created_by_email: nullable(d.createdByEmail),
    updated_by_email: nullable(d.updatedByEmail),
    created_at: timestamp(d.createdAt),
    updated_at: timestamp(d.updatedAt),
  };
}

function mapKpiProposal(doc) {
  const d = doc.data;
  return {
    ...base(doc),
    kpi_rule_id: nullable(d.kpiRuleId),
    kpi_name: nullable(d.kpiName),
    month: nullable(d.month),
    owner: nullable(d.owner),
    owner_email: nullable(d.ownerEmail),
    email: nullable(d.email),
    phone: nullable(d.phone),
    department: nullable(d.department),
    customer_id: nullable(d.customerId),
    customer_name: nullable(d.customerName),
    customer_phone: nullable(d.customerPhone),
    customer_company_name: nullable(d.customerCompanyName),
    customer_channel: nullable(d.customerChannel),
    content: nullable(d.content),
    evidence_url: nullable(d.evidenceUrl),
    status: nullable(d.status) || "pending",
    review_note: nullable(d.reviewNote),
    reviewed_by_email: nullable(d.reviewedByEmail),
    reviewed_at: timestamp(d.reviewedAt),
    is_deleted: bool(d.isDeleted),
    deleted_by_email: nullable(d.deletedByEmail),
    deleted_at: timestamp(d.deletedAt),
    created_by_email: nullable(d.createdByEmail),
    created_at: timestamp(d.createdAt),
    updated_at: timestamp(d.updatedAt),
  };
}

function mapPhoneIndex(doc) {
  const d = doc.data;
  return {
    phone: doc.id,
    customer_id: nullable(d.customerId),
    owner: nullable(d.owner),
    owner_email: nullable(d.ownerEmail),
    raw_data: raw(d),
  };
}

function mapAuditLog(doc) {
  const d = doc.data;
  return {
    ...base(doc),
    action: nullable(d.action),
    entity: nullable(d.entity),
    entity_id: nullable(d.entityId),
    email: nullable(d.email),
    payload_json: nullable(d.payloadJson),
    created_at: timestamp(d.createdAt),
  };
}

async function fetchCollection(db, name) {
  const snap = await db.collection(name).get();
  return snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function upsertRows(supabase, table, rows) {
  if (!rows.length) return;
  for (const part of chunk(rows, batchSize)) {
    const { error } = await supabase.from(table).upsert(part, { onConflict: table === "phone_index" ? "phone" : "id" });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main() {
  initFirebase();
  const firestore = admin.firestore();
  const supabase = initSupabase();
  const summary = [];

  for (const plan of collectionPlans) {
    const docs = await fetchCollection(firestore, plan.source);
    const rows = docs.map(plan.map);
    summary.push({ source: plan.source, target: plan.target, count: rows.length });
    console.log(`${dryRun ? "[dry-run] " : ""}${plan.source} -> ${plan.target}: ${rows.length} rows`);
    if (!dryRun) await upsertRows(supabase, plan.target, rows);
  }

  console.table(summary);
  console.log(dryRun ? "Dry-run done. No data was written." : "Migration done.");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
