import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import {execFileSync} from "node:child_process";

const read=path=>fs.readFileSync(path,"utf8");
const sha256=path=>crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
const manifestPath="docs/catalog-integration-runbook/releases/catalog-production-release-12a.json";
const planPath="docs/catalog-integration-runbook/releases/12A-PRODUCTION-RELEASE-PLAN.md";
const preflightPath="scripts/catalog-production-preflight-12a.sql";
const manifest=JSON.parse(read(manifestPath));
const plan=read(planPath);
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks+=1;};

check(manifest.schemaVersion===1,"manifest schema version");
check(manifest.branch==="feat/catalog-supabase-integration","release branch pinned");
check(manifest.git.applicationCommit==="a7f00692d7c66def1e7eff94b5ed6536872d0272","application commit pinned");
check(manifest.targets.supabase.productionRef==="jjeeazwlqcwynzquimeo","production Supabase ref pinned");
check(manifest.targets.supabase.stagingRef==="nalkeptqohjbjnqwpzzv","staging Supabase ref pinned");
check(manifest.targets.supabase.productionRef!==manifest.targets.supabase.stagingRef,"staging differs from production");
check(manifest.targets.vercel.projectName==="crm_kolor","Vercel project pinned");
check(manifest.targets.vercel.projectId==="prj_BNeqeHfdUbfR1uaZFyzeuxhzcBRw","Vercel project id pinned");
check(manifest.targets.vercel.canonicalUrl==="https://crmkolor.vercel.app/","Vercel canonical URL pinned");
check(manifest.targets.firebase.projectId==="kolor-ceramics","Firebase project pinned");
check(manifest.targets.firebase.site==="kolor-ceramics","Firebase site pinned");
check(manifest.targets.firebase.redirectDestination===manifest.targets.vercel.canonicalUrl,"Firebase destination is canonical Vercel URL");

execFileSync("git",["cat-file","-e",`${manifest.git.mergeBase}^{commit}`],{stdio:"ignore"});
execFileSync("git",["cat-file","-e",`${manifest.git.applicationCommit}^{commit}`],{stdio:"ignore"});
checks+=2;

const project=JSON.parse(read(".vercel/project.json"));
check(project.projectId===manifest.targets.vercel.projectId,"local Vercel project id matches manifest");
check(project.orgId===manifest.targets.vercel.orgId,"local Vercel org id matches manifest");
check(project.projectName===manifest.targets.vercel.projectName,"local Vercel project name matches manifest");

const firebaseRc=JSON.parse(read("firebase-legacy-redirect/.firebaserc"));
const firebaseConfig=JSON.parse(read("firebase-legacy-redirect/firebase.json"));
const hosting=Array.isArray(firebaseConfig.hosting)?firebaseConfig.hosting[0]:firebaseConfig.hosting;
check(firebaseRc.projects?.default===manifest.targets.firebase.projectId,"Firebase rc matches manifest");
check(hosting.site===manifest.targets.firebase.site,"Firebase Hosting site matches manifest");
check(hosting.redirects?.length===1,"Firebase package has one redirect");
check(hosting.redirects[0].destination===manifest.targets.firebase.redirectDestination,"Firebase redirect destination matches manifest");
check(hosting.redirects[0].type===301,"Firebase redirect is permanent");

const vercel=JSON.parse(read("vercel.json"));
const rewriteMap=Object.fromEntries(vercel.rewrites.map(item=>[item.source,item.destination]));
check(rewriteMap["/"]==="/website/index","public route rewrite");
check(rewriteMap["/admin"]==="/admin/index","admin route rewrite");
check(rewriteMap["/crm"]==="/index","CRM route rewrite");
check(vercel.redirects.some(item=>item.source==="/CRM"&&item.destination==="/crm"),"legacy CRM redirect");

for(const artifact of manifest.runtimeArtifacts){
  check(fs.existsSync(artifact.path),`runtime artifact exists: ${artifact.path}`);
  check(sha256(artifact.path)===artifact.sha256,`runtime artifact checksum: ${artifact.path}`);
}

const expectedApply=[
  "supabase-phase-catalog-integration-01b-additive.sql",
  "supabase-phase-catalog-integration-02b-rls-rpc.sql",
  "supabase-phase-catalog-integration-03b-approval-audit.sql",
  "supabase-phase-catalog-integration-05a-public-api-v1.sql",
  "supabase-phase-catalog-integration-05b-website-leads.sql",
  "supabase-phase-catalog-integration-06a-admin-catalog.sql",
  "supabase-phase-catalog-integration-06b-admin-import.sql",
  "supabase-phase-catalog-integration-06b-classification-compat.sql",
  "supabase-phase-catalog-integration-06b-review-alias-fix.sql"
];
assert.deepEqual(manifest.database.apply.map(item=>item.path),expectedApply,"exact production migration order");
checks+=1;
for(const migration of manifest.database.apply){
  const sql=read(migration.path);
  check(sha256(migration.path)===migration.sha256,`migration checksum: ${migration.path}`);
  check((sql.match(/^begin;\s*$/gim)||[]).length===1,`one transaction begin: ${migration.path}`);
  check((sql.match(/^commit;\s*$/gim)||[]).length===1,`one transaction commit: ${migration.path}`);
  check(!/jjeeazwlqcwynzquimeo|nalkeptqohjbjnqwpzzv/i.test(sql),`migration has no hard-coded project ref: ${migration.path}`);
  check(!/staging_test|rollback_test|catalog_staging_e2e|catalog_baseline_75|catalog_dry_run/i.test(migration.path),`migration is not a staging/test artifact: ${migration.path}`);
}

assert.deepEqual(manifest.database.rollback.map(item=>item.phase),["06B","06A","05B","05A","03B","02B","01B"],"rollback order is reverse dependency order");
checks+=1;
for(const rollback of manifest.database.rollback){
  check(fs.existsSync(rollback.path),`rollback exists: ${rollback.path}`);
  check(sha256(rollback.path)===rollback.sha256,`rollback checksum: ${rollback.path}`);
}
check(manifest.database.excludedFromProduction.some(path=>path.includes("staging_bootstrap")),"staging bootstrap explicitly excluded");
check(manifest.database.excludedFromProduction.some(path=>path.includes("catalog_staging_e2e_11a")),"11A E2E migration explicitly excluded");

const preflight=read(preflightPath);
check(/begin transaction read only;/i.test(preflight),"preflight begins read-only transaction");
check(/^rollback;\s*$/im.test(preflight),"preflight rolls back");
const executableLines=preflight.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith("--"));
check(!executableLines.some(line=>/^(insert|update|delete|alter|create|drop|truncate|grant|revoke|notify|copy)\b/i.test(line)),"preflight has no mutation statement");

for(const phrase of manifest.requiredProductionConfirmations){
  check(plan.includes(phrase),`plan contains confirmation: ${phrase}`);
}
for(const section of ["Fresh backup checklist","Production import dry-run and approval stop","Rollback matrix","Maintenance window","GO / NO-GO checklist","Prompt 12B stop points"]){
  check(plan.includes(section),`plan section exists: ${section}`);
}
check(plan.includes("Do not use `supabase db push`"),"plan forbids broad production db push");
check(plan.includes("do not relink this checkout"),"plan forbids production relink");
check(plan.includes("359 unapproved reconciliation candidates"),"plan excludes unapproved candidates");
check(plan.includes("Firebase is last"),"deployment ordering protects legacy QR redirect");

const releaseText=read(manifestPath)+plan;
check(!/postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/i.test(releaseText),"release package contains no database credential URL");
check(!/service[_-]?role\s*[=:]\s*["'][^"']+/i.test(releaseText),"release package contains no service-role credential");
check(!/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/.test(releaseText),"release package contains no JWT literal");

console.log(`PASS: Prompt 12A production release package (${checks} checks).`);
