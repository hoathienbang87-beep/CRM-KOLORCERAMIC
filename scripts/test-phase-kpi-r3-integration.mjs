import fs from "node:fs";
import {PGlite} from "file:///C:/Users/ADMIN/AppData/Local/Temp/crm-products-r1-runtime/node_modules/@electric-sql/pglite/dist/index.js";

const migration = fs.readFileSync(new URL("../supabase-phase-kpi-r3-active-flexibility.sql", import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`
  create schema if not exists auth;
  create role anon; create role authenticated; create role service_role;
  create table public.app_users(id text primary key,email text,name text,role text,active boolean,lifecycle_status text);
  create table public.kpi_periods(id uuid primary key,period_month date,name text,status text,timezone text,starts_at timestamptz,ends_at timestamptz,created_by_user_id text,activated_by_user_id text,closed_by_user_id text,reopened_by_user_id text,reopen_reason text,created_at timestamptz default now(),updated_at timestamptz default now(),activated_at timestamptz,closed_at timestamptz,reopened_at timestamptz,version integer);
  create table public.kpi_definitions(id uuid primary key default gen_random_uuid(),code text unique,name text,description text,kpi_type text,source_metric_key text,unit text,submission_mode text,evidence_required boolean,active boolean default true,created_by_user_id text,updated_by_user_id text,created_at timestamptz default now(),updated_at timestamptz default now(),version integer default 1,aggregation_mode text,max_images_per_event integer,location_required boolean,timestamp_required boolean);
  create table public.kpi_assignments(id uuid primary key default gen_random_uuid(),period_id uuid,definition_id uuid,employee_id text,target numeric,effective_at timestamptz,assignment_status text,definition_snapshot jsonb,assigned_by_user_id text,assigned_at timestamptz,cancelled_by_user_id text,cancelled_at timestamptz,cancel_reason text,created_at timestamptz default now(),updated_at timestamptz default now(),lock_version integer,score_enabled boolean,unique(period_id,definition_id,employee_id));
  create table public.kpi_submissions(id uuid primary key default gen_random_uuid(),assignment_id uuid);
  create table public.kpi_submission_events(id uuid primary key default gen_random_uuid(),submission_id uuid,assignment_id uuid,status text,approved_value numeric default 0);
  create table public.kpi_evidence(id uuid primary key default gen_random_uuid(),assignment_id uuid,event_id uuid);
  create table public.audit_logs(id text primary key default gen_random_uuid()::text,action text,entity text,entity_id text,email text,payload_json text,created_at timestamptz default now(),raw_data jsonb);
  create table public.kpi_rules(id text); create table public.kpi_proposals(id text);
  create function public.crm_current_app_user_id() returns text language sql stable as $$select current_setting('test.actor',true)$$;
  create function public.crm_current_user_role() returns text language sql stable as $$select role from public.app_users where id=public.crm_current_app_user_id()$$;
  create function public.crm_kpi_is_business_manager() returns boolean language sql stable as $$select exists(select 1 from public.app_users where id=public.crm_current_app_user_id() and active and lifecycle_status='active' and role in ('manager','admin','owner'))$$;
  create function public.crm_kpi_definition_snapshot(d public.kpi_definitions) returns jsonb language sql stable as $$select jsonb_build_object('code',d.code,'name',d.name,'unit',d.unit,'aggregation_mode',d.aggregation_mode,'definition_version',d.version)$$;
  create function public.crm_kpi_write_audit(p_action text,p_entity text,p_entity_id text,p_payload jsonb default '{}'::jsonb) returns void language plpgsql as $$begin insert into public.audit_logs(action,entity,entity_id,email,payload_json,raw_data) select p_action,p_entity,p_entity_id,u.email,p_payload::text,p_payload from public.app_users u where u.id=public.crm_current_app_user_id(); end$$;
  create function public.crm_submit_kpi_proposal(text,jsonb) returns void language sql as $$select$$;
  create function public.crm_review_kpi_proposal(text,text,text,jsonb) returns void language sql as $$select$$;
  create function public.crm_archive_kpi_proposal(text) returns void language sql as $$select$$;
`);
await db.exec(migration);

const manager = "manager-1", sale = "sale-1", outsider = "sale-2";
const period = "11111111-1111-1111-1111-111111111111";
await db.exec(`
  insert into public.app_users values ('${manager}','m@example.com','Manager','manager',true,'active'),('${sale}','s@example.com','Sale','sale',true,'active'),('${outsider}','x@example.com','Other','sale',true,'active');
  select set_config('test.actor','${manager}',false);
  insert into public.kpi_periods(id,period_month,name,status,timezone,starts_at,ends_at,created_by_user_id,version) values ('${period}','2026-09-01','September','ACTIVE','Asia/Ho_Chi_Minh','2026-09-01','2026-10-01','${manager}',1);
  insert into public.kpi_definitions(code,name,kpi_type,unit,submission_mode,evidence_required,created_by_user_id,updated_by_user_id,aggregation_mode,max_images_per_event,location_required,timestamp_required) values ('NEW_CUSTOMER','New customer','MANUAL','customer','EVENT_CLAIM',true,'${manager}','${manager}','COUNT',1,false,true);
`);
const definition = (await db.query(`select id from public.kpi_definitions where code='NEW_CUSTOMER'`)).rows[0].id;
const assigned = (await db.query(`select public.crm_kpi_assign_employee_r3('${period}','${definition}','${sale}',7,1,'Bổ sung KPI bị thiếu') result`)).rows[0].result;
if (new Date(assigned.effective_at).getTime() <= new Date('2026-09-01').getTime()) throw new Error("ACTIVE assignment phải bắt đầu tại thời điểm tạo.");

let denied = 0;
try { await db.query(`select public.crm_kpi_assign_employee_r3('${period}','${definition}','${sale}',7,2,'Trùng')`); } catch { denied++; }
try { await db.query(`select public.crm_kpi_update_assignment_target_r3('${assigned.id}',5,1,2,'')`); } catch { denied++; }
try { await db.exec(`update public.kpi_periods set status='CLOSED' where id='${period}'; select public.crm_kpi_update_assignment_target_r3('${assigned.id}',5,1,2,'Không được');`); } catch { denied++; }
await db.exec(`update public.kpi_periods set status='ACTIVE' where id='${period}';`);
if (denied !== 3) throw new Error("Duplicate/reason/CLOSED denial không đầy đủ.");

const updated = (await db.query(`select public.crm_kpi_update_assignment_target_r3('${assigned.id}',5,1,2,'Sửa target 7 thành 5') result`)).rows[0].result;
if (Number(updated.target) !== 5) throw new Error("Target ACTIVE chưa cập nhật.");
const removed = (await db.query(`select public.crm_kpi_remove_or_cancel_assignment_r3('${assigned.id}',2,3,'Giao nhầm') result`)).rows[0].result;
if (removed.operation !== 'REMOVED') throw new Error("Assignment chưa dùng phải được gỡ.");

const a2 = (await db.query(`select public.crm_kpi_assign_employee_r3('${period}','${definition}','${outsider}',7,4,'Bổ sung KPI') result`)).rows[0].result;
await db.exec(`insert into public.kpi_submissions(assignment_id) values ('${a2.id}'); insert into public.kpi_submission_events(assignment_id,status,approved_value) values ('${a2.id}','APPROVED',4);`);
const cancelled = (await db.query(`select public.crm_kpi_remove_or_cancel_assignment_r3('${a2.id}',1,5,'Ngừng nhiệm vụ') result`)).rows[0].result;
if (cancelled.operation !== 'CANCELLED') throw new Error("Assignment đã dùng phải được cancel.");
const history = await db.query(`select assignment_status,cancel_reason from public.kpi_assignments where id='${a2.id}'`);
if (history.rows[0].assignment_status !== 'CANCELLED' || history.rows[0].cancel_reason !== 'Ngừng nhiệm vụ') throw new Error("Lịch sử cancellation không được giữ.");
const events = await db.query(`select count(*)::int count from public.kpi_submission_events where assignment_id='${a2.id}'`);
if (events.rows[0].count !== 1) throw new Error("Event lịch sử bị xóa.");
const audits = await db.query(`select action from public.audit_logs where action like 'ACTIVE_%'`);
if (audits.rows.length < 5) throw new Error("Thiếu audit ACTIVE.");

console.log(`CRM-KPI-R3 integration: PASS (${audits.rows.length} ACTIVE audit events, 3 negative guards)`);
await db.close();
