import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "file:///C:/Users/ADMIN/AppData/Local/Temp/crm-products-r1-runtime/node_modules/@electric-sql/pglite/dist/index.js";

const migration = fs.readFileSync(new URL("../supabase-phase-kpi-r31-period-lifecycle.sql", import.meta.url), "utf8");
const db = new PGlite();

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.app_users(id text primary key, email text, name text, role text, active boolean, lifecycle_status text);
  create table public.kpi_periods(
    id uuid primary key, period_month date, name text, status text, timezone text,
    starts_at timestamptz, ends_at timestamptz, created_by_user_id text references public.app_users(id),
    activated_by_user_id text references public.app_users(id), closed_by_user_id text references public.app_users(id),
    reopened_by_user_id text references public.app_users(id), reopen_reason text, created_at timestamptz default now(),
    updated_at timestamptz default now(), activated_at timestamptz, closed_at timestamptz, reopened_at timestamptz,
    version integer not null default 1,
    constraint kpi_periods_status_check check(status in ('DRAFT','ACTIVE','CLOSED')),
    constraint kpi_periods_lifecycle_shape_check check(true)
  );
  create table public.kpi_definitions(id uuid primary key, code text unique, name text);
  create table public.kpi_assignments(
    id uuid primary key, period_id uuid references public.kpi_periods(id) on delete restrict,
    definition_id uuid references public.kpi_definitions(id), employee_id text references public.app_users(id),
    target numeric not null, score_enabled boolean not null default true, aggregation_mode text default 'COUNT',
    definition_snapshot jsonb default '{}'::jsonb, assignment_status text default 'ASSIGNED', lock_version integer default 1
  );
  create table public.kpi_submissions(id uuid primary key default gen_random_uuid(), assignment_id uuid references public.kpi_assignments(id));
  create table public.kpi_submission_events(
    id uuid primary key default gen_random_uuid(), submission_id uuid references public.kpi_submissions(id),
    assignment_id uuid references public.kpi_assignments(id), status text default 'PENDING', claimed_value numeric default 0,
    approved_value numeric default 0, reviewed_at timestamptz, supersedes_event_id uuid references public.kpi_submission_events(id)
  );
  create table public.kpi_evidence(id uuid primary key default gen_random_uuid(), assignment_id uuid references public.kpi_assignments(id), event_id uuid references public.kpi_submission_events(id));
  create table public.kpi_duplicate_matches(id uuid primary key default gen_random_uuid(), event_id uuid references public.kpi_submission_events(id));
  create table public.kpi_action_requests(id uuid primary key default gen_random_uuid(), response jsonb default '{}'::jsonb);
  create table public.audit_logs(id uuid primary key default gen_random_uuid(), action text, entity text, entity_id text, payload jsonb, actor text, created_at timestamptz default now());
  create function public.crm_current_app_user_id() returns text language sql stable as $$select current_setting('test.actor',true)$$;
  create function public.crm_kpi_is_business_manager() returns boolean language sql stable as $$select exists(select 1 from public.app_users where id=public.crm_current_app_user_id() and active and lifecycle_status='active' and role in ('manager','admin','owner'))$$;
  create function public.crm_kpi_is_admin_owner() returns boolean language sql stable as $$select exists(select 1 from public.app_users where id=public.crm_current_app_user_id() and active and lifecycle_status='active' and role in ('admin','owner'))$$;
  create function public.crm_kpi_r3_reason(p text) returns text language plpgsql immutable as $$declare v text:=btrim(coalesce(p,'')); begin if v='' or length(v)>500 then raise exception 'KPI_REASON_REQUIRED'; end if; return v; end$$;
  create function public.crm_kpi_write_audit(a text,e text,i text,p jsonb) returns void language sql as $$insert into public.audit_logs(action,entity,entity_id,payload,actor) values(a,e,i,p,public.crm_current_app_user_id())$$;
  create function public.crm_kpi_delete_draft_period(uuid,integer) returns jsonb language sql as $$select '{}'::jsonb$$;
`);
await db.exec(migration);

const owner = "owner", manager = "manager", sale = "sale";
const definition = "31111111-1111-4111-8111-111111111111";
const zeroPeriod = "31111111-1111-4111-8111-111111111112";
const zeroAssignment = "31111111-1111-4111-8111-111111111113";
const usedPeriod = "31111111-1111-4111-8111-111111111114";
const usedAssignment = "31111111-1111-4111-8111-111111111115";
await db.exec(`
  insert into public.app_users values
    ('${owner}','owner@example.com','Owner','owner',true,'active'),
    ('${manager}','manager@example.com','Manager','manager',true,'active'),
    ('${sale}','sale@example.com','Sale','sale',true,'active');
  insert into public.kpi_definitions values('${definition}','R31_SHARED','Shared definition');
  insert into public.kpi_periods(id,period_month,name,status,timezone,starts_at,ends_at,created_by_user_id,activated_by_user_id,activated_at,version) values
    ('${zeroPeriod}','2099-01-01','R3.1 zero','ACTIVE','Asia/Ho_Chi_Minh','2098-12-31 17:00+00','2099-01-31 17:00+00','${manager}','${manager}',now(),1),
    ('${usedPeriod}','2099-02-01','R3.1 used','ACTIVE','Asia/Ho_Chi_Minh','2099-01-31 17:00+00','2099-02-28 17:00+00','${owner}','${owner}',now(),1);
  insert into public.kpi_assignments(id,period_id,definition_id,employee_id,target,score_enabled,definition_snapshot) values
    ('${zeroAssignment}','${zeroPeriod}','${definition}','${sale}',7,true,'{"name":"Shared definition","aggregation_mode":"COUNT"}'),
    ('${usedAssignment}','${usedPeriod}','${definition}','${sale}',10,true,'{"name":"Shared definition","aggregation_mode":"COUNT"}');
  insert into public.kpi_submissions(id,assignment_id) values('31111111-1111-4111-8111-111111111116','${usedAssignment}');
  insert into public.kpi_submission_events(id,submission_id,assignment_id,status,claimed_value,approved_value,reviewed_at)
    values('31111111-1111-4111-8111-111111111117','31111111-1111-4111-8111-111111111116','${usedAssignment}','APPROVED',4,4,now());
  insert into public.kpi_evidence(id,assignment_id,event_id) values('31111111-1111-4111-8111-111111111118','${usedAssignment}','31111111-1111-4111-8111-111111111117');
`);

const setActor = id => db.exec(`select set_config('test.actor','${id}',false)`);
const denied = async (sql, pattern) => {
  try { await db.query(sql); assert.fail("Thao tác lẽ ra phải bị từ chối"); }
  catch (error) { if (error.code === "ERR_ASSERTION") throw error; assert.match(String(error.message), pattern); }
};

await setActor(manager);
await denied(`select public.crm_kpi_revert_active_period_to_draft('${zeroPeriod}',1,'   ')`, /KPI_REASON_REQUIRED/);
const reverted = (await db.query(`select public.crm_kpi_revert_active_period_to_draft('${zeroPeriod}',1,'Kích hoạt quá sớm') result`)).rows[0].result;
assert.equal(reverted.status, "DRAFT");
assert.equal(reverted.version, 2);
assert.equal((await db.query(`select count(*)::int n from public.kpi_assignments where id='${zeroAssignment}'`)).rows[0].n, 1);
await denied(`select public.crm_kpi_revert_active_period_to_draft('${usedPeriod}',1,'Không hợp lệ')`, /đã có dữ liệu/);
await denied(`select public.crm_kpi_cancel_active_period('${usedPeriod}',1,'Manager không được hủy')`, /Owner\/Admin/);

await setActor(owner);
const cancelled = (await db.query(`select public.crm_kpi_cancel_active_period('${usedPeriod}',1,'Hủy fixture đã dùng') result`)).rows[0].result;
assert.equal(cancelled.status, "CANCELLED");
assert.equal(cancelled.cancel_reason, "Hủy fixture đã dùng");
assert.equal((await db.query(`select count(*)::int n from public.kpi_submission_events where assignment_id='${usedAssignment}'`)).rows[0].n, 1);
await denied(`insert into public.kpi_submissions(assignment_id) values('${usedAssignment}') returning id`, /đóng băng/);
await denied(`update public.kpi_submission_events set status='REJECTED' where assignment_id='${usedAssignment}' returning id`, /đóng băng/);
await denied(`delete from public.kpi_evidence where assignment_id='${usedAssignment}' returning id`, /đóng băng/);
assert.equal((await db.query(`select count(*)::int n from public.crm_kpi_get_monthly_scores('${usedPeriod}')`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from public.crm_kpi_get_assignment_progress('${usedPeriod}')`)).rows[0].n, 1);
await denied(`select public.crm_kpi_revert_active_period_to_draft('${usedPeriod}',2,'Không được')`, /Chỉ kỳ ACTIVE/);

await setActor(manager);
const deleted = (await db.query(`select public.crm_kpi_delete_draft_period('${zeroPeriod}',2,'Dọn fixture') result`)).rows[0].result;
assert.equal(deleted.deleted, true);
assert.equal((await db.query(`select count(*)::int n from public.kpi_definitions where id='${definition}'`)).rows[0].n, 1);
assert.equal((await db.query(`select count(*)::int n from public.kpi_periods where id='${zeroPeriod}'`)).rows[0].n, 0);

await db.exec(`
  insert into public.kpi_periods(id,period_month,name,status,timezone,starts_at,ends_at,created_by_user_id,activated_by_user_id,activated_at,closed_by_user_id,closed_at,version)
  values('31111111-1111-4111-8111-111111111119','2099-03-01','R3.1 closed','CLOSED','Asia/Ho_Chi_Minh','2099-02-28 17:00+00','2099-03-31 17:00+00','${owner}','${owner}',now(),'${owner}',now(),1);
`);
await setActor(owner);
await denied(`select public.crm_kpi_cancel_active_period('31111111-1111-4111-8111-111111111119',1,'Không được')`, /Chỉ kỳ ACTIVE/);
await denied(`select public.crm_kpi_delete_draft_period('31111111-1111-4111-8111-111111111119',1,'Không được')`, /Chỉ kỳ DRAFT/);

const audits = await db.query("select action from public.audit_logs order by created_at");
assert.deepEqual(audits.rows.map(row => row.action), ["PERIOD_REVERTED_TO_DRAFT", "PERIOD_CANCELLED", "PERIOD_DELETED_DRAFT"]);
console.log("CRM-KPI-R3.1 integration: PASS (revert/delete/cancel/roles/freeze/score/history/audit)");
await db.close();
