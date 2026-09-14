import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("supabase-phase-kpi2-sale-withdraw-pending-event.sql", "utf8");
const app = fs.readFileSync("js/features/crm-app.js", "utf8");
const team = fs.readFileSync("js/features/kpi-team.js", "utf8");
let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };

check(/^begin;$/im.test(sql) && /^commit;$/im.test(sql), "withdraw migration is transactional");
check(/add column if not exists withdrawn_by_user_id text references public\.app_users/i.test(sql), "withdraw actor metadata is retained");
check(/add column if not exists withdrawn_at timestamptz/i.test(sql) && /add column if not exists withdraw_reason text/i.test(sql), "withdraw timestamp and reason are retained");
check(/'WITHDRAWN'/i.test(sql), "WITHDRAWN lifecycle status is present");
check(/status = 'WITHDRAWN'[\s\S]*withdrawn_by_user_id is not null[\s\S]*withdraw_reason/i.test(sql), "withdrawn row shape is constrained");
check(/status <> 'WITHDRAWN'/i.test(sql), "withdrawn root events can be claimed again");
check(/crm_kpi_refresh_submission_status[\s\S]*'APPROVED', 'REJECTED', 'WITHDRAWN'/i.test(sql), "withdrawn events finalize submission status");
check(/crm_kpi_list_hybrid_candidates[\s\S]*status <> 'WITHDRAWN'/i.test(sql), "hybrid candidates ignore withdrawn claims");
check(/create or replace function public\.crm_kpi_withdraw_event\(/i.test(sql), "withdraw RPC exists");
check(/crm_is_active_user\(\)[\s\S]*role[\s\S]*sale/i.test(sql), "withdraw RPC requires active Sale actor");
check(/actor_user_id <> v_actor/i.test(sql) && /supersedes_event_id is not null/i.test(sql), "withdraw RPC enforces ownership and root-only scope");
check(/v_event\.status <> 'PENDING'[\s\S]*lock_version <> p_expected_lock_version/i.test(sql), "withdraw RPC enforces PENDING and optimistic locking");
check(/set_config\('crm\.kpi_write', 'on', true\)/i.test(sql), "withdraw RPC uses the canonical write guard");
check(/crm_kpi_idempotent_response/i.test(sql) && /kpi_action_requests[\s\S]*event_withdraw/i.test(sql), "withdraw RPC is idempotent");
check(/crm_kpi_write_audit[\s\S]*event_withdraw/i.test(sql), "withdraw RPC writes bounded audit metadata");
check(!/delete\s+from\s+public\.(kpi_submission_events|kpi_evidence)/i.test(sql), "withdraw migration never deletes Event or Evidence rows");
check(/WITHDRAWN/i.test(team) && /Đã thu hồi/.test(team), "withdrawn status is visible in shared event renderer");
check(/data-kpi2-withdraw-event/i.test(team) && /withdrawAction/i.test(team), "Sale card exposes a scoped withdraw action");
check(/\["withdrawn","Đã thu hồi"\]/i.test(app), "Sale history exposes withdrawn filter");
check(/crm_kpi_withdraw_event/i.test(app) && /crypto\.randomUUID\(\)/i.test(app), "Sale UI calls canonical withdraw RPC with request id");
check(/input===null|prompt\(/i.test(app) && /Lý do thu hồi/i.test(app), "Sale UI requires explicit withdraw reason");
check(/data-kpi2-withdraw-event[\s\S]*runAction/i.test(app), "withdraw click is guarded by busy-action handling");

console.log(`KPI-2 Sale withdraw static contract: PASS (${checks} checks)`);
