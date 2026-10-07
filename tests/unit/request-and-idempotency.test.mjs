import { describe, expect, it } from "vitest";
import { loadAll } from "../../scripts/lib/compose.mjs";
import { bubblePayload } from "../../scripts/lib/payload.mjs";

const lib = loadAll();
const CONFIG = { timezone: "Asia/Kolkata", max_request_age_minutes: 10, allow_failure_simulation: true };
const NOW = Date.parse("2026-10-07T10:00:00Z");

describe("validateRequest", () => {
  it("accepts Bubble's all-strings payload and parses it", () => {
    const v = lib.validateRequest(bubblePayload("AUTH002", { nowMs: NOW }), CONFIG, NOW);
    expect(v.ok).toBe(true);
    expect(v.request.as_of).toBe("2026-10-07");
    expect(v.request.books[1]).toMatchObject({
      book_id: "BK004",
      is_published: true,
      royalty_pending: 7744,
      publication_date: "2024-05-22",
      last_payout_date: "2025-11-15",
      available_on: ["Amazon India", "Flipkart", "Amazon US", "Amazon UK", "BookLeaf Store"],
    });
  });

  it("accepts books sent as a JSON string", () => {
    const body = bubblePayload("AUTH001", { nowMs: NOW });
    body.books = JSON.stringify(body.books);
    expect(lib.validateRequest(body, CONFIG, NOW).ok).toBe(true);
  });

  it("rejects stale requests (replay protection)", () => {
    const body = bubblePayload("AUTH001", { nowMs: NOW - 11 * 60 * 1000 });
    const v = lib.validateRequest(body, CONFIG, NOW);
    expect(v.ok).toBe(false);
    expect(v.http_status).toBe(400);
    expect(v.response).toMatchObject({ status: "Failed", error_code: "stale_request" });
  });

  it("rejects missing identifiers and figures that don't add up", () => {
    const body = bubblePayload("AUTH001", { nowMs: NOW });
    delete body.notification_id;
    body.author.email = "not-an-email";
    body.books[0].royalty_paid = "9000";
    const v = lib.validateRequest(body, CONFIG, NOW);
    expect(v.ok).toBe(false);
    expect(v.response.error_code).toBe("invalid_request");
    expect(v.errors.join("\n")).toMatch(/notification_id/);
    expect(v.errors.join("\n")).toMatch(/author.email/);
    expect(v.errors.join("\n")).toMatch(/BK001.*do not add up/);
  });

  it("ignores failure simulation unless the workflow allows it", () => {
    const body = bubblePayload("AUTH001", { nowMs: NOW, simulate: "ai" });
    expect(lib.validateRequest(body, CONFIG, NOW).request.simulate_failure).toBe("ai");
    expect(lib.validateRequest(body, { ...CONFIG, allow_failure_simulation: false }, NOW).request.simulate_failure).toBe("");
  });

  it("always answers with the full response shape", () => {
    const v = lib.validateRequest({}, CONFIG, NOW);
    expect(Object.keys(v.response).sort()).toEqual(Object.keys(lib.RESPONSE_TEMPLATE).sort());
  });
});

describe("decideDuplicate (first writer wins)", () => {
  const row = (id, notification_id, status) => ({ id, notification_id, status });

  it("lets the first run through", () => {
    const me = row(5, "n5", "processing");
    expect(lib.decideDuplicate(me, [me], "n5").is_duplicate).toBe(false);
  });

  it("blocks a second click while the first is processing or after it succeeded", () => {
    const me = row(6, "n6", "processing");
    expect(lib.decideDuplicate(me, [row(5, "n5", "processing"), me], "n6")).toMatchObject({ is_duplicate: true, duplicate_of: "n5" });
    expect(lib.decideDuplicate(me, [row(5, "n5", "success"), me], "n6").reason).toMatch(/already sent/);
  });

  it("two racing runs agree: the lower id wins", () => {
    const first = row(7, "n7", "processing");
    const second = row(8, "n8", "processing");
    const rows = [first, second];
    expect(lib.decideDuplicate(first, rows, "n7").is_duplicate).toBe(false);
    expect(lib.decideDuplicate(second, rows, "n8").is_duplicate).toBe(true);
  });

  it("only runs inside the cooldown block a new notification", () => {
    const me = { ...row(12, "n12", "processing"), started_at_ms: 10_000 };
    const old = { ...row(11, "n11", "success"), started_at_ms: 1_000 };
    expect(lib.decideDuplicate(me, [old, me], "n12", 5_000).is_duplicate).toBe(false);
    expect(lib.decideDuplicate(me, [old, me], "n12", 500).is_duplicate).toBe(true);
  });

  it("allows a retry after a failure, but never a replay of the same notification", () => {
    const me = row(9, "n9", "processing");
    expect(lib.decideDuplicate(me, [row(4, "n4", "failed"), me], "n9").is_duplicate).toBe(false);
    const replay = row(10, "n4", "processing");
    expect(lib.decideDuplicate(replay, [row(4, "n4", "failed"), replay], "n4").reason).toMatch(/replayed/);
  });
});

describe("failure classification", () => {
  it("reports both AI attempts", () => {
    const failure = lib.classifyFailure({
      current: { error: { message: "The resource you are requesting could not be found", httpCode: "404" } },
      emailAttempted: false,
      primaryFailure: { error_code: "ai_unavailable", error_message: "HTTP 503: overloaded" },
    });
    expect(failure.error_code).toBe("ai_unavailable");
    expect(failure.error_message).toBe("primary model: HTTP 503: overloaded | fallback model: HTTP 404: The resource you are requesting could not be found");
  });

  it("separates email delivery failures from AI failures", () => {
    const failure = lib.classifyFailure({ current: { error: { message: "Invalid login" } }, emailAttempted: true });
    expect(failure.error_code).toBe("email_failed");
  });
});

describe("dry runs", () => {
  it("are exempt from the replay window (fixed sample values for Bubble's API Connector)", () => {
    const body = bubblePayload("AUTH001", { nowMs: NOW - 24 * 60 * 60 * 1000, dryRun: true });
    expect(lib.validateRequest(body, CONFIG, NOW).ok).toBe(true);
  });
});
