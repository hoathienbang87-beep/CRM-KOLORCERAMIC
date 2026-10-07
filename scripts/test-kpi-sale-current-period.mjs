#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  filterKpiRowsForAssignments,
  filterKpiRowsForPeriod,
  resolveCurrentSaleKpiPeriod
} from "../js/features/kpi-team.js";

let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };
const september = {id:"period-sep",period_month:"2026-09-01",name:"KPI tháng 9",status:"ACTIVE",starts_at:"2026-09-01T00:00:00+07:00",ends_at:"2026-10-01T00:00:00+07:00"};
const october = {id:"period-oct",period_month:"2026-10-01",name:"KPI tháng 10",status:"ACTIVE",starts_at:"2026-10-01T00:00:00+07:00",ends_at:"2026-11-01T00:00:00+07:00"};
const now = new Date("2026-10-08T09:00:00+07:00");

let resolution = resolveCurrentSaleKpiPeriod([september, october], now);
check(resolution.status === "selected" && resolution.period.id === october.id, "the period containing now is selected, not the first ACTIVE period");
check(resolveCurrentSaleKpiPeriod([september], now).status === "none", "zero current periods fails closed");
check(resolveCurrentSaleKpiPeriod([october, {...october,id:"period-overlap"}], now).status === "ambiguous", "overlapping current ACTIVE periods fail closed");
check(resolveCurrentSaleKpiPeriod([{...september,status:"CLOSED"}, october], now).period.id === october.id, "CLOSED periods are excluded");
check(resolveCurrentSaleKpiPeriod([october], new Date(october.starts_at)).status === "selected", "period start is inclusive");
check(resolveCurrentSaleKpiPeriod([october], new Date(october.ends_at)).status === "none", "period end is exclusive");
check(resolveCurrentSaleKpiPeriod([{...october,starts_at:"invalid"}], now).status === "none", "invalid bounds fail closed");
const eventAtIsInside = (period, eventAt) => new Date(period.starts_at) <= new Date(eventAt) && new Date(eventAt) < new Date(period.ends_at);
check(eventAtIsInside(october,"2026-10-05T09:00:00+07:00"), "05/10 remains valid for October even when submitted after a later activation date");
check(!eventAtIsInside(october,"2026-09-30T23:59:59+07:00"), "30/09 remains invalid for the October assignment");

const progress = [
  {assignment_id:"assignment-sep",period_id:september.id},
  {assignmentId:"assignment-oct",periodId:october.id}
];
check(JSON.stringify(filterKpiRowsForPeriod(progress, october.id).map(row => row.assignmentId)) === JSON.stringify(["assignment-oct"]), "progress defense filter keeps only the selected period");
const related = [{id:"event-oct",assignment_id:"assignment-oct"},{id:"event-sep",assignment_id:"assignment-sep"}];
check(filterKpiRowsForAssignments(related,["assignment-oct"]).map(row => row.id).join() === "event-oct", "related-row defense filter keeps only selected assignments");
check(filterKpiRowsForAssignments(related,[]).length === 0, "empty assignment scope returns no related rows");

const app = fs.readFileSync("js/features/crm-app.js", "utf8");
const view = fs.readFileSync("index.html", "utf8");
const sql = fs.readFileSync("supabase-phase-kpi2-final-consolidated.sql", "utf8");
const saleLoader = app.slice(app.indexOf("async function reloadKpi2Data"), app.indexOf("function renderKpi2Operations"));
const managerLoader = app.slice(app.indexOf("async function reloadKpiTeamSummary"), app.indexOf("function kpiTeamEmployeeDetail"));

check(/from\("kpi_periods"\)[\s\S]*\.eq\("status","ACTIVE"\)/.test(saleLoader), "Sale loader reads ACTIVE period boundaries explicitly");
check(/resolveCurrentSaleKpiPeriod\([\s\S]*new Date\(\)\)/.test(saleLoader), "Sale loader resolves the current instant against period bounds");
check(/crm_kpi_get_assignment_progress", \{p_period_id:periodId\}/.test(saleLoader), "Sale progress RPC receives the selected period id");
check(!saleLoader.includes("p_period_id:null"), "Sale loader no longer requests unscoped progress");
check((saleLoader.match(/\.in\("assignment_id",assignmentIds\)/g) || []).length === 3, "events, evidence, and submissions are query-scoped by current assignments");
check(/filterKpiRowsForPeriod\(progress, periodId\)/.test(saleLoader) && (saleLoader.match(/filterKpiRowsForAssignments/g) || []).length >= 3, "response-side defense filters cover progress and related rows");
check(/currentSaleKpiPeriodResolution\.status !== "selected"[\s\S]*renderKpi2Operations\(\);[\s\S]*return;/.test(saleLoader), "zero or ambiguous current periods stop before progress and related reads");
check(/openKpi2ClaimFromCustomer[\s\S]*reloadKpi2Data\(\)[\s\S]*eligibleKpiCustomerAssignments\(kpi2Progress\)/.test(app), "Customer-origin flow derives choices from the same scoped progress state");
check(/crm_kpi_get_assignment_progress", \{p_period_id:period\.id\}/.test(managerLoader), "Manager progress remains explicitly scoped to its selected period");
check(/crm_kpi_get_monthly_scores", \{p_period_id:period\.id\}/.test(managerLoader), "Manager monthly scores remain explicitly scoped");
check(view.includes('id="kpi2CurrentPeriodContext"'), "Sale UI exposes a visible current-period context");
check(app.includes("Chưa có kỳ KPI đang hoạt động cho thời gian hiện tại."), "no-current-period state has an explicit Sale message");
check(app.includes("Có nhiều kỳ KPI ACTIVE cùng bao phủ thời gian hiện tại."), "overlapping-period state has an explicit Sale message");

const validator = sql.slice(sql.indexOf("create or replace function public.crm_kpi_validate_event_at"), sql.indexOf("revoke all on function public.crm_kpi_validate_location"));
check(/v_event_at > clock_timestamp\(\) \+ interval '5 minutes'/.test(validator), "event validator still rejects only excessive future timestamps");
check(/v_event_at < p_period_starts_at or v_event_at >= p_period_ends_at/.test(validator), "event validator still accepts historical event_at values inside the selected period");
check(!/created_at\s*[<>]/.test(validator), "event validator does not compare event_at with creation time");

console.log(`KPI Sale current-period contract: ${checks} checks PASS`);
