#!/usr/bin/env bash
# =====================================================================
# EMPLOYEE-ONBOARDING-R1-PROD — mô phỏng TOÀN BỘ thứ tự rollout trên
# PostgreSQL cục bộ, đúng thứ tự bắt buộc ở mục 1 của phase.
#
#   0. dựng baseline production (trạng thái FAIL-OPEN hiện tại)
#   1. CHỨNG MINH: onboarding migration TỪ CHỐI cài khi chưa có R1-0
#   2. áp hotfix R1-0
#   3. áp onboarding migration
#   4. integration matrix onboarding (44 test)
#   5. security regression sau khi rollout đầy đủ (mục 45)
#
# Không kết nối tới production. Chỉ chạy trên Postgres cục bộ.
# =====================================================================
set -uo pipefail
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U ${PGUSER:-postgres} -q"
FAIL=0

step() { printf '\n=== %s ===\n' "$1"; }

step "0. Dựng baseline production (fail-open)"
$PSQL -c "drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;" >/dev/null 2>&1
$PSQL -v ON_ERROR_STOP=1 -f harness-prod-baseline.sql >/dev/null 2>&1 \
  && echo "OK: baseline dựng xong" || { echo "FAIL: không dựng được baseline"; exit 1; }

step "1. Onboarding migration phải TỪ CHỐI khi chưa có R1-0"
OUT=$($PSQL -v ON_ERROR_STOP=1 -f supabase-phase-employee-onboarding-r1-prod.sql 2>&1)
if grep -q "PRECONDITION_FAIL" <<<"$OUT" && grep -qi "hotfix-r1-0" <<<"$OUT"; then
  echo "OK: bị chặn đúng — $(grep -o 'PRECONDITION_FAIL[^\"]*' <<<"$OUT" | head -1)"
else
  echo "FAIL: onboarding migration cài được dù chưa có R1-0"; FAIL=1
fi
if $PSQL -tAc "select to_regprocedure('public.crm_claim_employee_identity_on_first_login()') is null" | grep -q t; then
  echo "OK: không có function nào bị cài một phần"
else
  echo "FAIL: có function bị cài dù transaction phải rollback"; FAIL=1
fi

step "2. Áp hotfix R1-0"
OUT=$($PSQL -v ON_ERROR_STOP=1 -f supabase-hotfix-r1-0-crm-is-admin-fail-closed.sql 2>&1)
if grep -q "HOTFIX_R1_0_VERIFY_PASS" <<<"$OUT"; then
  echo "OK: hotfix áp xong, self-verify PASS"
else
  echo "FAIL: hotfix không PASS: $OUT"; FAIL=1
fi

step "3. Áp onboarding migration"
OUT=$($PSQL -v ON_ERROR_STOP=1 -f supabase-phase-employee-onboarding-r1-prod.sql 2>&1)
if grep -q "PRECONDITION_PASS" <<<"$OUT" && ! grep -q "ERROR" <<<"$OUT"; then
  echo "OK: onboarding migration áp xong"
else
  echo "FAIL: $OUT"; FAIL=1
fi
for fn in crm_claim_employee_identity_on_first_login crm_relink_returning_employee_identity \
          crm_restore_archived_employee crm_employee_identity_status; do
  if $PSQL -tAc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$fn'" | grep -q 1; then
    echo "OK: $fn tồn tại"
  else
    echo "FAIL: thiếu $fn"; FAIL=1
  fi
done

step "4. Integration matrix onboarding"
OUT=$($PSQL -f scripts/test-phase-employee-onboarding-r1-integration.sql 2>&1)
echo "$OUT" | grep -E "^\s+[0-9]+ \|" | tail -1
if echo "$OUT" | grep -qE "\|\s+0 \|"; then
  echo "OK: không có test FAIL"
else
  echo "FAIL: có test onboarding thất bại"; echo "$OUT" | grep FAIL | head -10; FAIL=1
fi

step "5. Security regression sau rollout đầy đủ (mục 45)"
$PSQL -f scripts/test-security-regression-after-rollout.sql 2>&1 | tail -20
if $PSQL -tAc "select count(*) from r45_results where not ok" | grep -q '^0$'; then
  echo "OK: không có lỗ hổng nào mở lại"
else
  echo "FAIL: security regression thất bại"; FAIL=1
fi

printf '\n=====================================\n'
if [ "$FAIL" -eq 0 ]; then
  echo "LOCAL ROLLOUT SIMULATION: PASS"
else
  echo "LOCAL ROLLOUT SIMULATION: FAIL"
fi
exit "$FAIL"
