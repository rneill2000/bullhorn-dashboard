"use strict";

/**
 * Bullhorn date-only fields (dataSpecialization DATE), including Candidate.dateAvailable,
 * are stored as midnight UTC. Formatting that instant in America/Chicago shows the
 * previous calendar day. The UTC calendar date is the date that was entered.
 */
function fmtDateOnly(ms, options) {
  const n = Number(ms);
  if (!n || isNaN(n)) return "";
  const d = new Date(n);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, options || {}));
}

module.exports = { fmtDateOnly };
