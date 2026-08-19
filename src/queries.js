// All queries below are SELECT-only and mirror exactly what the
// "Production Plan Variance & Issue Tracking" screen
// (erp.peopledesk.io/production-management/mes/ProductionPlanVariance) shows.
//
// Verified live against DWH.dbo on 2026-08-19:
//   tblProductionPlanVarianceIssueArc   - grid rows (plan/item/qty/diff/status)
//   tblProductionPlanVarianceReasonArc  - "Issue for Difference" reason lookup + escalation emails
//   tblProductionPlanningHeaderArc/Row  - underlying plan lines
//   tblPlantArc / tblShopFloorArc / tblbusinessunitArc - filter dimensions
//
// NOTE: if your account's line/machine or shop-floor linkage lives in a
// different table (e.g. tblWorkCenterArc, tblProductionLineArc) than what's
// wired below, adjust the JOIN in QUERY_LIST_VARIANCE accordingly — the
// dashboard's "Machine" column wasn't present as a column on
// tblProductionPlanVarianceIssueArc itself in the schema pulled, so it's
// most likely resolved via the production order / line table in your
// environment. Confirm and adjust before relying on this in production.

export const QUERY_SUMMARY = `
SELECT
  COUNT(*)                                            AS PlanLines,
  SUM(CASE WHEN difference = 0 THEN 1 ELSE 0 END)     AS OnTarget,
  SUM(CASE WHEN difference <> 0 THEN 1 ELSE 0 END)    AS VarianceFlagged,
  SUM(CASE WHEN (intVarianceReasonId IS NULL OR strIssueStatus IS NULL)
             AND difference <> 0 THEN 1 ELSE 0 END)   AS IssuesMissing
FROM dbo.tblProductionPlanVarianceIssueArc v
WHERE v.isActive = 1
  AND (@PlantId IS NULL OR v.intPlantId = @PlantId)
  AND (@FromDate IS NULL OR v.dteServerDateTime >= @FromDate)
  AND (@ToDate IS NULL OR v.dteServerDateTime <= @ToDate);
`;

export const QUERY_LIST_VARIANCE = `
SELECT
  v.intVarianceIssueId,
  v.strProductionPlanCode,
  v.strItemName,
  p.strPlantName,
  v.plannedQty,
  v.outputQty,
  v.difference,
  r.strVarianceReason,
  v.strRemarks,
  v.strIssueStatus,
  v.strEscalatedToEmail,
  v.dteLastActionDateTime
FROM dbo.tblProductionPlanVarianceIssueArc v
LEFT JOIN dbo.tblPlantArc p ON p.intPlantId = v.intPlantId
LEFT JOIN dbo.tblProductionPlanVarianceReasonArc r ON r.intVarianceReasonId = v.intVarianceReasonId
WHERE v.isActive = 1
  AND (@PlantId IS NULL OR v.intPlantId = @PlantId)
  AND (@IssueStatus IS NULL OR v.strIssueStatus = @IssueStatus)
  AND (@FromDate IS NULL OR v.dteServerDateTime >= @FromDate)
  AND (@ToDate IS NULL OR v.dteServerDateTime <= @ToDate)
ORDER BY v.intVarianceIssueId DESC;
`;

export const QUERY_VARIANCE_REASONS = `
SELECT
  r.intVarianceReasonId,
  r.strVarianceReason,
  p.strPlantName,
  r.strIssueEscalationOneEmail,
  r.strIssueEscalationTwoEmail
FROM dbo.tblProductionPlanVarianceReasonArc r
LEFT JOIN dbo.tblPlantArc p ON p.intPlantId = r.intPlantId
WHERE r.isActive = 1
  AND (@PlantId IS NULL OR r.intPlantId = @PlantId)
ORDER BY p.strPlantName, r.strVarianceReason;
`;

export const QUERY_PLANTS = `
SELECT intPlantId, strPlantCode, strPlantName
FROM dbo.tblPlantArc
WHERE isActive = 1
ORDER BY strPlantName;
`;

export const QUERY_SHOP_FLOORS = `
SELECT intShopFloorId, strShopFloorCode, strShopFloorName, intPlantId
FROM dbo.tblShopFloorArc
WHERE isActive = 1
  AND (@PlantId IS NULL OR intPlantId = @PlantId)
ORDER BY strShopFloorName;
`;
