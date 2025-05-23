// Helper function to calculate role fit points
const TARGET_ROLES = ["protocol/crypto", "backend/infra", "full-stack"];

export function calculateRoleFitPoints(archetypes: string[]): number {
  return archetypes.some((archetype) => TARGET_ROLES.includes(archetype))
    ? 20
    : 0;
}
