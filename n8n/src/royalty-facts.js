/**
 * Turns one author's royalty data into FACTS: every number, date, status and
 * "case" the email needs, computed in code. The model only writes prose around
 * these facts; it never does arithmetic or date maths (where LLMs slip most).
 *
 * Status rules (identical to the Bubble badge, see docs/bubble-build-guide.md):
 *   in production                          -> grey   "In production"
 *   nothing pending                        -> green  "Paid up"
 *   pending below the ₹1,000 minimum       -> yellow "Pending" (rolls over, KB policy)
 *   pending, last payout > 90 days ago,
 *     or never paid and published > 90 days -> red    "Overdue"
 *   any other pending amount               -> yellow "Pending"
 *
 * Depends on: shared.js
 */

export const BADGES = {
  in_production: { badge: "grey", label: "In production" },
  no_earnings: { badge: "green", label: "Paid up" },
  paid_up: { badge: "green", label: "Paid up" },
  below_threshold: { badge: "yellow", label: "Pending" },
  pending: { badge: "yellow", label: "Pending" },
  overdue: { badge: "red", label: "Overdue" },
};

export function productionStage(status) {
  const name = String(status || "")
    .replace(/^in production\s*[-–:]\s*/i, "")
    .trim();
  const index = PRODUCTION_STAGES.findIndex((s) => s.toLowerCase() === name.toLowerCase());
  if (index === -1) return { current_stage: name || "In production", stage_number: null, of: PRODUCTION_STAGES.length, next_stage: null };
  return {
    current_stage: PRODUCTION_STAGES[index],
    stage_number: index + 1,
    of: PRODUCTION_STAGES.length,
    next_stage: PRODUCTION_STAGES[index + 1] || null,
  };
}

/** Royalty state of one book on a given day. */
export function assessBook(book, asOfIso) {
  const daysSinceLastPayout = book.last_payout_date ? daysBetween(book.last_payout_date, asOfIso) : null;
  const daysSincePublication = book.publication_date ? daysBetween(book.publication_date, asOfIso) : null;
  const neverPaid = !book.last_payout_date;
  let state;
  let reason = "";

  if (!book.is_published) {
    state = "in_production";
  } else if (book.royalty_earned <= 0) {
    state = "no_earnings";
  } else if (book.royalty_pending <= 0) {
    state = "paid_up";
  } else if (book.royalty_pending < POLICY.minPayoutInr) {
    state = "below_threshold";
  } else if (!neverPaid && daysSinceLastPayout > POLICY.overdueAfterDays) {
    state = "overdue";
    reason = `last payout was ${daysSinceLastPayout} days ago (more than ${POLICY.overdueAfterDays})`;
  } else if (neverPaid && daysSincePublication !== null && daysSincePublication > POLICY.overdueAfterDays) {
    state = "overdue";
    reason = `no payout has ever been made and the book was published ${daysSincePublication} days ago`;
  } else {
    state = "pending";
  }

  return {
    state,
    ...BADGES[state],
    never_paid: neverPaid && book.is_published && book.royalty_earned > 0,
    days_since_last_payout: daysSinceLastPayout,
    days_since_publication: daysSincePublication,
    overdue_reason: reason,
  };
}

export function computeFacts(request) {
  const asOf = request.as_of;
  const calendar = royaltyCalendar(asOf);
  const books = request.books.map((b) => ({ ...b, ...assessBook(b, asOf) }));
  const published = books.filter((b) => b.is_published);
  const inProduction = books.filter((b) => !b.is_published);

  const sum = (list, field) => list.reduce((acc, b) => acc + b[field], 0);
  const totals = {
    books_published: published.length,
    books_in_production: inProduction.length,
    copies_sold: sum(published, "copies_sold"),
    earned: sum(published, "royalty_earned"),
    paid: sum(published, "royalty_paid"),
    pending: sum(published, "royalty_pending"),
  };
  const overdueBooks = books.filter((b) => b.state === "overdue");
  const scheduledBooks = books.filter((b) => b.state === "pending");
  const belowThresholdBooks = books.filter((b) => b.state === "below_threshold");
  const neverPaidBooks = books.filter((b) => b.never_paid && b.royalty_pending > 0);
  const overdueTotal = sum(overdueBooks, "royalty_pending");
  const scheduledTotal = sum(scheduledBooks, "royalty_pending");

  const cases = [];
  if (published.length && totals.pending === 0 && totals.earned > 0) cases.push("all_paid_up");
  if (scheduledBooks.length) cases.push("pending_scheduled");
  if (overdueBooks.length) cases.push("overdue");
  if (neverPaidBooks.length) cases.push("never_paid");
  if (belowThresholdBooks.length) cases.push("below_threshold");
  if (inProduction.length) cases.push("in_production");
  if (!published.length) cases.push("no_published_books");
  if (published.length && totals.earned === 0) cases.push("no_earnings_yet");

  const authorStatus = overdueBooks.length ? "Overdue" : totals.pending > 0 ? "Pending" : "Paid up";

  // What the model is allowed to quote: exactly what factsForPrompt shows it.
  // Anything else is treated as invented.
  const amounts = new Set([POLICY.minPayoutInr, totals.earned, totals.paid, totals.pending, overdueTotal, scheduledTotal]);
  for (const b of books) [b.royalty_per_copy, b.royalty_earned, b.royalty_paid, b.royalty_pending].forEach((v) => amounts.add(v));
  const dates = new Set([asOf, calendar.upcoming.deadline, calendar.upcoming.quarter_end]);
  for (const b of books) [b.publication_date, b.last_payout_date].forEach((d) => d && dates.add(d));

  return {
    as_of: asOf,
    as_of_label: formatLongDate(asOf),
    author: {
      ...request.author,
      first_name: request.author.name.split(/\s+/)[0],
    },
    calendar,
    books,
    totals,
    author_status: authorStatus,
    cases,
    overdue: { count: overdueBooks.length, total: overdueTotal, book_ids: overdueBooks.map((b) => b.book_id) },
    scheduled: { count: scheduledBooks.length, total: scheduledTotal },
    escalation: overdueBooks.length
      ? { team: "finance", respond_within_hours: POLICY.financeResponseHours, book_ids: overdueBooks.map((b) => b.book_id) }
      : null,
    allowed: {
      amounts: [...amounts].filter((v) => Number.isFinite(v)).sort((x, y) => x - y),
      dates: [...dates].filter(Boolean).sort(),
      quarters: [calendar.upcoming.label],
    },
  };
}

/** Subject line, built in code: it is the one line every author sees, so it is never left to the model. */
export function buildSubject(facts) {
  const base = "Your BookLeaf royalty summary";
  if (facts.totals.pending > 0) return `${base}: ${formatInr(facts.totals.pending)} pending`;
  if (facts.totals.earned > 0) return `${base}: all royalties paid`;
  if (facts.totals.books_in_production > 0) return `${base} and production update`;
  return `${base} (${facts.as_of_label})`;
}

/**
 * The view of FACTS the model sees: labels already formatted exactly as they
 * must appear in the email (₹11,970 / 15 Oct 2025), plus plain-English
 * descriptions of each book's position, so the model copies rather than
 * computes.
 */
export function factsForPrompt(facts) {
  const { calendar, totals } = facts;
  return {
    as_of: facts.as_of_label,
    author: { first_name: facts.author.first_name, full_name: facts.author.name, city: facts.author.city },
    payout_calendar: {
      policy: `Royalties are calculated quarterly and paid within 45 days of the quarter ending. Minimum payout ${formatInr(POLICY.minPayoutInr)}; smaller balances roll over to the next quarter.`,
      next_payout: {
        quarter: calendar.upcoming.label,
        quarter_ended_or_ends: calendar.upcoming.quarter_end_label,
        paid_by: calendar.upcoming.deadline_label,
      },
    },
    totals: {
      books_published: totals.books_published,
      books_in_production: totals.books_in_production,
      copies_sold: formatCount(totals.copies_sold),
      total_earned: formatInr(totals.earned),
      total_paid: formatInr(totals.paid),
      total_pending: formatInr(totals.pending),
      pending_that_is_overdue: facts.overdue.count ? formatInr(facts.overdue.total) : null,
      pending_scheduled_for_next_payout: facts.scheduled.count ? formatInr(facts.scheduled.total) : null,
    },
    books: facts.books.map((b) =>
      b.is_published
        ? {
            book_id: b.book_id,
            title: b.title,
            status: "Published & Live",
            published_on: formatLongDate(b.publication_date),
            copies_sold: formatCount(b.copies_sold),
            royalty_per_copy: formatInr(b.royalty_per_copy),
            royalty_earned: formatInr(b.royalty_earned),
            royalty_paid: formatInr(b.royalty_paid),
            royalty_pending: formatInr(b.royalty_pending),
            last_payout: b.last_payout_date ? formatLongDate(b.last_payout_date) : "No payout yet",
            payout_position: describePosition(b, calendar),
          }
        : {
            book_id: b.book_id,
            title: b.title,
            status: "In production",
            production: productionStage(b.status),
            payout_position: "Not published yet, so no sales or royalties yet.",
          },
    ),
    cases: facts.cases,
    finance_escalation: facts.escalation
      ? `Our finance team has been alerted about the overdue amount and will update you within ${facts.escalation.respond_within_hours} hours.`
      : null,
  };
}

function describePosition(book, calendar) {
  const pending = formatInr(book.royalty_pending);
  switch (book.state) {
    case "no_earnings":
      return "No royalties earned yet.";
    case "paid_up":
      return "Fully paid: nothing pending.";
    case "below_threshold":
      return `${pending} pending is below the ${formatInr(POLICY.minPayoutInr)} minimum payout, so it rolls over until the balance reaches ${formatInr(POLICY.minPayoutInr)}.`;
    case "overdue":
      return book.never_paid
        ? `${pending} pending. No payout has been made for this book yet, and it should have been paid by now (overdue).`
        : `${pending} pending. The last payout was on ${formatLongDate(book.last_payout_date)}, and this balance should have been paid by now (overdue).`;
    case "pending":
      return book.never_paid
        ? `${pending} pending. This will be the book's first payout, due with the ${calendar.upcoming.label} payout by ${calendar.upcoming.deadline_label}.`
        : `${pending} pending, due with the ${calendar.upcoming.label} payout by ${calendar.upcoming.deadline_label}.`;
    default:
      return "";
  }
}
