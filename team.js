"use strict";

/**
 * Anura employees. Quick Capture and Forge both use this list.
 * Jen Hemming and Jennifer Hemming are the same person.
 */
const ANURA_TEAM = [
  "Rachel Neill",
  "Peter Oppermann",
  "Ben Oppermann",
  "Ben Gray",
  "Dan Neill",
  "Suzie Hall",
  "Melissa Alfiero",
  "Jennifer Hemming",
  "Jen Hemming",
];

function normalizePersonName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameVariants(person) {
  if (!person) return [];
  if (typeof person === "string") return [normalizePersonName(person)].filter(Boolean);
  const first = person.first_name || person.firstName || "";
  const last = person.last_name || person.lastName || "";
  const variants = [];
  if (person.name) variants.push(normalizePersonName(person.name));
  const composed = normalizePersonName((String(first) + " " + String(last)).trim());
  if (composed) variants.push(composed);
  return variants.filter(Boolean);
}

const TEAM_NAMES = {};
ANURA_TEAM.forEach(function (name) { TEAM_NAMES[normalizePersonName(name)] = true; });

function isAnuraTeammate(person) {
  return nameVariants(person).some(function (name) { return !!TEAM_NAMES[name]; });
}

module.exports = {
  ANURA_TEAM: ANURA_TEAM,
  isAnuraTeammate: isAnuraTeammate,
};
