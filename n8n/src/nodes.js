/**
 * One function per n8n Code node. The Code node itself is a 1-3 line call
 * (see scripts/workflow-spec.mjs) that passes n8n data in explicitly, so all
 * of the logic here is unit-tested outside n8n.
 *
 * Depends on: shared.js, response.js, royalty-facts.js, prompt.js,
 *             guardrails.js, render-email.js
 */

const SIMULATED_FAILURE_MODEL = "simulated-failure-model";
const ACTIVE_RUN_STATUSES = ["processing", "success"];

/** Dry run: answers with every response field filled, without calling AI or sending email. Used to initialise Bubble's API Connector. */
export function nodeDryRun(request, executionId, nowMs) {
  const facts = computeFacts(request);
  return {
    http_status: 200,
    response: buildResponse(
      {
        status: "Success",
        notification_id: request.notification_id,
        author_id: request.author.author_id,
        email_subject: "Dry run: your BookLeaf royalty summary",
        email_html: "<p>Dry run: no email was generated or sent.</p>",
        email_text: "Dry run: no email was generated or sent.",
        email_delivery: "disabled",
        intended_recipient: request.author.email,
        delivered_to: "nobody (dry run)",
        ai_model: "none (dry run)",
        ai_attempts: 0,
        prompt_version: PROMPT_VERSION,
        total_earned: facts.totals.earned,
        total_paid: facts.totals.paid,
        total_pending: facts.totals.pending,
        overdue_books: facts.overdue.count,
        escalated_to_finance: "no",
        duplicate_of: "none",
        error_code: "none",
        error_message: "none",
        n8n_execution_id: String(executionId),
        duration_ms: 1,
      },
      nowMs,
    ),
  };
}

/**
 * Idempotency, first-writer-wins: every run inserts its own row first, then
 * reads all runs for the author inside the cooldown window. The lowest row id
 * that is still processing or succeeded owns the author; anyone else is a
 * duplicate. Both racing executions see the same rows, so they agree on the
 * winner without needing an atomic lock. A replayed notification_id is always
 * a duplicate (rows are fetched for the whole replay window); only runs
 * started after `activeSinceMs` (the cooldown) block a new notification.
 * Failed runs don't block a retry.
 */
export function decideDuplicate(myRow, rows, notificationId, activeSinceMs) {
  const others = rows.filter((r) => r && r.id !== undefined && r.id !== myRow.id);
  const replay = others.find((r) => r.notification_id === notificationId && r.id < myRow.id);
  if (replay) {
    return { is_duplicate: true, duplicate_of: replay.notification_id, reason: "This notification was already processed (replayed request)." };
  }
  const earlierActive = others
    .filter((r) => r.id < myRow.id && ACTIVE_RUN_STATUSES.includes(r.status))
    .filter((r) => activeSinceMs === undefined || Number(r.started_at_ms) >= activeSinceMs)
    .sort((a, b) => a.id - b.id)[0];
  if (earlierActive) {
    return {
      is_duplicate: true,
      duplicate_of: earlierActive.notification_id,
      reason: `A royalty summary for this author is already ${earlierActive.status === "success" ? "sent" : "in progress"} (notification ${earlierActive.notification_id}).`,
    };
  }
  return { is_duplicate: false, duplicate_of: "", reason: "" };
}

export function nodeDuplicateResponse(request, decision, executionId, startedMs, nowMs) {
  return {
    http_status: 200,
    response: buildResponse(
      {
        status: "Duplicate",
        notification_id: request.notification_id,
        author_id: request.author.author_id,
        duplicate_of: decision.duplicate_of,
        error_code: "duplicate",
        error_message: decision.reason,
        n8n_execution_id: String(executionId),
        duration_ms: nowMs - startedMs,
      },
      nowMs,
    ),
  };
}

export function nodeBuildPrimaryRequest(facts, request, config) {
  const model = request.simulate_failure === "ai" ? SIMULATED_FAILURE_MODEL : config.primary_model;
  return { attempt: 1, ...buildGeminiRequest(facts, { model }) };
}

/** Parses + checks one Gemini answer. Output feeds an IF node on `ok`. */
export function nodeCheckAiOutput(geminiResponse, facts, model, attempt) {
  const parsed = parseGeminiResponse(geminiResponse);
  if (!parsed.ok) return { ok: false, model, attempt, error_code: parsed.error_code, error_message: parsed.error_message, violations: [] };
  const violations = checkGuardrails(parsed.draft, facts);
  if (violations.length) {
    return {
      ok: false,
      model,
      attempt,
      error_code: "ai_output_invalid",
      error_message: `Draft failed ${violations.length} check(s): ${violations.join("; ")}`,
      violations,
    };
  }
  return { ok: true, model, attempt, draft: parsed.draft, usage: parsed.usage };
}

/**
 * Fallback attempt on a different model family. `primary` is either the
 * failed check (with violations to correct) or the HTTP node's error item.
 */
export function nodeBuildFallbackRequest(primary, facts, request, config) {
  const primaryFailure = describeFailure(primary);
  const model = request.simulate_failure === "ai" ? SIMULATED_FAILURE_MODEL : config.fallback_model;
  return {
    attempt: 2,
    primary_failure: primaryFailure,
    ...buildGeminiRequest(facts, { model, violations: (primary && primary.violations) || [] }),
  };
}

/** Normalises an error item from any node (HTTP error output, failed check, email error). */
export function describeFailure(item) {
  if (!item) return { error_code: "unknown", error_message: "Unknown failure" };
  if (item.error_code) return { error_code: item.error_code, error_message: item.error_message || "" };
  const err = item.error;
  if (err) {
    const message = typeof err === "string" ? err : [err.message, err.description].filter(Boolean).join(" - ") || JSON.stringify(err);
    const httpCode = typeof err === "object" ? err.httpCode || err.status || "" : "";
    return { error_code: "ai_unavailable", error_message: `${httpCode ? `HTTP ${httpCode}: ` : ""}${message}` };
  }
  return { error_code: "unknown", error_message: JSON.stringify(item).slice(0, 300) };
}

export function nodeRenderEmail(check, facts, request, config) {
  const demoMode = config.demo_mode !== false;
  const intended = request.author.email;
  let to = demoMode ? config.demo_recipient : intended;
  if (request.simulate_failure === "email") to = "not-a-valid-recipient";
  const email = renderEmail(check.draft, facts, { demo_mode: demoMode, intended_recipient: intended });
  return {
    to,
    from: config.from_email,
    reply_to: config.reply_to || "",
    intended_recipient: intended,
    subject: email.subject,
    html: email.html,
    text: email.text,
    ai_model: check.model,
    ai_attempts: check.attempt,
    needs_finance_alert: Boolean(facts.escalation),
  };
}

export function nodeFinanceAlert(facts, request, executionId) {
  const rows = facts.books
    .filter((b) => b.state === "overdue")
    .map((b) => `<li>${escapeHtml(b.title)} (${escapeHtml(b.book_id)}): ${formatInr(b.royalty_pending)} pending, ${escapeHtml(b.overdue_reason)}</li>`)
    .join("");
  return {
    subject: `[Finance] Overdue royalties: ${request.author.name} (${request.author.author_id}), ${formatInr(facts.overdue.total)}`,
    html: `<p>The royalty summary sent to <strong>${escapeHtml(request.author.name)}</strong> (${escapeHtml(request.author.email)}) told them the finance team will update them within ${POLICY.financeResponseHours} hours.</p>
<ul>${rows}</ul>
<p>Figures as of ${facts.as_of_label}. Bubble notification ${escapeHtml(request.notification_id)}, n8n execution ${escapeHtml(String(executionId))}.</p>`,
  };
}

export function nodeSuccessResponse({ request, facts, rendered, emailSent, emailEnabled, executionId, startedMs, nowMs }) {
  return {
    http_status: 200,
    response: buildResponse(
      {
        status: "Success",
        notification_id: request.notification_id,
        author_id: request.author.author_id,
        email_subject: rendered.subject,
        email_html: rendered.html,
        email_text: rendered.text,
        email_delivery: emailEnabled ? (emailSent ? "sent" : "failed") : "disabled",
        intended_recipient: rendered.intended_recipient,
        delivered_to: emailEnabled && emailSent ? rendered.to : "",
        ai_model: rendered.ai_model,
        ai_attempts: rendered.ai_attempts,
        prompt_version: PROMPT_VERSION,
        total_earned: facts.totals.earned,
        total_paid: facts.totals.paid,
        total_pending: facts.totals.pending,
        overdue_books: facts.overdue.count,
        escalated_to_finance: facts.escalation ? "yes" : "no",
        n8n_execution_id: String(executionId),
        duration_ms: nowMs - startedMs,
      },
      nowMs,
    ),
  };
}

/**
 * Works out why the run failed from what has executed. `ran` tells whether a
 * node produced output; `current` is the item that arrived at the failure
 * branch (HTTP error item, failed check, or email error item).
 */
export function classifyFailure({ current, emailAttempted, primaryFailure, fallbackCheck }) {
  if (emailAttempted) {
    const f = describeFailure(current);
    return { error_code: "email_failed", error_message: `AI summary was generated but the email could not be sent: ${f.error_message}` };
  }
  const fallback = fallbackCheck || describeFailure(current);
  const parts = [];
  if (primaryFailure) parts.push(`primary model: ${primaryFailure.error_message}`);
  parts.push(`fallback model: ${fallback.error_message}`);
  return { error_code: fallback.error_code || "ai_unavailable", error_message: parts.join(" | ") };
}

export function nodeFailureResponse({ request, failure, facts, rendered, executionId, startedMs, nowMs }) {
  return {
    http_status: 200,
    response: buildResponse(
      {
        status: "Failed",
        notification_id: request.notification_id,
        author_id: request.author.author_id,
        // Keep the generated email when only delivery failed, so it can be resent.
        email_subject: rendered ? rendered.subject : "",
        email_html: rendered ? rendered.html : "",
        email_text: rendered ? rendered.text : "",
        email_delivery: rendered ? "failed" : "not_attempted",
        intended_recipient: request.author.email,
        ai_model: rendered ? rendered.ai_model : "",
        ai_attempts: rendered ? rendered.ai_attempts : 2,
        prompt_version: PROMPT_VERSION,
        total_earned: facts ? facts.totals.earned : 0,
        total_paid: facts ? facts.totals.paid : 0,
        total_pending: facts ? facts.totals.pending : 0,
        overdue_books: facts ? facts.overdue.count : 0,
        error_code: failure.error_code,
        error_message: failure.error_message,
        n8n_execution_id: String(executionId),
        duration_ms: nowMs - startedMs,
      },
      nowMs,
    ),
  };
}

/** Error workflow: turns n8n's Error Trigger payload into an ops alert. */
export function nodeFormatCrashAlert(errorEvent) {
  const ex = (errorEvent && errorEvent.execution) || {};
  const wf = (errorEvent && errorEvent.workflow) || {};
  const err = ex.error || {};
  const lastNode = ex.lastNodeExecuted || "unknown node";
  return {
    execution_id: String(ex.id || ""),
    subject: `[n8n] ${wf.name || "Workflow"} crashed at "${lastNode}"`,
    html: `<p><strong>${escapeHtml(wf.name || "Workflow")}</strong> stopped unexpectedly.</p>
<ul>
<li>Execution: ${escapeHtml(String(ex.id || "n/a"))} (${escapeHtml(ex.mode || "")})</li>
<li>Last node: ${escapeHtml(lastNode)}</li>
<li>Error: ${escapeHtml(err.message || "n/a")}</li>
</ul>
<p>${ex.url ? `<a href="${escapeHtml(ex.url)}">Open the execution</a>. ` : ""}Bubble received an HTTP 500 for this request and marked the notification Failed.</p>`,
    error_message: String(err.message || "Unknown error").slice(0, 500),
    last_node: lastNode,
  };
}
