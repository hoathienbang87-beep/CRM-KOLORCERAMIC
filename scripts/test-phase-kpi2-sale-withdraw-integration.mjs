import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "file:///C:/Users/ADMIN/AppData/Local/Temp/crm-products-r1-runtime/node_modules/@electric-sql/pglite/dist/index.js";

const migration = fs.readFileSync(new URL("../supabase-phase-kpi2-sale-withdraw-pending-event.sql", import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create table public.app_users(id text primary key, role text, active boolean default true);
  create table public.kpi_periods(id uuid primary key, status text, starts_at timestamptz, ends_at timestamptz);
  create table public.kpi_assignments(id uuid primary key, period_id uuid references public.kpi_periods(id), employee_id text references public.app_users(id), assignment_status text, definition_snapshot jsonb default '{}'::jsonb);
  create table public.kpi_submissions(id uuid primary key, assignment_id uuid references public.kpi_assignments(id), status text default 'OPEN_REVIEW', updated_at timestamptz default now(), lock_version integer default 1);
  create table public.kpi_submission_events(
    id uuid primary key, submission_id uuid references public.kpi_submissions(id), assignment_id uuid references public.kpi_assignments(id),
    source_type text not null, source_id text, source_event_key text not null, event_at timestamptz not null, actor_user_id text not null,
    customer_id text, claimed_value numeric not null default 1, approved_value numeric, event_snapshot jsonb not null default '{}'::jsonb,
    location_snapshot jsonb, possible_duplicate boolean not null default false, duplicate_context jsonb not null default '[]'::jsonb,
    status text not null default 'PENDING', review_reason_code text, manager_note text, reviewed_by_user_id text, reviewed_at timestamptz,
    supersedes_event_id uuid, root_event_id uuid, revision_no integer not null default 1, created_at timestamptz default now(), updated_at timestamptz default now(), lock_version integer not null default 1
  );
  create table public.kpi_evidence(id uuid primary key, assignment_id uuid, event_id uuid, status text default 'ATTACHED');
  create table public.kpi_action_requests(id uuid primary key default gen_random_uuid(), actor_user_id text not null, action text not null, request_id uuid not null, request_payload_hash text not null, request_schema_version integer default 1, response jsonb not null default '{}', unique(actor_user_id, action, request_id));
  create table public.audit_logs(id uuid primary key default gen_random_uuid(), action text, entity text, entity_id text, payload jsonb, created_at timestamptz default now());
  create table public.care_logs(id text primary key, created_at timestamptz, created_by_email text, customer_id text, customer_name text, care_result text, note text, is_deleted boolean default false);
  create table public.customers(id text primary key, created_at timestamptz, created_by_user_id text, name text, company_name text, channel text, is_deleted boolean default false);
  create function public.crm_current_app_user_id() returns text language sql stable as $$select current_setting('test.actor',true)$$;
  create function public.crm_is_active_user() returns boolean language sql stable as $$select exists(select 1 from public.app_users where id=public.crm_current_app_user_id() and active)$$;
  create function public.crm_kpi_payload_hash(jsonb) returns text language sql immutable as $$select md5(coalesce($1,'null'::jsonb)::text)$$;
  create function public.crm_kpi_idempotent_response(text,text,uuid,text) returns jsonb language sql as $$select response from public.kpi_action_requests where actor_user_id=$1 and action=$2 and request_id=$3 and request_payload_hash=$4$$;
  create function public.crm_kpi_write_audit(text,text,text,jsonb) returns void language sql as $$insert into public.audit_logs(action,entity,entity_id,payload) values($1,$2,$3,$4)$$;
  create function public.crm_kpi_resolve_user_id_by_email(text) returns text language sql stable as $$select null::text$$;
  create function public.crm_can_access_customer_id(text) returns boolean language sql stable as $$select true$$;
`);
await db.exec(migration);

const period = "51111111-1111-4111-8111-111111111111";
const assignment = "51111111-1111-4111-8111-111111111112";
const submission = "51111111-1111-4111-8111-111111111113";
const event = "51111111-1111-4111-8111-111111111114";
const evidence = "51111111-1111-4111-8111-111111111115";
const request = "51111111-1111-4111-8111-111111111116";
const sale = "sale-withdraw";
await db.exec(`
  insert into public.app_users(id,role,active) values ('${sale}','sale',true),('manager','manager',true);
  insert into public.kpi_periods(id,status,starts_at,ends_at) values ('${period}','ACTIVE','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z');
  insert into public.kpi_assignments(id,period_id,employee_id,assignment_status,definition_snapshot) values ('${assignment}','${period}','${sale}','ASSIGNED','{"source_metric_key":"customers_v1"}');
  insert into public.kpi_submissions(id,assignment_id,status) values ('${submission}','${assignment}','OPEN_REVIEW');
  insert into public.kpi_submission_events(id,submission_id,assignment_id,source_type,source_event_key,event_at,actor_user_id,status,lock_version) values ('${event}','${submission}','${assignment}','CUSTOMER','customer:c1','2026-09-05T00:00:00Z','${sale}','PENDING',1);
  insert into public.kpi_evidence(id,assignment_id,event_id,status) values ('${evidence}','${assignment}','${event}','ATTACHED');
  insert into public.customers(id,created_at,created_by_user_id,name) values ('c1','2026-09-05T00:00:00Z','${sale}','Khách test');
`);
await db.exec(`select set_config('test.actor','${sale}',false)`);
const result = (await db.query(`select public.crm_kpi_withdraw_event('${event}',1,'Gửi nhầm KPI','${request}') result`)).rows[0].result;
assert.equal(result.status, "WITHDRAWN");
assert.equal((await db.query(`select status,withdrawn_by_user_id,withdraw_reason,lock_version from public.kpi_submission_events where id='${event}'`)).rows[0].status, "WITHDRAWN");
assert.equal((await db.query(`select status from public.kpi_submissions where id='${submission}'`)).rows[0].status, "COMPLETED");
assert.equal((await db.query(`select status from public.kpi_evidence where id='${evidence}'`)).rows[0].status, "ATTACHED");
assert.equal((await db.query(`select count(*)::int n from public.audit_logs where action='event_withdraw'`)).rows[0].n, 1);
const replay = (await db.query(`select public.crm_kpi_withdraw_event('${event}',1,'Gửi nhầm KPI','${request}') result`)).rows[0].result;
assert.deepEqual(replay, result);
const candidates = (await db.query(`select public.crm_kpi_list_hybrid_candidates('${assignment}') as candidate`)).rows;
assert.equal(candidates.length, 1);
assert.equal(candidates[0].candidate.claimed, false);
await db.exec(`insert into public.kpi_submissions(id,assignment_id,status) values ('51111111-1111-4111-8111-111111111117','${assignment}','OPEN_REVIEW'); insert into public.kpi_submission_events(id,submission_id,assignment_id,source_type,source_event_key,event_at,actor_user_id,status,lock_version) values ('51111111-1111-4111-8111-111111111118','51111111-1111-4111-8111-111111111117','${assignment}','CUSTOMER','customer:c1','2026-09-06T00:00:00Z','${sale}','PENDING',1);`);
const denied = async (sql, pattern) => { try { await db.query(sql); assert.fail("expected denial"); } catch (error) { if (error.code === "ERR_ASSERTION") throw error; assert.match(String(error.message), pattern); } };
await denied(`select public.crm_kpi_withdraw_event('51111111-1111-4111-8111-111111111118',9,'Sai lock','51111111-1111-4111-8111-111111111119')`, /EVENT_VERSION_CONFLICT/);
await db.exec(`select set_config('test.actor','manager',false);`);
await denied(`select public.crm_kpi_withdraw_event('51111111-1111-4111-8111-111111111118',1,'Manager thử','51111111-1111-4111-8111-111111111120')`, /Chi Sale/);
console.log("KPI-2 Sale withdraw integration: PASS (transition/evidence/submission/audit/idempotency/reclaim/guards)");
await db.close();
