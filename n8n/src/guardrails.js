/**
 * Turns Gemini's HTTP response into a checked email draft, or a precise list
 * of reasons it can't be sent. Checks:
 *  - the response is complete JSON with every field (not blocked/truncated)
 *  - exactly one note per book, with the right book_ids
 *  - every ₹ amount, date, quarter and percentage appears in FACTS/policy
 *  - case-specific must-haves (48-hour finance update when overdue, the
 *    ₹1,000 rule when a balance rolls over, a production update)
 *  - no placeholders, no "as an AI", sensible lengths
 *
 * Depends on: shared.js
 */

const TEXT_FIELDS = ["preheader", "greeting", "opening", "totals_note", "payout_note", "production_note", "closing"];
const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ALLOWED_PERCENTAGES = [80, 20];

/** Gemini generateContent response -> { ok, draft } or { ok: false, error_code, error_message } */
export function parseGeminiResponse(response) {
  const r = response || {};
  if (r.error) {
    const e = r.error;
    return { ok: false, error_code: "ai_unavailable", error_message: `Gemini error ${e.code ?? ""} ${e.status ?? ""}: ${e.message ?? ""}`.trim() };
  }
  if (r.promptFeedback && r.promptFeedback.blockReason) {
    return { ok: false, error_code: "ai_blocked", error_message: `Prompt blocked: ${r.promptFeedback.blockReason}` };
  }
  const candidate = (r.candidates || [])[0];
  if (!candidate) return { ok: false, error_code: "ai_empty", error_message: "Gemini returned no candidates" };
  const finish = candidate.finishReason;
  if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"].includes(finish)) {
    return { ok: false, error_code: "ai_blocked", error_message: `Response blocked (${finish})` };
  }
  const text = ((candidate.content && candidate.content.parts) || [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  const draft = decodeEscapes(parseJsonLoose(text));
  if (!draft) {
    return {
      ok: false,
      error_code: "ai_output_invalid",
      error_message: finish === "MAX_TOKENS" ? "Response was cut off (MAX_TOKENS)" : "Response was not valid JSON",
    };
  }
  return { ok: true, draft, finish_reason: finish || "", usage: r.usageMetadata || null, model_version: r.modelVersion || "" };
}

/**
 * Gemini sometimes double-escapes non-ASCII characters, so "₹" arrives as the
 * six characters "₹" after JSON parsing. Decode them everywhere, before
 * the guardrails look for ₹ amounts.
 */
function decodeEscapes(value) {
  if (typeof value === "string") {
    return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\n/g, "\n");
  }
  if (Array.isArray(value)) return value.map(decodeEscapes);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeEscapes(v)]));
  }
  return value;
}

function parseJsonLoose(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/** Returns a list of human-readable violations (empty = safe to send). */
export function checkGuardrails(draft, facts) {
  const v = [];
  const d = draft || {};

  for (const field of TEXT_FIELDS) {
    if (typeof d[field] !== "string") v.push(`${field} is missing`);
  }
  if (!Array.isArray(d.book_notes)) v.push("book_notes is missing");
  if (v.length) return v;

  const required = TEXT_FIELDS.filter((f) => f !== "production_note");
  for (const field of required) if (!d[field].trim()) v.push(`${field} is empty`);
  if (d.preheader.length > 160) v.push("preheader is longer than 160 characters");
  for (const field of ["preheader", "greeting"]) if (/[\r\n]/.test(d[field])) v.push(`${field} must be a single line`);
  for (const field of TEXT_FIELDS) if (d[field].length > 1500) v.push(`${field} is too long`);

  if (!new RegExp(`^Dear ${escapeRegex(facts.author.first_name)}\\b`, "i").test(d.greeting.trim())) {
    v.push(`greeting must be "Dear ${facts.author.first_name},"`);
  }

  // One note per book, matching ids.
  const expected = facts.books.map((b) => b.book_id);
  const got = d.book_notes.map((n) => String((n && n.book_id) || ""));
  const missing = expected.filter((id) => !got.includes(id));
  const unknown = got.filter((id) => !expected.includes(id));
  const dupes = got.filter((id, i) => got.indexOf(id) !== i);
  if (missing.length) v.push(`book_notes is missing book_id(s): ${missing.join(", ")}`);
  if (unknown.length) v.push(`book_notes has unknown book_id(s): ${unknown.join(", ")}`);
  if (dupes.length) v.push(`book_notes repeats book_id(s): ${[...new Set(dupes)].join(", ")}`);
  for (const n of d.book_notes) if (!n || !String(n.note || "").trim()) v.push(`book note for ${n && n.book_id} is empty`);

  const allText = [...TEXT_FIELDS.map((f) => d[f]), ...d.book_notes.map((n) => String((n && n.note) || ""))].join("\n");

  for (const amount of extractAmounts(allText)) {
    if (!facts.allowed.amounts.includes(amount)) v.push(`mentions ${formatInr(amount)}, which is not in FACTS`);
  }
  v.push(...checkAmountPlacement(d, facts));
  for (const iso of extractDates(allText)) {
    if (!facts.allowed.dates.includes(iso)) v.push(`mentions the date ${formatLongDate(iso)}, which is not in FACTS`);
  }
  for (const q of extractQuarters(allText)) {
    if (!facts.allowed.quarters.includes(q)) v.push(`mentions ${q}, which is not in FACTS`);
  }
  for (const p of extractPercentages(allText)) {
    if (!ALLOWED_PERCENTAGES.includes(p)) v.push(`mentions ${p}%, which is not in policy`);
  }

  if (/\[[^\]]{0,40}\]|\{\{|<\s*(first|name|author)[^>]*>|lorem ipsum|TODO/i.test(allText)) v.push("contains a placeholder");
  if (/\b(as an ai|language model|generated by (ai|gemini)|chatgpt)\b/i.test(allText)) v.push("mentions AI");
  if (/\b(FACTS|payout_position|below_threshold|pending_scheduled|all_paid_up|never_paid)\b/.test(allText)) v.push("leaks internal wording");

  const cases = facts.cases;
  if (cases.includes("overdue") && !/48\s*hours/i.test(allText)) v.push("overdue royalties must say the finance team will update within 48 hours");
  if (cases.includes("below_threshold") && !/₹\s?1,000/.test(allText)) v.push("must explain the ₹1,000 minimum payout");
  if (cases.includes("in_production") && !d.production_note.trim()) v.push("production_note is required because a book is in production");
  if (facts.totals.pending > 0) {
    if (!allText.includes(facts.calendar.upcoming.deadline_label)) v.push(`must give the next payout date (${facts.calendar.upcoming.deadline_label})`);
    if (!/45\s*days/i.test(allText)) v.push("must explain the quarterly cycle and 45-day payout window");
  }
  if (/\\u[0-9a-f]{4}|\\n/i.test(allText)) v.push("contains escaped characters (e.g. \\u20b9) instead of real text");
  if (/\bthe author\b|\bbook\(s\)/i.test(allText)) v.push('speaks about the reader in the third person ("the author") or uses "book(s)"; write to them directly');

  return [...new Set(v)];
}

/**
 * A real amount in the wrong place is still wrong (seen in testing: a book's
 * ₹2,540 quoted as the author's total pending). So each section may only use
 * the amounts that belong to it.
 */
export function checkAmountPlacement(d, facts) {
  const v = [];
  const t = facts.totals;
  const min = POLICY.minPayoutInr;

  const totalsAmounts = extractAmounts(d.totals_note);
  for (const [label, value] of [["total earned", t.earned], ["total paid", t.paid], ["total pending", t.pending]]) {
    if (!totalsAmounts.includes(value)) v.push(`totals_note must state the ${label} exactly (${formatInr(value)})`);
  }
  for (const a of totalsAmounts) {
    if (![t.earned, t.paid, t.pending].includes(a)) v.push(`totals_note quotes ${formatInr(a)}, which is not one of the three totals`);
  }

  for (const note of d.book_notes) {
    const book = facts.books.find((b) => b.book_id === (note && note.book_id));
    if (!book) continue;
    const own = [book.royalty_per_copy, book.royalty_earned, book.royalty_paid, book.royalty_pending, min];
    for (const a of extractAmounts(String(note.note || ""))) {
      if (!own.includes(a)) v.push(`the note for ${book.title} quotes ${formatInr(a)}, which is not one of that book's figures`);
    }
  }

  const payoutAmounts = new Set([t.pending, facts.overdue.total, facts.scheduled.total, min, ...facts.books.map((b) => b.royalty_pending)]);
  for (const a of extractAmounts(d.payout_note)) {
    if (!payoutAmounts.has(a)) v.push(`payout_note quotes ${formatInr(a)}, which is not a pending amount`);
  }
  return v;
}

export function extractAmounts(text) {
  const out = [];
  const re = /(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)/gi;
  let m;
  while ((m = re.exec(text))) out.push(Number(m[1].replace(/,/g, "")));
  return out;
}

export function extractDates(text) {
  const out = [];
  const pad = (n) => String(n).padStart(2, "0");
  const push = (day, mon, year) => {
    const month = MONTH_INDEX[mon.slice(0, 3).toLowerCase()];
    if (month) out.push(`${year}-${pad(month)}-${pad(day)}`);
  };
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{4})\b/gi;
  const monthFirst = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  let m;
  while ((m = dayFirst.exec(text))) push(Number(m[1]), m[2], m[3]);
  while ((m = monthFirst.exec(text))) push(Number(m[2]), m[1], m[3]);
  return out;
}

export function extractQuarters(text) {
  const out = [];
  const re = /\bQ([1-4])\s*(?:FY\s*)?(\d{4})\b/gi;
  let m;
  while ((m = re.exec(text))) out.push(`Q${m[1]} ${m[2]}`);
  return out;
}

export function extractPercentages(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s?(?:%|per\s?cent)/gi;
  let m;
  while ((m = re.exec(text))) out.push(Number(m[1]));
  return out;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
