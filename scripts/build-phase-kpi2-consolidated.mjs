import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8").replace(/\r\n/g, "\n");

function withoutTransaction(sql) {
  return sql
    .replace(/^\s*begin;\s*$/im, "")
    .replace(/^\s*commit;\s*$/im, "")
    .trim();
}

function removeFunction(sql, name) {
  const marker = `create or replace function public.${name}`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = sql.indexOf("$$;", start);
  if (end < 0) throw new Error(`Missing function terminator for ${name}`);
  return sql.slice(0, start) + sql.slice(end + 3);
}

function removePrivilegeStatements(sql, names) {
  const blocked = new Set(names.map(name => `public.${name}`.toLowerCase()));
  return sql.replace(/^(?:revoke|grant)\b[\s\S]*?;\s*$/gim, statement => {
    const lower = statement.toLowerCase();
    return [...blocked].some(name => lower.includes(name)) ? "" : statement;
  });
}

const replacedMainFunctions = [
  "crm_kpi_update_assignment_options",
  "crm_kpi_source_snapshot",
  "crm_kpi_list_hybrid_candidates",
  "crm_kpi_submit_events",
  "crm_kpi_submit_revision",
  "crm_kpi_review_events",
  "crm_kpi_get_assignment_progress",
  "crm_kpi_get_monthly_scores"
];

let main = withoutTransaction(read("supabase-phase-kpi2-submission-review-evidence.sql"));
for (const name of replacedMainFunctions) main = removeFunction(main, name);
main = removePrivilegeStatements(main, replacedMainFunctions);
main = main.replace(
  "add column if not exists score_enabled boolean not null default true;",
  "add column if not exists score_enabled boolean not null default false;"
);
main = main.replace(
  "  response jsonb not null default '{}'::jsonb,\n  created_at timestamptz not null default now(),",
  "  request_payload_hash text not null,\n  request_schema_version integer not null default 1,\n  response jsonb not null default '{}'::jsonb,\n  created_at timestamptz not null default now(),"
);
main = main.replace(
  "  constraint kpi_action_requests_action_check check (nullif(btrim(action), '') is not null),",
  () => "  constraint kpi_action_requests_action_check check (nullif(btrim(action), '') is not null),\n  constraint kpi_action_requests_payload_hash_check check (request_payload_hash ~ '^[a-f0-9]{64}$'),\n  constraint kpi_action_requests_schema_version_check check (request_schema_version >= 1),"
);

const reconcile2 = withoutTransaction(read("supabase-phase-kpi2-reconcile-2.sql"));
const reconcile3 = withoutTransaction(read("supabase-phase-kpi2-reconcile-3.sql"));
const reconcile4 = withoutTransaction(read("supabase-phase-kpi2-reconcile-4.sql"));

let remediation = withoutTransaction(read("supabase-phase-kpi2-remediation.sql"));
const b1AlterStart = remediation.indexOf("alter table public.kpi_action_requests");
const b1FunctionStart = remediation.indexOf("create or replace function public.crm_kpi_payload_hash");
if (b1AlterStart < 0 || b1FunctionStart < 0 || b1FunctionStart <= b1AlterStart) {
  throw new Error("Cannot isolate the staging-only action request upgrade block.");
}
remediation = remediation.slice(0, b1AlterStart) + remediation.slice(b1FunctionStart);
remediation = remediation.replace(
  /\n?alter table public\.kpi_assignments alter column score_enabled set default false;\n?/i,
  "\n"
);
remediation = remediation.replace(
  /^(?:-- (?:STAGING DEVELOPMENT|Production source|KPI-2R staging|DEVELOPMENT CHAIN|Dependencies:).*(?:\n|$))+/i,
  ""
);

const output = `-- KPI-2 final consolidated production artifact.\n-- Dependency: KPI-1 production baseline.\n-- Contains final KPI-2 state plus KPI-2R B1-B6 remediation.\n-- Do not run the five superseded staging-development migrations with this file.\n\nbegin;\n\n${main}\n\n${reconcile2}\n\n${reconcile3}\n\n${reconcile4}\n\n${remediation}\n\ncommit;\n`;

const unresolved = replacedMainFunctions.filter(name => {
  const count = [...output.toLowerCase().matchAll(new RegExp(`create or replace function public\\.${name}\\b`, "g"))].length;
  return count !== 1;
});
if (unresolved.length) throw new Error(`Final function definition count is not one: ${unresolved.join(", ")}`);
if ((output.match(/^begin;$/gim) || []).length !== 1 || (output.match(/^commit;$/gim) || []).length !== 1) {
  throw new Error("Consolidated migration must contain exactly one transaction.");
}

fs.writeFileSync(path.join(root, "supabase-phase-kpi2-final-consolidated.sql"), output, "utf8");
console.log("Built supabase-phase-kpi2-final-consolidated.sql");
