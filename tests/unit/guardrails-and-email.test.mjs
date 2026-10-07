import { describe, expect, it } from "vitest";
import { loadAll, composeNodeCode } from "../../scripts/lib/compose.mjs";
import { bubblePayload } from "../../scripts/lib/payload.mjs";

const lib = loadAll();
const CONFIG = { timezone: "Asia/Kolkata", max_request_age_minutes: 10, allow_failure_simulation: true };

function facts(authorId, asOfIso) {
  const now = Date.now();
  return lib.computeFacts(lib.validateRequest(bubblePayload(authorId, { asOfIso, nowMs: now }), CONFIG, now).request);
}

// Priya as of 1 Jan 2026: BK001 has ₹3,570 scheduled for the Q4 2025 payout, BK002 is paid up.
const goodDraft = () => ({
  subject: "Your BookLeaf royalty summary: ₹3,570 pending",
  preheader: "₹3,570 is due with the Q4 2025 payout by 14 Feb 2026.",
  greeting: "Dear Priya,",
  opening: "Thank you for publishing with BookLeaf. Here is your royalty summary as of 1 Jan 2026.",
  book_notes: [
    { book_id: "BK001", note: "Whispers of the Ganges has sold 342 copies and earned ₹11,970; ₹3,570 is pending." },
    { book_id: "BK002", note: "The Saffron Diaries has earned ₹7,938 and is fully paid." },
  ],
  totals_note: "Across your books you have earned ₹19,908, been paid ₹16,338 and have ₹3,570 pending.",
  payout_note: "Royalties are calculated quarterly and paid within 45 days of the quarter ending, so your ₹3,570 will be paid with the Q4 2025 payout by 14 Feb 2026.",
  production_note: "",
  closing: "Reply to this email if you have any questions.",
});

describe("parseGeminiResponse", () => {
  it("extracts the JSON draft and skips thought parts", () => {
    const parsed = lib.parseGeminiResponse({
      candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "thinking" }, { text: JSON.stringify(goodDraft()) }] } }],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.draft.greeting).toBe("Dear Priya,");
  });

  it("decodes double-escaped characters so ₹ amounts are still checked", () => {
    // Seen in testing: Gemini returned "\\u20b93,570", i.e. a literal "₹" after JSON parsing.
    const draft = { ...goodDraft(), totals_note: "You have \\u20b93,750 pending." };
    const parsed = lib.parseGeminiResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(draft) }] } }] });
    expect(parsed.draft.totals_note).toBe("You have ₹3,750 pending.");
    expect(lib.checkGuardrails(parsed.draft, facts("AUTH001", "2026-01-01"))).toContain("mentions ₹3,750, which is not in FACTS");
  });

  it("reports API errors, blocks and truncation", () => {
    expect(lib.parseGeminiResponse({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } }).error_code).toBe("ai_unavailable");
    expect(lib.parseGeminiResponse({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }).error_code).toBe("ai_blocked");
    expect(lib.parseGeminiResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"subject": "Your' }] } }] }).error_message).toMatch(/MAX_TOKENS/);
  });
});

describe("checkGuardrails", () => {
  const f = facts("AUTH001", "2026-01-01");

  it("passes a grounded draft", () => {
    expect(lib.checkGuardrails(goodDraft(), f)).toEqual([]);
  });

  it("catches invented amounts, dates and quarters", () => {
    const d = goodDraft();
    d.payout_note = "Your ₹3,750 will be paid with the Q2 2026 payout by 15 Feb 2026.";
    const v = lib.checkGuardrails(d, f);
    expect(v).toContain("mentions ₹3,750, which is not in FACTS");
    expect(v).toContain("mentions the date 15 Feb 2026, which is not in FACTS");
    expect(v).toContain("mentions Q2 2026, which is not in FACTS");
  });

  it("only allows the next payout's quarter (not earlier cycles the model might invent context about)", () => {
    const d = goodDraft();
    d.book_notes[0].note = "₹3,570 is pending from sales up to Q3 2025.";
    expect(lib.checkGuardrails(d, f)).toContain("mentions Q3 2025, which is not in FACTS");
  });

  it("rejects multi-line preheaders (seen in testing: a stray line of unrelated text)", () => {
    const d = { ...goodDraft(), preheader: "Your summary:\nHappiness and how to get it" };
    expect(lib.checkGuardrails(d, f)).toContain("preheader must be a single line");
  });

  it("catches missing books, wrong greeting and placeholders", () => {
    const d = goodDraft();
    d.book_notes = [d.book_notes[0], { book_id: "BK999", note: "x" }];
    d.greeting = "Hi there,";
    d.closing = "Regards, [Your Name]";
    const v = lib.checkGuardrails(d, f);
    expect(v).toContain("book_notes is missing book_id(s): BK002");
    expect(v).toContain("book_notes has unknown book_id(s): BK999");
    expect(v).toContain('greeting must be "Dear Priya,"');
    expect(v).toContain("contains a placeholder");
  });

  it("enforces case-specific content", () => {
    const ananya = facts("AUTH003", "2026-10-07");
    const draft = {
      subject: "Your royalty summary", preheader: "Summary", greeting: "Dear Ananya,", opening: "Here is your summary as of 7 Oct 2026.",
      book_notes: [{ book_id: "BK005", note: "Between Two Temples has earned ₹2,546." }],
      totals_note: "You have earned ₹2,546 and ₹2,546 is pending.", payout_note: "We are looking into it.", production_note: "", closing: "Thanks.",
    };
    expect(lib.checkGuardrails(draft, ananya)).toContain("overdue royalties must say the finance team will update within 48 hours");

    const kavita = facts("AUTH009", "2026-10-07");
    const v = lib.checkGuardrails({ ...draft, greeting: "Dear Kavita,", book_notes: [{ book_id: "BK015", note: "In typesetting." }, { book_id: "BK016", note: "Pending." }] }, kavita);
    expect(v).toContain("must explain the ₹1,000 minimum payout");
    expect(v).toContain("production_note is required because a book is in production");
  });
});

describe("renderEmail", () => {
  it("renders figures from FACTS and escapes model text", () => {
    const f = facts("AUTH007", "2026-01-01");
    const draft = {
      ...goodDraft(),
      greeting: "Dear Sneha,",
      opening: "Thanks <script>alert(1)</script>",
      book_notes: f.books.map((b) => ({ book_id: b.book_id, note: `Note for ${b.title}` })),
      production_note: "Cover design is next.",
    };
    const email = lib.renderEmail(draft, f, { demo_mode: true, intended_recipient: "sneha.kulkarni@email.com" });
    expect(email.html).toContain("₹60,865"); // total earned, computed
    expect(email.html).toContain("₹7,865"); // total pending, computed
    expect(email.html).toContain("Stage 3 of 9: Cover Design · next: Typesetting");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("addressed to sneha.kulkarni@email.com");
    expect(email.text).toContain("BOOKS IN PRODUCTION");
  });
});

describe("composeNodeCode", () => {
  it("inlines only what a node needs, and the result runs", () => {
    const code = composeNodeCode("return decideDuplicate({ id: 1 }, [{ id: 1 }], 'n1');");
    expect(code).toContain("function decideDuplicate");
    expect(code).not.toContain("function renderEmail");
    expect(new Function(code)()).toMatchObject({ is_duplicate: false });
  });

  it("pulls in transitive dependencies", () => {
    const code = composeNodeCode("return computeFacts(request);");
    for (const name of ["assessBook", "royaltyCalendar", "formatLongDate", "POLICY", "BADGES"]) expect(code).toContain(name);
  });
});

describe("buildSubject", () => {
  it("is built from the computed totals, never by the model", () => {
    expect(lib.buildSubject(facts("AUTH002", "2026-10-07"))).toBe("Your BookLeaf royalty summary: ₹13,024 pending");
    expect(lib.buildSubject(facts("AUTH008", "2026-10-07"))).toBe("Your BookLeaf royalty summary: all royalties paid");
  });
});

describe("checkAmountPlacement", () => {
  it("rejects a real amount quoted in the wrong place (seen in testing)", () => {
    // Diya as of 1 Jan 2026: total pending is ₹4,115; ₹2,540 is one book's pending.
    const diya = facts("AUTH010", "2026-01-01");
    const draft = {
      preheader: "Your summary", greeting: "Dear Diya,", opening: "Here is your royalty summary as of 1 Jan 2026.",
      book_notes: [
        { book_id: "BK017", note: "Durga's Daughters has ₹2,540 pending." },
        { book_id: "BK018", note: "Howrah Nights has ₹2,540 pending." },
      ],
      totals_note: "You have earned ₹29,115, with ₹25,000 paid and ₹2,540 pending.",
      payout_note: "Royalties are calculated quarterly and paid within 45 days of the quarter ending; ₹2,540 is due by 14 Feb 2026. Our finance team will update you within 48 hours about Howrah Nights.",
      production_note: "", closing: "Thanks.",
    };
    const v = lib.checkGuardrails(draft, diya);
    expect(v).toContain("totals_note must state the total pending exactly (₹4,115)");
    expect(v).toContain("totals_note quotes ₹2,540, which is not one of the three totals");
    expect(v).toContain("the note for Howrah Nights quotes ₹2,540, which is not one of that book's figures");
  });
});
