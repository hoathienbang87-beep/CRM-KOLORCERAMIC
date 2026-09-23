import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const forwardPath = path.join(root, "supabase-phase-catalog-integration-01b-additive.sql");
const rollbackPath = path.join(root, "supabase-phase-catalog-integration-01b-rollback.sql");
const contractPath = path.join(root, "docs", "catalog-integration-runbook", "PRODUCT_DATA_CONTRACT.md");
const statusPath = path.join(root, "docs", "catalog-integration-runbook", "STATUS.md");

const forward = fs.readFileSync(forwardPath, "utf8");
const rollback = fs.readFileSync(rollbackPath, "utf8");
const contract = fs.readFileSync(contractPath, "utf8");
const status = fs.readFileSync(statusPath, "utf8");

let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function matches(sql, pattern, message) {
  check(pattern.test(sql), message);
}

function validateLexicalSql(sql, label, allowDollar = true) {
  let i = 0;
  let parens = 0;
  let blockDepth = 0;
  const dollarBodies = [];

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === "-" && next === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      blockDepth = 1;
      i += 2;
      while (i < sql.length && blockDepth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          blockDepth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          blockDepth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      assert.equal(blockDepth, 0, `${label}: unterminated block comment`);
      continue;
    }

    if (c === "'") {
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i += 1;
          closed = true;
          break;
        } else {
          i += 1;
        }
      }
      assert.ok(closed, `${label}: unterminated single-quoted string`);
      continue;
    }

    if (c === '"') {
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
        } else if (sql[i] === '"') {
          i += 1;
          closed = true;
          break;
        } else {
          i += 1;
        }
      }
      assert.ok(closed, `${label}: unterminated double-quoted identifier`);
      continue;
    }

    if (allowDollar && c === "$") {
      const opener = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (opener) {
        const bodyStart = i + opener.length;
        const bodyEnd = sql.indexOf(opener, bodyStart);
        assert.ok(bodyEnd >= 0, `${label}: unterminated dollar quote ${opener}`);
        dollarBodies.push(sql.slice(bodyStart, bodyEnd));
        i = bodyEnd + opener.length;
        continue;
      }
    }

    if (c === "(") parens += 1;
    if (c === ")") parens -= 1;
    assert.ok(parens >= 0, `${label}: unexpected closing parenthesis near offset ${i}`);
    i += 1;
  }

  assert.equal(parens, 0, `${label}: unbalanced parentheses`);
  for (const [index, body] of dollarBodies.entries()) {
    validateLexicalSql(body, `${label} dollar body ${index + 1}`, false);
  }
}

function withoutCommentsAndLiterals(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/'(?:''|[^'])*'/g, " ")
    .replace(/"(?:""|[^"])*"/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

validateLexicalSql(forward, "forward migration");
validateLexicalSql(rollback, "rollback migration");
check(true, "forward migration passed lexical SQL structure checks");
check(true, "rollback migration passed lexical SQL structure checks");

const forwardSql = withoutCommentsAndLiterals(forward).toLowerCase();
const rollbackSql = withoutCommentsAndLiterals(rollback).toLowerCase();

matches(forwardSql, /^begin\s*;/, "forward migration must begin a transaction");
matches(forwardSql, /commit\s*;$/, "forward migration must commit explicitly");
matches(rollbackSql, /^begin\s*;/, "rollback must begin a transaction");
matches(rollbackSql, /commit\s*;$/, "rollback must commit explicitly");
matches(forwardSql, /pg_advisory_xact_lock/, "forward migration must take a transaction advisory lock");
matches(rollbackSql, /pg_advisory_xact_lock/, "rollback must take the same advisory lock");

for (const forbidden of [
  /\bdrop\s+table\b/,
  /\bdrop\s+column\b/,
  /\btruncate\b/,
  /\bdelete\s+from\b/,
  /\balter\s+table\b[^;]*\balter\s+column\b[^;]*\btype\b/,
  /\bupdate\s+public\.(quote_items|product_import_batches|product_import_rows|product_price_history)\b/,
  /\binsert\s+into\s+public\.(products|quote_items|product_import_batches|product_import_rows|product_price_history)\b/
]) {
  check(!forbidden.test(forwardSql), `forward migration contains forbidden destructive/business-data SQL: ${forbidden}`);
}

matches(
  forwardSql,
  /alter\s+table\s+public\.products[\s\S]*alter\s+column\s+code\s+drop\s+not\s+null[\s\S]*alter\s+column\s+price_effective_date\s+drop\s+not\s+null/,
  "only the contract-approved Product NOT NULL constraints must be relaxed"
);

for (const column of [
  "name_normalized", "width_mm", "height_mm", "surface_normalized", "color",
  "category", "collection", "description", "image_url", "gallery_urls", "pdf_url",
  "video_url", "more_info_url", "price_unit", "data_status", "is_published", "source_metadata"
]) {
  matches(forwardSql, new RegExp(`add\\s+column\\s+${column}\\b`), `missing Product catalog column ${column}`);
}

for (const table of ["product_source_mappings", "website_leads"]) {
  matches(forwardSql, new RegExp(`create\\s+table\\s+public\\.${table}\\b`), `missing new table ${table}`);
  matches(forwardSql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`), `${table} must enable RLS`);
}

for (const table of ["product_import_batches", "product_import_rows", "product_price_history", "quote_items"]) {
  matches(forwardSql, new RegExp(`alter\\s+table\\s+public\\.${table}\\b`), `${table} must be extended additively`);
  check(!new RegExp(`create\\s+table\\s+public\\.${table}\\b`).test(forwardSql), `${table} must not be recreated`);
}

const extensionColumns = {
  product_import_batches: [
    "import_mode", "source_format", "source_metadata", "rollback_of_batch_id",
    "rollback_idempotency_key", "rolled_back_at", "rolled_back_by_user_id"
  ],
  product_import_rows: [
    "source_sheet", "source_cell_ref", "source_record_id", "width_mm", "height_mm",
    "surface_normalized", "disposition", "match_rule", "conflict_code",
    "previous_snapshot", "proposed_snapshot", "rollback_snapshot"
  ],
  product_price_history: [
    "previous_price_per_m2", "source_format", "change_kind", "rollback_of_history_id",
    "product_version_before", "product_version_after", "change_metadata"
  ],
  quote_items: [
    "width_mm_snapshot", "height_mm_snapshot", "surface_snapshot", "list_price_snapshot"
  ]
};

for (const [table, columns] of Object.entries(extensionColumns)) {
  const tableBlock = forwardSql.match(new RegExp(`alter\\s+table\\s+public\\.${table}([\\s\\S]*?);`))?.[1] ?? "";
  for (const column of columns) {
    matches(tableBlock, new RegExp(`add\\s+column\\s+${column}\\b`), `missing ${table}.${column}`);
    matches(rollbackSql, new RegExp(`drop\\s+column\\s+${column}\\b`), `rollback must remove ${table}.${column}`);
  }
}

for (const required of [
  "products_catalog_public_idx",
  "products_catalog_variant_lookup_idx",
  "product_source_mappings_source_key",
  "product_import_batches_import_mode_check",
  "product_import_rows_disposition_check",
  "product_price_history_previous_price_check",
  "quote_items_dimension_snapshot_pair_check",
  "website_leads_contact_method_check"
]) {
  check(forward.includes(required), `missing index/constraint ${required}`);
}

matches(forwardSql, /update\s+public\.products\s+set\s+width_mm\s*=\s*\(width_cm\s*\*\s*10\)::integer/, "missing exact cm-to-mm Product backfill");
matches(forwardSql, /crm_catalog_sync_dimensions_01b/, "missing cm/mm compatibility trigger");
matches(forwardSql, /products_ready_completeness_check/, "missing READY/UPDATING completeness constraint");
matches(forwardSql, /products_publish_gate_check/, "missing active/ready publication constraint");
matches(forwardSql, /crm_catalog_https_url_array_01b/, "missing HTTPS gallery validator");
matches(forwardSql, /catalog_01b_products_guard/, "missing Product value guard");
matches(forwardSql, /catalog_01b_history_guard/, "missing price-history value guard");
matches(forward.toLowerCase(), /has_table_privilege\s*\(/, "missing privilege verification");
matches(forwardSql, /revoke\s+all\s+on\s+public\.product_source_mappings\s*,\s*public\.website_leads\s+from\s+public\s*,\s*anon\s*,\s*authenticated/, "new internal tables must be private");
check(!/\bgrant\b[^;]*\banon\b/.test(forwardSql), "forward migration must not grant anything to anon");
check(!forward.includes("jjeeazwlqcwynzquimeo"), "migration must not target the production project ref");
check(!/eyJ[A-Za-z0-9_-]{20,}|service[_-]?role\s*[=:]/i.test(forward + rollback), "SQL files must not contain JWT/service-role secrets");

matches(rollback.toLowerCase(), /catalog_01b_rollback_blocked/, "rollback must contain fail-closed data-loss guards");
matches(rollback.toLowerCase(), /catalog_01b_rollback_verify_fail/, "rollback must verify restored rows and schema");
matches(rollbackSql, /drop\s+table\s+public\.website_leads/, "rollback must remove website_leads");
matches(rollbackSql, /drop\s+table\s+public\.product_source_mappings/, "rollback must remove source mappings");
matches(
  rollbackSql,
  /drop\s+constraint\s+products_price_effective_pair_check/,
  "rollback must remove the 01B constraint that only references baseline columns"
);
check(!/\bcascade\b/.test(rollbackSql), "rollback must not use CASCADE");

for (const phrase of [
  "Không drop table/cột và không truncate/delete dữ liệu",
  "Mọi field mới nullable hoặc có default an toàn",
  "Public/anon không có direct table read/write",
  "Source ID `SP-*` có uniqueness",
  "Schema migration không import 406 Firebase"
]) {
  check(contract.includes(phrase), `approved contract gate is missing: ${phrase}`);
}

check(status.includes("| 01A | Data contract sản phẩm | Không | APPROVED |"), "01A dependency must be APPROVED");
check(
  /\| 01B \| Migration SQL additive \| 01A \| (IN_PROGRESS|PASS_PENDING_APPROVAL|APPROVED) \|/.test(status),
  "01B must be active, pending approval or approved"
);

console.log(`PASS: Catalog migration 01B static checks (${checks} checks).`);
