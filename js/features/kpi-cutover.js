export const KPI_LEGACY_CUTOVER_AT = "2026-09-01T00:00:00+07:00";
export const KPI_LEGACY_CUTOVER_UTC = "2026-08-31T17:00:00.000Z";
export const KPI_LEGACY_CUTOVER_MS = Date.parse(KPI_LEGACY_CUTOVER_UTC);

export function isLegacyKpiPreCutover(now = Date.now()) {
  const value = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(value) && value < KPI_LEGACY_CUTOVER_MS;
}

export function legacyProposalCreatedBeforeCutover(proposal) {
  const raw = proposal?.createdAt ?? proposal?.created_at;
  const value = raw instanceof Date
    ? raw.getTime()
    : typeof raw?.toDate === "function"
      ? raw.toDate().getTime()
      : Date.parse(raw || "");
  return Number.isFinite(value) && value < KPI_LEGACY_CUTOVER_MS;
}

export function legacyCloseoutEligible(proposal, isPending) {
  return Boolean(
    proposal
    && !proposal.isDeleted
    && !proposal.is_deleted
    && isPending
    && legacyProposalCreatedBeforeCutover(proposal)
  );
}

export function kpiCutoverStatusText({preCutover, legacyPendingCount = 0} = {}) {
  if (preCutover) {
    return "KPI tháng 08 đang sử dụng hệ thống cũ. KPI-2 tháng 09 có thể được chuẩn bị trước ở trạng thái DRAFT.";
  }
  const suffix = legacyPendingCount > 0
    ? ` Còn ${legacyPendingCount} đề xuất KPI cũ cần đóng sổ.`
    : "";
  return `KPI-2 là hệ thống KPI hiện tại từ 01/09/2026.${suffix}`;
}
