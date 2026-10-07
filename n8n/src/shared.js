/**
 * Shared helpers. scripts/build-workflows.mjs inlines this file at the top of
 * every Code node, so it must stay dependency-free plain JavaScript (no
 * imports, no Node APIs): it runs both in Vitest and in n8n's Code sandbox.
 *
 * Dates are calendar dates ("YYYY-MM-DD"). Bubble sends timestamps, and a date
 * typed in India is stored as the previous day 18:30 UTC, so timestamps are
 * converted to a calendar date in BookLeaf's timezone before any arithmetic.
 */

export const POLICY = {
  minPayoutInr: 1000, // KB: balances below this roll over to the next quarter
  payoutWindowDays: 45, // KB: paid within 45 days of the quarter ending
  overdueAfterDays: 90, // brief: red badge after 90 days without a payout
  financeResponseHours: 48, // KB playbook: overdue royalties escalated with a 48-hour timeline
};

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export const PRODUCTION_STAGES = [
  "Manuscript Received",
  "Editing",
  "Cover Design",
  "Typesetting",
  "Proofreading",
  "ISBN Assignment",
  "Printing",
  "Distribution Setup",
  "Published & Live",
];

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Calendar date ("YYYY-MM-DD") of an instant, in the given timezone. */
export function isoDateInTimezone(ms, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Accepts what Bubble can send for a date: a UNIX timestamp in ms (or s),
 * a "YYYY-MM-DD" string, or any ISO timestamp. Empty values mean "no date".
 * Returns "YYYY-MM-DD", null for empty, or undefined if unparseable.
 */
export function parseCalendarDate(value, timezone) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (raw === "" || raw === "null" || raw === "undefined") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    let ms = Number(raw);
    if (Math.abs(ms) < 1e11) ms *= 1000; // seconds, not milliseconds
    return isoDateInTimezone(ms, timezone);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isValidIsoDate(raw) ? raw : undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return undefined;
  return isoDateInTimezone(ms, timezone);
}

function isValidIsoDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function utcDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

export function isoOf(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return isoOf(new Date(utcDate(iso).getTime() + days * DAY_MS));
}

/** Whole days from `fromIso` to `toIso` (positive when `toIso` is later). */
export function daysBetween(fromIso, toIso) {
  return Math.round((utcDate(toIso).getTime() - utcDate(fromIso).getTime()) / DAY_MS);
}

/** "14 Nov 2026" */
export function formatLongDate(iso) {
  if (!iso) return "";
  const d = utcDate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "₹11,970" with Indian digit grouping (₹1,23,456). */
export function formatInr(amount) {
  const n = Math.round(Number(amount) || 0);
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)}`;
}

export function formatCount(n) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(n) || 0);
}

// ---------------------------------------------------------------------------
// Royalty calendar: quarterly calculation, paid within 45 days of quarter end.
// ---------------------------------------------------------------------------

export function quarterOf(iso) {
  const d = utcDate(iso);
  const year = d.getUTCFullYear();
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  const start = isoOf(new Date(Date.UTC(year, (quarter - 1) * 3, 1)));
  const end = isoOf(new Date(Date.UTC(year, quarter * 3, 0))); // day 0 of next quarter
  return { year, quarter, start, end, label: `Q${quarter} ${year}` };
}

export function previousQuarter(q) {
  return quarterOf(addDays(q.start, -1));
}

function payoutCycle(q) {
  const deadline = addDays(q.end, POLICY.payoutWindowDays);
  return {
    label: q.label,
    quarter_start: q.start,
    quarter_end: q.end,
    deadline,
    quarter_end_label: formatLongDate(q.end),
    deadline_label: formatLongDate(deadline),
  };
}

/**
 * The payout an author can expect next, and the most recent one whose window
 * has already closed. Early in a quarter the previous quarter's window is
 * still open, so that is the "upcoming" payout.
 */
export function royaltyCalendar(asOfIso) {
  const current = quarterOf(asOfIso);
  const lastClosed = previousQuarter(current);
  const lastClosedDeadline = addDays(lastClosed.end, POLICY.payoutWindowDays);
  const windowOpen = asOfIso <= lastClosedDeadline;
  return {
    as_of: asOfIso,
    current_quarter: current.label,
    upcoming: payoutCycle(windowOpen ? lastClosed : current),
    last_closed: payoutCycle(windowOpen ? previousQuarter(lastClosed) : lastClosed),
  };
}

/** Parses "1,234", "₹1,234", 1234 → 1234. Returns NaN for anything else. */
export function parseAmount(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).replace(/[₹,\s]|INR|Rs\.?/gi, "");
  if (cleaned === "") return NaN;
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

export function parseYesNo(value) {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1", "y"].includes(raw)) return true;
  if (["no", "false", "0", "n", ""].includes(raw)) return false;
  return undefined;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
