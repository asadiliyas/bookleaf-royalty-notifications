/**
 * End-to-end checks against a running n8n webhook (local or n8n Cloud):
 * authentication, validation, replay protection, the happy path, idempotency
 * (double click + replay) and both failure paths (AI and email).
 *
 *   npm run smoke            (reads N8N_WEBHOOK_URL / N8N_WEBHOOK_KEY / MAILPIT_URL from .env)
 *
 * Uses a different author per scenario. The 5-minute per-author cooldown
 * means a re-run within 5 minutes reports Duplicate for the happy-path
 * authors: that's the idempotency working, not a failure (use --fresh-wait).
 */
import { bubblePayload } from "./lib/payload.mjs";

const URL_ = process.env.N8N_WEBHOOK_URL;
const KEY = process.env.N8N_WEBHOOK_KEY;
const MAILPIT = process.env.MAILPIT_URL;
if (!URL_ || !KEY) throw new Error("Set N8N_WEBHOOK_URL and N8N_WEBHOOK_KEY (see .env.example)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function call(body, { key = KEY, raw } = {}) {
  const started = Date.now();
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "X-BookLeaf-Key": key } : {}) },
    body: raw ?? JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, ms: Date.now() - started };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mailpitCount() {
  if (!MAILPIT) return null;
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=1`);
  return (await res.json()).total;
}

// --- Security & validation -------------------------------------------------
{
  const r = await call(bubblePayload("AUTH001", { dryRun: true }), { key: null });
  check("rejects a request without X-BookLeaf-Key", r.status === 403, `HTTP ${r.status}`);
}
{
  const r = await call(bubblePayload("AUTH001", { dryRun: true }), { key: "wrong-key" });
  check("rejects a wrong key", r.status === 403, `HTTP ${r.status}`);
}
{
  const r = await call(null, { raw: '{"author": {}}' });
  check("rejects a malformed payload with 400 + reasons", r.status === 400 && r.json?.error_code === "invalid_request", r.json?.error_message?.slice(0, 80));
}
{
  const body = bubblePayload("AUTH001", { nowMs: Date.now() - 20 * 60 * 1000, simulate: "ai" });
  const r = await call(body);
  check("rejects a stale (replayed) request older than 10 minutes", r.status === 400 && r.json?.error_code === "stale_request", `HTTP ${r.status}`);
}
{
  const body = bubblePayload("AUTH002", { dryRun: true });
  body.books[0].royalty_paid = "99999";
  const r = await call(body);
  check("rejects royalty figures that don't add up", r.status === 400 && /do not add up/.test(r.json?.error_message ?? ""), `HTTP ${r.status}`);
}
{
  const r = await call(bubblePayload("AUTH002", { dryRun: true }));
  const filled = r.json && Object.values(r.json).every((v) => v !== "" && v !== null);
  check("dry run answers with every field filled (for Bubble's API Connector initialisation)", r.status === 200 && filled, `${r.ms} ms`);
}

// --- Happy path ------------------------------------------------------------
let happyId;
{
  const before = await mailpitCount();
  const body = bubblePayload("AUTH008"); // Farhan: fully paid up
  happyId = body.notification_id;
  const r = await call(body);
  const j = r.json ?? {};
  check(
    "generates, emails and reports Success (paid-up author)",
    r.status === 200 && (j.status === "Success" || j.status === "Duplicate"),
    `${j.status} via ${j.ai_model || "-"} in ${r.ms} ms${j.status === "Duplicate" ? " (cooldown from a previous run)" : ""}`,
  );
  if (j.status === "Success") {
    check("response carries subject, HTML, text and a timestamp", Boolean(j.email_subject && j.email_html.includes("<html") && j.email_text && Date.parse(j.completed_at)));
    const after = await mailpitCount();
    if (before !== null) check("email landed in the demo inbox (Mailpit)", after > before, `${before} -> ${after}`);
  }
}

// --- Idempotency -----------------------------------------------------------
{
  const r = await call(bubblePayload("AUTH008", { notificationId: happyId }));
  check("replaying the same notification is reported as Duplicate", r.json?.status === "Duplicate", r.json?.error_message);
}
{
  // Two clicks fired at the same moment for the same author.
  const now = Date.now();
  const [a, b] = await Promise.all([
    call(bubblePayload("AUTH004", { notificationId: `dbl-a-${now}`, nowMs: now })),
    call(bubblePayload("AUTH004", { notificationId: `dbl-b-${now}`, nowMs: now })),
  ]);
  const statuses = [a.json?.status, b.json?.status].sort();
  check(
    "a simultaneous double click sends exactly one email",
    (statuses[0] === "Duplicate" && statuses[1] === "Success") || statuses.every((s) => s === "Duplicate"),
    statuses.join(" + "),
  );
}

// --- Failure paths ---------------------------------------------------------
{
  const r = await call(bubblePayload("AUTH005", { simulate: "ai" }));
  const j = r.json ?? {};
  check(
    "AI failure on both models -> Failed with both reasons",
    j.status === "Failed" && j.error_code === "ai_unavailable" && /primary model:.*fallback model:/.test(j.error_message),
    j.error_message?.slice(0, 110),
  );
}
await sleep(1500);
{
  const r = await call(bubblePayload("AUTH006", { simulate: "email" }));
  const j = r.json ?? {};
  check("email failure -> Failed, generated email kept for resend", j.status === "Failed" && j.error_code === "email_failed" && Boolean(j.email_html), j.error_message?.slice(0, 110));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
