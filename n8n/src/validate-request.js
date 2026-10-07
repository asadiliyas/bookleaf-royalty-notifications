/**
 * Validates and normalises the webhook body Bubble sends. Bubble's API
 * Connector sends every scalar as a string (it is the only way to keep a JSON
 * template valid when a field is empty), so numbers, dates and yes/no values
 * are parsed here. Anything that would make the email wrong is rejected rather
 * than guessed: a summary with a wrong royalty figure is worse than none.
 *
 * Depends on: shared.js, response.js
 */

const MAX_BOOKS = 50;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRequest(body, config, nowMs) {
  const errors = [];
  const tz = config.timezone || DEFAULT_TIMEZONE;
  const b = body && typeof body === "object" ? body : {};

  const notificationId = String(b.notification_id ?? "").trim();
  if (!ID_PATTERN.test(notificationId)) errors.push("notification_id is missing or has invalid characters");

  const triggerRaw = String(b.trigger_type ?? "Single").trim().toLowerCase();
  const triggerType = triggerRaw === "bulk" ? "Bulk" : triggerRaw === "single" || triggerRaw === "" ? "Single" : null;
  if (!triggerType) errors.push("trigger_type must be Single or Bulk");

  // Replay protection: a captured request stops working after a few minutes.
  // Dry runs have no side effects, so they are exempt; this lets Bubble's API
  // Connector be initialised with fixed sample values.
  const dryRun = parseYesNo(b.dry_run) === true;
  const requestedAt = Number(String(b.requested_at_ms ?? "").replace(/[^0-9]/g, ""));
  const maxAgeMs = (Number(config.max_request_age_minutes) || 10) * 60 * 1000;
  let stale = false;
  if (!requestedAt) {
    errors.push("requested_at_ms is required");
  } else if (!dryRun && Math.abs(nowMs - requestedAt) > maxAgeMs) {
    stale = true;
    errors.push(`request is older than ${maxAgeMs / 60000} minutes (possible replay)`);
  }

  let asOf = parseCalendarDate(b.as_of_ms ?? b.as_of_date, tz);
  if (asOf === undefined) errors.push("as_of_ms is not a valid date");
  if (!asOf) asOf = isoDateInTimezone(nowMs, tz);

  const simulate = String(b.simulate_failure ?? "").trim().toLowerCase();
  if (!["", "ai", "email"].includes(simulate)) errors.push('simulate_failure must be "", "ai" or "email"');

  const a = b.author && typeof b.author === "object" ? b.author : {};
  const author = {
    author_id: String(a.author_id ?? "").trim(),
    name: String(a.name ?? "").trim(),
    email: String(a.email ?? "").trim(),
    city: String(a.city ?? "").trim(),
  };
  if (!ID_PATTERN.test(author.author_id)) errors.push("author.author_id is missing");
  if (!author.name) errors.push("author.name is missing");
  if (!EMAIL_PATTERN.test(author.email)) errors.push("author.email is not a valid email address");

  let rawBooks = b.books;
  if (typeof rawBooks === "string") {
    try {
      rawBooks = JSON.parse(rawBooks);
    } catch {
      errors.push("books is not valid JSON");
      rawBooks = [];
    }
  }
  if (!Array.isArray(rawBooks)) {
    errors.push("books must be a list");
    rawBooks = [];
  }
  if (rawBooks.length > MAX_BOOKS) errors.push(`too many books (max ${MAX_BOOKS})`);

  const seen = new Set();
  const books = rawBooks.map((raw, i) => normaliseBook(raw || {}, i, tz, errors, seen));

  const ok = errors.length === 0;
  const request = {
    notification_id: notificationId,
    idempotency_key: String(b.idempotency_key ?? "").trim() || notificationId,
    trigger_type: triggerType || "Single",
    triggered_by: String(b.triggered_by ?? "").trim(),
    requested_at_ms: requestedAt || null,
    as_of: asOf,
    simulate_failure: config.allow_failure_simulation ? simulate : "",
    dry_run: dryRun,
    author,
    books,
  };

  return {
    ok,
    errors,
    request,
    http_status: ok ? 200 : 400,
    response: ok
      ? null
      : buildResponse(
          {
            status: "Failed",
            notification_id: notificationId,
            author_id: author.author_id,
            error_code: stale ? "stale_request" : "invalid_request",
            error_message: errors.join("; "),
          },
          nowMs,
        ),
  };
}

function normaliseBook(raw, index, tz, errors, seen) {
  const where = `books[${index}]`;
  const bookId = String(raw.book_id ?? "").trim();
  if (!ID_PATTERN.test(bookId)) errors.push(`${where}.book_id is missing`);
  else if (seen.has(bookId)) errors.push(`${where}.book_id ${bookId} is duplicated`);
  seen.add(bookId);

  const title = String(raw.title ?? "").trim();
  if (!title) errors.push(`${where}.title is missing`);

  const status = String(raw.status ?? "").trim();
  const flag = parseYesNo(raw.is_published);
  const isPublished = flag === undefined ? /published/i.test(status) : flag;

  // Books still in production have no MRP or sales yet, so Bubble sends
  // empty values. Royalty figures are only mandatory once a book is live.
  const num = (field, { optional = false } = {}) => {
    const rawValue = raw[field];
    const empty = rawValue === null || rawValue === undefined || String(rawValue).trim() === "";
    if (empty && (optional || !isPublished)) return optional ? null : 0;
    const v = parseAmount(rawValue);
    if (Number.isNaN(v) || v < 0) {
      errors.push(`${where}.${field} must be a non-negative number`);
      return 0;
    }
    return v;
  };
  const date = (field) => {
    const v = parseCalendarDate(raw[field], tz);
    if (v === undefined) {
      errors.push(`${where}.${field} is not a valid date`);
      return null;
    }
    return v;
  };

  const book = {
    book_id: bookId,
    title,
    isbn: String(raw.isbn ?? "").trim(),
    genre: String(raw.genre ?? "").trim(),
    status,
    is_published: isPublished,
    publication_date: date("publication_date_ms"),
    mrp: num("mrp", { optional: true }),
    royalty_per_copy: num("royalty_per_copy", { optional: true }),
    copies_sold: num("copies_sold"),
    royalty_earned: num("royalty_earned"),
    royalty_paid: num("royalty_paid"),
    royalty_pending: num("royalty_pending"),
    last_payout_date: date("last_payout_date_ms"),
    print_partner: String(raw.print_partner ?? "").trim(),
    available_on: normaliseList(raw.available_on),
  };

  // The dataset's figures always satisfy earned = paid + pending. If Bubble's
  // copy ever drifts, refuse to email an author numbers that don't add up.
  if (Math.abs(book.royalty_earned - (book.royalty_paid + book.royalty_pending)) > 1) {
    errors.push(`${where} (${bookId}) royalty figures do not add up: earned must equal paid + pending`);
  }
  return book;
}

function normaliseList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
