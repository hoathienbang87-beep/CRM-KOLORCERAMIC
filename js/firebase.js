import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const config = window.CRM_SUPABASE_CONFIG || {};
export const app = {};
export const db = {};
export const auth = {};

export const supabase = createClient(config.url || "https://example.supabase.co", config.anonKey || "anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const tableMap = {
  users: "app_users",
  settings: "settings",
  customers: "customers",
  careLogs: "care_logs",
  deals: "deals",
  products: "products",
  kpiRules: "kpi_rules",
  kpiProposals: "kpi_proposals",
  phoneIndex: "phone_index",
  auditLogs: "audit_logs",
  userSessions: "user_sessions"
};

const reverseTableMap = Object.fromEntries(Object.entries(tableMap).map(([k, v]) => [v, k]));
const listeners = new Set();
const realtimeTables = new Map();
const DELETE_FIELD = Symbol("deleteField");

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function snakeToCamelKey(key) {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function camelToSnakeKey(key) {
  return key.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeValue(value) {
  if (value === DELETE_FIELD) return undefined;
  if (value && value.__serverTimestamp) return nowIso();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeValue(v)]).filter(([, v]) => v !== undefined));
  }
  return value;
}

function camelize(row = {}, collectionName = "") {
  if (!row) return {};
  const raw = row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};
  const converted = {};
  Object.entries(row).forEach(([key, value]) => {
    if (key === "raw_data" || key === "data") return;
    converted[snakeToCamelKey(key)] = value;
  });
  const merged = { ...raw, ...converted };
  if (collectionName === "users") merged.uid = row.id;
  if (collectionName === "settings") return { ...(row.data || raw), id: row.id };
  return merged;
}

function tableName(collectionName) {
  return tableMap[collectionName] || collectionName;
}

function collectionNameFromTable(table) {
  return reverseTableMap[table] || table;
}

function rowBase(ref, data) {
  return { id: ref.id, raw_data: normalizeValue(data) || {} };
}

function first(...values) {
  return values.find(v => v !== undefined && v !== null && v !== "");
}

function rowFor(ref, input) {
  const data = normalizeValue(input) || {};
  const id = ref.id;
  switch (ref.collection) {
    case "settings":
      return { id, data, raw_data: data, updated_at: first(data.updatedAt, data.updated_at, nowIso()) };
    case "users":
      return {
        ...rowBase(ref, data),
        email: first(data.email, null),
        name: first(data.name, null),
        role: first(data.role, "sale"),
        active: first(data.active, data.status === "active", false),
        can_export: first(data.canExport, data.can_export, false),
        team: first(data.team, data.department, null),
        phone: first(data.phone, data.phoneRaw, null),
        created_at: first(data.createdAt, data.created_at, null),
        updated_at: first(data.updatedAt, data.updated_at, null)
      };
    case "customers":
      return {
        ...rowBase(ref, data),
        name: first(data.name, null),
        company_name: first(data.companyName, data.company_name, null),
        phone_raw: first(data.phoneRaw, data.phone_raw, null),
        phone_normalized: first(data.phoneNormalized, data.phone_normalized, null),
        no_phone: first(data.noPhone, data.no_phone, false),
        address: first(data.address, null),
        channel: first(data.channel, null),
        owner: first(data.owner, null),
        owner_email: first(data.ownerEmail, data.owner_email, null),
        created_by_email: first(data.createdByEmail, data.created_by_email, null),
        status: first(data.status, null),
        follow: first(data.follow, null),
        next_care_date: first(data.nextCareDate, data.next_care_date, null),
        last_contact_at: first(data.lastContactAt, data.last_contact_at, null),
        note: first(data.note, null),
        need: first(data.need, null),
        is_deleted: first(data.isDeleted, data.is_deleted, false),
        deleted_at: first(data.deletedAt, data.deleted_at, null),
        deleted_by_email: first(data.deletedByEmail, data.deleted_by_email, null),
        created_at: first(data.createdAt, data.created_at, null),
        updated_at: first(data.updatedAt, data.updated_at, null)
      };
    case "careLogs":
      return {
        ...rowBase(ref, data),
        customer_id: first(data.customerId, data.customer_id, null),
        customer_name: first(data.customerName, data.customer_name, null),
        phone_normalized: first(data.phoneNormalized, data.phone_normalized, null),
        phone_raw: first(data.phoneRaw, data.phone_raw, null),
        owner: first(data.owner, null),
        owner_email: first(data.ownerEmail, data.owner_email, null),
        created_by_email: first(data.createdByEmail, data.created_by_email, null),
        status: first(data.status, null),
        follow: first(data.follow, null),
        care_channel: first(data.careChannel, data.care_channel, null),
        care_result: first(data.careResult, data.care_result, null),
        next_care_date: first(data.nextCareDate, data.next_care_date, null),
        note: first(data.note, null),
        is_deleted: first(data.isDeleted, data.is_deleted, false),
        deleted_at: first(data.deletedAt, data.deleted_at, null),
        deleted_by_email: first(data.deletedByEmail, data.deleted_by_email, null),
        created_at: first(data.createdAt, data.created_at, null),
        updated_at: first(data.updatedAt, data.updated_at, null)
      };
    case "deals":
      return {
        ...rowBase(ref, data),
        customer_id: first(data.customerId, data.customer_id, null),
        customer_name: first(data.orderCustomerName, data.customerName, data.customer_name, null),
        phone_normalized: first(data.phoneNormalized, data.phone_normalized, null),
        phone_raw: first(data.orderPhone, data.phoneRaw, data.phone_raw, null),
        owner: first(data.owner, null),
        owner_email: first(data.ownerEmail, data.owner_email, null),
        deal_status: first(data.dealStatus, data.deal_status, null),
        product: first(data.product, null),
        items_text: first(data.itemsText, data.items_text, null),
        amount: first(data.amount, null),
        revenue: first(data.revenue, data.amount, null),
        completed: first(data.completed, false),
        completed_at: first(data.completedAt, data.completed_at, null),
        canceled: first(data.canceled, false),
        canceled_at: first(data.canceledAt, data.canceled_at, null),
        note: first(data.note, null),
        is_deleted: first(data.isDeleted, data.is_deleted, false),
        created_at: first(data.createdAt, data.dealDate, data.created_at, null),
        updated_at: first(data.updatedAt, data.updated_at, null)
      };
    case "products":
      return {
        ...rowBase(ref, data),
        name: first(data.name, null),
        sku: first(data.sku, data.code, null),
        price: first(data.price, null),
        unit: first(data.unit, data.size, null),
        active: first(data.active, true),
        created_at: first(data.createdAt, data.created_at, null),
        updated_at: first(data.updatedAt, data.updated_at, null)
      };
    case "kpiRules":
      return {
        ...rowBase(ref, data),
        month: first(data.month, null),
        name: first(data.name, null),
        description: first(data.description, null),
        target: first(data.target, null),
        count_mode: first(data.countMode, data.count_mode, null),
        assigned_owners: first(data.assignedOwners, data.assigned_owners, []),
        owner_targets: first(data.ownerTargets, data.owner_targets, {}),
        active: first(data.active, true),
        created_by_email: first(data.createdByEmail, data.created_by_email, null),
        updated_by_email: first(data.updatedByEmail, data.updated_by_email, null),
        created_at: first(data.createdAt, data.created_at, null),
        updated_at: first(data.updatedAt, data.updated_at, null)
      };
    case "kpiProposals":
      return {
        ...rowBase(ref, data),
        kpi_rule_id: first(data.kpiRuleId, data.kpi_rule_id, null),
        kpi_name: first(data.kpiName, data.kpi_name, null),
        month: first(data.month, null),
        owner: first(data.owner, null),
        owner_email: first(data.ownerEmail, data.owner_email, null),
        email: first(data.email, null),
        phone: first(data.phone, null),
        department: first(data.department, null),
        customer_id: first(data.customerId, data.customer_id, null),
        customer_name: first(data.customerName, data.customer_name, null),
        customer_phone: first(data.customerPhone, data.customer_phone, null),
        customer_company_name: first(data.customerCompanyName, data.customer_company_name, null),
        customer_channel: first(data.customerChannel, data.customer_channel, null),
        content: first(data.content, null),
        evidence_url: first(data.evidenceUrl, data.evidence_url, null),
        status: first(data.status, "pending"),
        review_note: first(data.reviewNote, data.review_note, null),
        reviewed_by_email: first(data.reviewedByEmail, data.reviewed_by_email, null),
        reviewed_at: first(data.reviewedAt, data.reviewed_at, null),
        is_deleted: first(data.isDeleted, data.is_deleted, false),
        deleted_by_email: first(data.deletedByEmail, data.deleted_by_email, null),
        deleted_at: first(data.deletedAt, data.deleted_at, null),
        created_by_email: first(data.createdByEmail, data.created_by_email, null),
        created_at: first(data.createdAt, data.created_at, null),
        updated_at: first(data.updatedAt, data.updated_at, null)
      };
    case "phoneIndex":
      return {
        phone: id,
        customer_id: first(data.customerId, data.customer_id, null),
        owner: first(data.owner, null),
        owner_email: first(data.ownerEmail, data.owner_email, null),
        raw_data: data
      };
    case "auditLogs":
      return {
        ...rowBase(ref, data),
        action: first(data.action, null),
        entity: first(data.entity, null),
        entity_id: first(data.entityId, data.entity_id, null),
        email: first(data.email, null),
        payload_json: first(data.payloadJson, data.payload_json, null),
        created_at: first(data.createdAt, data.created_at, null)
      };
    case "userSessions":
      return {
        ...rowBase(ref, data),
        email: first(data.email, null),
        name: first(data.name, null),
        role: first(data.role, null),
        online: first(data.online, false),
        last_seen_at: first(data.lastSeenAt, data.last_seen_at, null),
        updated_at: first(data.updatedAt, data.updated_at, null)
      };
    default:
      return rowBase(ref, data);
  }
}

function stripUndefined(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function snapFromRows(rows, collectionName) {
  return {
    docs: (rows || []).map(row => ({
      id: String(row.id || row.phone || ""),
      data: () => camelize(row, collectionName),
      exists: () => true
    }))
  };
}

async function selectRows(target) {
  const table = tableName(target.collection);
  let q = supabase.from(table).select("*");
  (target.filters || []).forEach(f => {
    const field = camelToSnakeKey(f.field);
    if (f.op === "==") q = q.eq(field, f.value);
  });
  if (target.limitValue) q = q.limit(target.limitValue);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function fetchRef(ref) {
  const table = tableName(ref.collection);
  const idField = ref.collection === "phoneIndex" ? "phone" : "id";
  let { data, error } = await supabase.from(table).select("*").eq(idField, ref.id).maybeSingle();
  if (error) throw error;
  if (!data && ref.collection === "users") {
    const { data: authData } = await supabase.auth.getUser();
    const email = authData?.user?.email;
    if (email) {
      const fallback = await supabase.from(table).select("*").eq("email", email).maybeSingle();
      if (fallback.error) throw fallback.error;
      data = fallback.data;
    }
  }
  return data;
}

async function writeRef(ref, data, options = {}) {
  const table = tableName(ref.collection);
  const row = stripUndefined(rowFor(ref, data));
  if (options.merge) {
    const existing = await fetchRef(ref);
    const oldRaw = existing?.raw_data && typeof existing.raw_data === "object" ? existing.raw_data : {};
    row.raw_data = { ...oldRaw, ...(row.raw_data || {}) };
  }
  const onConflict = ref.collection === "phoneIndex" ? "phone" : "id";
  const { error } = await supabase.from(table).upsert(row, { onConflict });
  if (error) throw error;
  refreshListeners();
}

async function updateRef(ref, data) {
  const existing = await fetchRef(ref);
  const oldRaw = existing?.raw_data && typeof existing.raw_data === "object" ? existing.raw_data : {};
  const row = stripUndefined(rowFor(ref, { ...oldRaw, ...normalizeValue(data) }));
  row.raw_data = { ...oldRaw, ...(normalizeValue(data) || {}) };
  const table = tableName(ref.collection);
  const idField = ref.collection === "phoneIndex" ? "phone" : "id";
  const { error } = await supabase.from(table).update(row).eq(idField, ref.id);
  if (error) throw error;
  refreshListeners();
}

async function deleteRef(ref) {
  const table = tableName(ref.collection);
  const idField = ref.collection === "phoneIndex" ? "phone" : "id";
  const { error } = await supabase.from(table).delete().eq(idField, ref.id);
  if (error) throw error;
  refreshListeners();
}

let refreshTimer = null;
function refreshListeners(table = "") {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    listeners.forEach(listener => {
      if (table && listener.table !== table) return;
      listener.fetch().catch(err => listener.error?.(err));
    });
  }, 120);
}

function realtimeTableFor(target) {
  return target?.collection ? tableName(target.collection) : "";
}

function subscribeRealtime(table) {
  if (!table) return () => {};
  const existing = realtimeTables.get(table);
  if (existing) {
    existing.count += 1;
    return () => unsubscribeRealtime(table);
  }

  const channel = supabase
    .channel(`crm-realtime-${table}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, () => refreshListeners(table))
    .subscribe();

  realtimeTables.set(table, { channel, count: 1 });
  return () => unsubscribeRealtime(table);
}

function unsubscribeRealtime(table) {
  const existing = realtimeTables.get(table);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count > 0) return;
  realtimeTables.delete(table);
  supabase.removeChannel(existing.channel);
}

export function collection(_dbOrRef, name) {
  if (typeof _dbOrRef === "string" && !name) return { type: "collection", collection: _dbOrRef };
  return { type: "collection", collection: name };
}

export function doc(a, b, c) {
  if (a?.type === "collection") return { type: "doc", collection: a.collection, id: b || crypto.randomUUID() };
  return { type: "doc", collection: b, id: c };
}

export function query(base, ...constraints) {
  const target = { ...base, filters: [...(base.filters || [])] };
  constraints.forEach(c => {
    if (c.type === "where") target.filters.push(c);
    if (c.type === "limit") target.limitValue = c.value;
  });
  return target;
}

export function where(field, op, value) {
  return { type: "where", field, op, value };
}

export function limit(value) {
  return { type: "limit", value };
}

export async function getDoc(ref) {
  const row = await fetchRef(ref);
  return {
    id: ref.id,
    exists: () => Boolean(row),
    data: () => camelize(row || {}, ref.collection)
  };
}

export async function getDocs(target) {
  const rows = await selectRows(target);
  return snapFromRows(rows, target.collection);
}

export async function setDoc(ref, data, options) {
  return writeRef(ref, data, options);
}

export function onSnapshot(target, next, error) {
  const listener = {
    target,
    table: realtimeTableFor(target),
    error,
    fetch: async () => {
      if (target.type === "doc") {
        const row = await fetchRef(target);
        next({
          id: target.id,
          exists: () => Boolean(row),
          data: () => camelize(row || {}, target.collection)
        });
      } else {
        const rows = await selectRows(target);
        next(snapFromRows(rows, target.collection));
      }
    }
  };
  listeners.add(listener);
  const unsubscribeRealtimeTable = subscribeRealtime(listener.table);
  listener.fetch().catch(err => error?.(err));
  return () => {
    listeners.delete(listener);
    unsubscribeRealtimeTable();
  };
}

export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data, options) => ops.push(() => writeRef(ref, data, options)),
    update: (ref, data) => ops.push(() => updateRef(ref, data)),
    delete: ref => ops.push(() => deleteRef(ref)),
    commit: async () => {
      for (const op of ops) await op();
      refreshListeners();
    }
  };
}

export async function runTransaction(_db, callback) {
  const tx = {
    get: getDoc,
    set: (ref, data, options) => writeRef(ref, data, options),
    update: updateRef,
    delete: deleteRef
  };
  return callback(tx);
}

export function serverTimestamp() {
  return { __serverTimestamp: true };
}

export function deleteField() {
  return DELETE_FIELD;
}

function withFirebaseUserCompat(user) {
  if (!user) return null;
  return {
    ...user,
    uid: user.uid || user.id,
    displayName: user.user_metadata?.name || user.user_metadata?.full_name || user.email || "",
    photoURL: user.user_metadata?.avatar_url || user.user_metadata?.picture || ""
  };
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { user: withFirebaseUserCompat(data.user) };
}

export class GoogleAuthProvider {}

export async function signInWithPopup() {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "select_account"
      }
    }
  });
  if (error) throw error;
  return data;
}

export function onAuthStateChanged(_auth, callback) {
  supabase.auth.getUser().then(({ data }) => callback(withFirebaseUserCompat(data.user)));
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(withFirebaseUserCompat(session?.user)));
  return () => data.subscription.unsubscribe();
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export const firebaseConfig = {};
