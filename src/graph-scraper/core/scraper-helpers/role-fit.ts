import { companyConfig } from "../../../config/company.js";

export function calculateRoleFitPoints(archetypes: string[]): number {
  return archetypes.some((archetype) =>
    companyConfig.targetRoles.includes(archetype)
  )
    ? companyConfig.roleFitBonusPoints
    : 0;
}
