import { isWintermarktband, WALD_PROJECT_ID } from "./model.js";

export const DAYS = [
  { id: "mo", label: "Montag", block: 0 },
  { id: "di", label: "Dienstag", block: 0 },
  { id: "mi", label: "Mittwoch", block: 1 },
  { id: "do", label: "Donnerstag", block: 1 },
];

export function dailySchedule(state, childId, dayId) {
  const day = DAYS.find((item) => item.id === dayId);
  if (!day) throw Error("Unbekannter Tag.");
  const projectId = state.assignments[childId]?.[day.block] || null;
  const band = isWintermarktband(state, childId);
  return {
    projectId,
    band,
    early: band ? "Wintermarktband" : projectId,
    late: projectId,
    conflict: band && projectId === WALD_PROJECT_ID,
  };
}

export function groupAttendance(state, projectId, dayId) {
  const day = DAYS.find((item) => item.id === dayId);
  if (!day) throw Error("Unbekannter Tag.");
  const assigned = state.children.filter((child) => state.assignments[child.id]?.[day.block] === projectId);
  return {
    early: assigned.filter((child) => !isWintermarktband(state, child.id)),
    late: assigned,
    conflict: assigned.filter((child) => isWintermarktband(state, child.id) && projectId === WALD_PROJECT_ID),
  };
}
