import { describe, expect, it } from "vitest";
import { loadAll } from "../../scripts/lib/compose.mjs";
import { bubblePayload, dataset } from "../../scripts/lib/payload.mjs";

const lib = loadAll();
const CONFIG = { timezone: "Asia/Kolkata", max_request_age_minutes: 10, allow_failure_simulation: true };

function factsFor(authorId, asOfIso) {
  const nowMs = Date.now();
  const v = lib.validateRequest(bubblePayload(authorId, { asOfIso, nowMs }), CONFIG, nowMs);
  expect(v.errors).toEqual([]);
  return lib.computeFacts(v.request);
}

function statesOn(asOfIso) {
  const out = {};
  for (const a of dataset.authors) for (const b of factsFor(a.author_id, asOfIso).books) out[b.book_id] = b.state;
  return out;
}

describe("shared helpers", () => {
  it("formats rupees with Indian grouping", () => {
    expect(lib.formatInr(11970)).toBe("₹11,970");
    expect(lib.formatInr(123456)).toBe("₹1,23,456");
    expect(lib.formatInr(0)).toBe("₹0");
  });

  it("reads Bubble timestamps as the calendar date entered in India", () => {
    // 2023-06-20 00:00 IST is 2023-06-19 18:30 UTC.
    expect(lib.parseCalendarDate(String(Date.parse("2023-06-19T18:30:00Z")), "Asia/Kolkata")).toBe("2023-06-20");
    expect(lib.parseCalendarDate("2023-06-20", "Asia/Kolkata")).toBe("2023-06-20");
    expect(lib.parseCalendarDate("", "Asia/Kolkata")).toBeNull();
    expect(lib.parseCalendarDate("not a date", "Asia/Kolkata")).toBeUndefined();
  });

  it("works out the quarterly payout calendar (45-day window)", () => {
    const oct = lib.royaltyCalendar("2026-10-07");
    expect(oct.upcoming).toMatchObject({ label: "Q3 2026", deadline: "2026-11-14", deadline_label: "14 Nov 2026" });
    expect(oct.last_closed).toMatchObject({ label: "Q2 2026", deadline: "2026-08-14" });

    const jan = lib.royaltyCalendar("2026-01-01");
    expect(jan.upcoming).toMatchObject({ label: "Q4 2025", deadline: "2026-02-14" });

    // Once the Q4 window has closed, the next payout is for the current quarter.
    const feb = lib.royaltyCalendar("2026-02-20");
    expect(feb.upcoming).toMatchObject({ label: "Q1 2026", deadline: "2026-05-15" });
    expect(feb.last_closed).toMatchObject({ label: "Q4 2025", deadline: "2026-02-14" });
  });
});

describe("royalty status (same rules as the Bubble badge)", () => {
  it("as of today's real date, every unpaid balance above ₹1,000 is overdue (no payouts recorded since Dec 2025)", () => {
    expect(statesOn("2026-10-07")).toEqual({
      BK001: "overdue", BK002: "paid_up", BK003: "overdue", BK004: "overdue", BK005: "overdue", BK006: "overdue",
      BK007: "paid_up", BK008: "paid_up", BK009: "overdue", BK010: "overdue", BK011: "overdue", BK012: "overdue",
      BK013: "in_production", BK014: "paid_up", BK015: "in_production", BK016: "below_threshold", BK017: "overdue",
      BK018: "overdue",
    });
  });

  it("as of the dataset snapshot (1 Jan 2026) shows the full green / yellow / red spread", () => {
    expect(statesOn("2026-01-01")).toEqual({
      BK001: "pending", BK002: "paid_up", BK003: "overdue", BK004: "pending", BK005: "overdue", BK006: "overdue",
      BK007: "paid_up", BK008: "paid_up", BK009: "pending", BK010: "overdue", BK011: "pending", BK012: "pending",
      BK013: "in_production", BK014: "paid_up", BK015: "in_production", BK016: "below_threshold", BK017: "pending",
      BK018: "overdue",
    });
  });

  it("uses the 90-day boundary exactly", () => {
    const book = { is_published: true, royalty_earned: 5000, royalty_paid: 3000, royalty_pending: 2000, last_payout_date: "2026-01-01", publication_date: "2025-01-01" };
    expect(lib.assessBook(book, "2026-04-01").state).toBe("pending"); // 90 days
    expect(lib.assessBook(book, "2026-04-02").state).toBe("overdue"); // 91 days
  });

  it("never-paid books turn red only once published for more than 90 days", () => {
    const book = { is_published: true, royalty_earned: 2000, royalty_paid: 0, royalty_pending: 2000, last_payout_date: null, publication_date: "2026-08-01" };
    expect(lib.assessBook(book, "2026-10-07")).toMatchObject({ state: "pending", never_paid: true });
    expect(lib.assessBook(book, "2026-11-15")).toMatchObject({ state: "overdue", never_paid: true });
  });

  it("totals, cases and author status", () => {
    const sneha = factsFor("AUTH007", "2026-01-01");
    expect(sneha.totals).toEqual({ books_published: 2, books_in_production: 1, copies_sold: 2290, earned: 60865, paid: 53000, pending: 7865 });
    expect(sneha.cases).toEqual(["pending_scheduled", "in_production"]);
    expect(sneha.author_status).toBe("Pending");

    const farhan = factsFor("AUTH008", "2026-10-07");
    expect(farhan.cases).toEqual(["all_paid_up"]);
    expect(farhan.author_status).toBe("Paid up");
    expect(farhan.escalation).toBeNull();

    const ananya = factsFor("AUTH003", "2026-10-07");
    expect(ananya.cases).toEqual(["overdue", "never_paid"]);
    expect(ananya.escalation).toMatchObject({ team: "finance", book_ids: ["BK005"] });

    const kavita = factsFor("AUTH009", "2026-10-07");
    expect(kavita.cases).toEqual(["never_paid", "below_threshold", "in_production"]);
    expect(kavita.author_status).toBe("Pending");
  });

  it("describes production stages", () => {
    expect(lib.productionStage("Cover Design")).toEqual({ current_stage: "Cover Design", stage_number: 3, of: 9, next_stage: "Typesetting" });
    expect(lib.productionStage("In Production - Typesetting")).toMatchObject({ stage_number: 4, next_stage: "Proofreading" });
  });

  it("gives the model pre-formatted figures only", () => {
    const f = lib.factsForPrompt(factsFor("AUTH001", "2026-01-01"));
    expect(f.totals.total_pending).toBe("₹3,570");
    expect(f.payout_calendar.next_payout).toEqual({ quarter: "Q4 2025", quarter_ended_or_ends: "31 Dec 2025", paid_by: "14 Feb 2026" });
    expect(f.books[0].payout_position).toContain("14 Feb 2026");
  });
});
