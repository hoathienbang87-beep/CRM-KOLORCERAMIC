#!/usr/bin/env node
// KPI 7D — Sale period history selector: static / unit contract.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  resolveCurrentSaleKpiPeriod,
  resolveSaleKpiViewPeriodId,
  saleKpiPeriodLabel,
  saleKpiPeriodOptions,
  saleKpiViewIsWritable,
  managerKpiEventCardHtml,
  managerKpiEventViewModel
} from "../js/features/kpi-team.js";

let checks = 0;
const ok = (cond, message) => { checks += 1; assert.ok(cond, message); };
const eq = (a, b, message) => { checks += 1; assert.deepEqual(a, b, message); };

const sep = {id: "p-sep", period_month: "2026-09-01", name: "KPI tháng 9/2026", status: "CLOSED", starts_at: "2026-09-01T00:00:00+07:00", ends_at: "2026-10-01T00:00:00+07:00"};
const oct = {id: "p-oct", period_month: "2026-10-01", name: "KPI Tháng 10", status: "ACTIVE", starts_at: "2026-10-01T00:00:00+07:00", ends_at: "2026-11-01T00:00:00+07:00"};
const nov = {id: "p-nov", period_month: "2026-11-01", name: "Nháp", status: "DRAFT"};
const aug = {id: "p-aug", period_month: "2026-08-01", name: "Hủy", status: "CANCELLED"};
const now = new Date("2026-10-10T09:00:00+07:00");

// options: status policy, order, labels
const opts = saleKpiPeriodOptions([sep, nov, aug, oct, {...sep}]);
eq(opts.map(o => o.id), ["p-oct", "p-sep"], "only ACTIVE/CLOSED, deduplicated, newest period_month first");
eq(opts.map(o => o.label), ["10/2026 · Đang hoạt động", "09/2026 · Đã đóng"], "Sale-facing labels");
eq(saleKpiPeriodLabel({period_month: "2026-10-01", name: "Thi đua quý 4", status: "ACTIVE"}), "10/2026 · Thi đua quý 4 · Đang hoạt động", "custom name kept");
ok(saleKpiPeriodLabel({period_month: "2026-10-01", name: "Một tên rất rất dài cho kỳ KPI đặc biệt", status: "ACTIVE"}).includes("…"), "long names truncated");
eq(saleKpiPeriodOptions([{...oct, created_at: "2026-01-01"}, {...sep, created_at: "2026-12-31"}]).map(o => o.id), ["p-oct", "p-sep"], "order ignores created_at / row order");

// default view period and write gate
const selected = resolveCurrentSaleKpiPeriod([oct], now);
eq(resolveSaleKpiViewPeriodId({resolution: selected, options: opts}), "p-oct", "default = current operational period");
eq(resolveSaleKpiViewPeriodId({resolution: selected, options: opts, previousId: "p-sep"}), "p-sep", "in-session selection kept across in-app reloads");
eq(resolveSaleKpiViewPeriodId({resolution: selected, options: opts, previousId: "p-gone"}), "p-oct", "unknown previous selection falls back to current");
eq(resolveSaleKpiViewPeriodId({resolution: {status: "none", period: null}, options: opts}), "p-sep", "no current ACTIVE → newest CLOSED history");
const overlap = resolveCurrentSaleKpiPeriod([oct, {...oct, id: "p-oct2", period_month: "2026-12-01"}], now);
eq(overlap.status, "ambiguous", "7T overlap still ambiguous");
eq(resolveSaleKpiViewPeriodId({resolution: overlap, options: saleKpiPeriodOptions([oct, {...oct, id: "p-oct2", period_month: "2026-12-01"}, sep])}), "p-sep", "overlap → never first ACTIVE row; newest CLOSED history instead");
eq(resolveSaleKpiViewPeriodId({resolution: {status: "none"}, options: []}), "", "no history → nothing selected");
ok(saleKpiViewIsWritable({resolution: selected, currentPeriod: oct, viewPeriodId: "p-oct"}), "current ACTIVE view is writable");
ok(!saleKpiViewIsWritable({resolution: selected, currentPeriod: oct, viewPeriodId: "p-sep"}), "historical view is never writable");
ok(!saleKpiViewIsWritable({resolution: overlap, currentPeriod: null, viewPeriodId: "p-oct"}), "ambiguous current → not writable");
ok(!saleKpiViewIsWritable({resolution: {status: "selected", period: {...oct, status: "CLOSED"}}, currentPeriod: {...oct, status: "CLOSED"}, viewPeriodId: "p-oct"}), "CLOSED current → not writable");

// history card: PERIOD_CLOSED label, no withdraw when read-only
const card = managerKpiEventCardHtml(managerKpiEventViewModel({event: {id: "e1", status: "REJECTED", review_reason_code: "PERIOD_CLOSED", reviewed_at: "2026-10-08T08:55:03Z"}}), {customerAction: false, withdrawAction: false});
ok(card.includes("Từ chối tự động do kỳ KPI đã được đóng") && !card.includes("PERIOD_CLOSED"), "PERIOD_CLOSED label in Sale history card");
ok(!managerKpiEventCardHtml(managerKpiEventViewModel({event: {id: "e2", status: "PENDING", lock_version: 1}}), {withdrawAction: false}).includes("data-kpi2-withdraw-event"), "read-only history has no withdraw control");

// source contract
const app = fs.readFileSync("js/features/crm-app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
ok(html.includes('id="kpi2PeriodSelect"') && html.includes('id="kpi2PeriodViewNote"') && html.includes('id="kpi2CurrentPeriodContext"'), "selector + banner markup; current-period context kept");
const loader = app.slice(app.indexOf("async function loadSaleKpiPeriodOptions"), app.indexOf("async function withdrawKpi2Event"));
ok(/\.in\("status", \["ACTIVE", "CLOSED"\]\)/.test(loader) && /\.order\("period_month", \{ascending:false\}\)/.test(loader), "options query: ACTIVE/CLOSED, period_month DESC (RLS limits to own periods)");
ok(/if \(!isSale\(\)\) \{ saleKpiPeriodOptionList = \[\]; return; \}/.test(loader), "options only loaded for Sale");
ok(/crm_kpi_get_assignment_progress", \{p_period_id:scope\}/.test(loader) && !loader.includes("p_period_id:null"), "history progress uses explicit period id, never null");
ok(/filterKpiRowsForPeriod\(progress, scope\)/.test(loader) && (loader.match(/filterKpiRowsForAssignments\(/g) || []).length >= 3, "history response defense-filtered by period and assignments");
ok((loader.match(/\.in\("assignment_id",historyIds\)/g) || []).length === 3, "history events/evidence/submissions scoped by selected-period assignment ids");
ok(/\.eq\("status","ATTACHED"\)/.test(loader), "historical evidence: attached only (no staging)");
ok(!/localStorage|sessionStorage|document\.cookie|history\.pushState|location\.hash\s*=/.test(loader), "historical selection never persisted");
ok(!/currentSaleKpiPeriod\s*=|kpi2Progress\s*=|kpi2Events\s*=|kpi2Evidence\s*=|kpi2Submissions\s*=/.test(loader), "history code never assigns operational/current state");
const customer = app.slice(app.indexOf("async function openKpi2ClaimFromCustomer"), app.indexOf("async function runKpi2CustomerSearch"));
ok(/eligibleKpiCustomerAssignments\(kpi2Progress\)/.test(customer) && !/saleKpiHistoryView|selectedSaleKpiPeriodId/.test(customer), "Customer-origin uses current operational progress only");
const form = app.slice(app.indexOf("async function openKpi2EventForm"), app.indexOf("async function openKpi2Claim("));
ok(!/saleKpiHistoryView|selectedSaleKpiPeriodId/.test(form) && /clean\(currentSaleKpiPeriod\?\.id\)/.test(form), "proposal form validates against currentSaleKpiPeriod, ignores view state");
const render = app.slice(app.indexOf("function renderKpi2Operations"), app.indexOf("function renderKpi2SaleHistory"));
ok(/const canSubmit=display\.writable&&/.test(render), "proposal buttons gated by writable view");
ok(/withdrawAction:display\.writable/.test(app), "withdraw gated by writable view");
ok(/const writable|saleKpiViewIsWritable\(\{resolution:currentSaleKpiPeriodResolution, currentPeriod:currentSaleKpiPeriod, viewPeriodId:currentId\}\)/.test(app), "writable only for the current operational period");
ok(/saleKpiPeriodOptionList = \[\];\s*\n?\s*selectedSaleKpiPeriodId = "";\s*\n?\s*saleKpiHistoryView = null;/.test(app.replace(/\r/g, "")), "view state cleared on session reset");
ok(/on\("kpi2PeriodSelect", "change"/.test(app), "selector change handler bound");

console.log(`KPI 7D Sale period history static contract: PASS (${checks} checks)`);
