/**
 * Declarative definition of the two n8n workflows. scripts/build-workflows.mjs
 * turns this into importable JSON (n8n 2.x node versions), inlining the
 * tested logic from n8n/src into the Code nodes.
 */
import { createHash } from "node:crypto";
import { composeNodeCode } from "./lib/compose.mjs";

export const MAIN_WORKFLOW_ID = "BkLfRoyaltySumry";
export const ERROR_WORKFLOW_ID = "BkLfErrorHandler";
export const RUNS_TABLE = "royalty_summary_runs";
export const WEBHOOK_PATH = "bookleaf/royalty-summary";

export const CREDENTIALS = {
  webhookKey: { id: "BkLfWebhookKey01", name: "BookLeaf webhook key (X-BookLeaf-Key)" },
  gemini: { id: "BkLfGeminiApi001", name: "Gemini API (free tier)" },
  smtp: { id: "BkLfSmtpGmail001", name: "BookLeaf SMTP (Gmail)" },
};

const uuid = (seed) => {
  const h = createHash("md5").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------
const node = (wf, name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters,
  id: uuid(`${wf}:${name}`),
  name,
  type,
  typeVersion,
  position,
  ...extra,
});

const code = (wf, name, position, entry, extra) =>
  node(wf, name, "n8n-nodes-base.code", 2, position, { mode: "runOnceForAllItems", language: "javaScript", jsCode: composeNodeCode(entry) }, extra);

const ifTrue = (wf, name, position, leftExpr) =>
  node(wf, name, "n8n-nodes-base.if", 2.3, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 3 },
      conditions: [{ id: uuid(`${wf}:${name}:cond`), leftValue: leftExpr, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }],
      combinator: "and",
    },
    looseTypeValidation: true,
    options: {},
  });

const respond = (wf, name, position) =>
  node(wf, name, "n8n-nodes-base.respondToWebhook", 1.5, position, {
    respondWith: "json",
    responseBody: "={{ JSON.stringify($json.response) }}",
    options: { responseCode: "={{ $json.http_status }}" },
  });

const table = { __rl: true, mode: "name", value: RUNS_TABLE };
const col = (id, type) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type, canBeUsedToMatch: true });
const RUN_COLUMNS = [
  ["notification_id", "string"],
  ["author_id", "string"],
  ["trigger_type", "string"],
  ["status", "string"],
  ["started_at_ms", "number"],
  ["finished_at_ms", "number"],
  ["execution_id", "string"],
  ["ai_model", "string"],
  ["email_delivery", "string"],
  ["error_code", "string"],
  ["duplicate_of", "string"],
];

const tableUpdate = (wf, name, position, value) =>
  node(
    wf,
    name,
    "n8n-nodes-base.dataTable",
    1.1,
    position,
    {
      resource: "row",
      operation: "update",
      dataTableId: table,
      matchType: "allConditions",
      filters: { conditions: [{ keyName: "id", condition: "eq", keyValue: "={{ $('Record run start').first().json.id }}" }] },
      columns: {
        mappingMode: "defineBelow",
        value,
        matchingColumns: [],
        schema: Object.keys(value).map((k) => col(k, RUN_COLUMNS.find(([c]) => c === k)[1])),
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {},
    },
    // Bookkeeping must never stop Bubble from getting its answer.
    { alwaysOutputData: true, onError: "continueRegularOutput" },
  );

const sendEmail = (wf, name, position, params, extra) =>
  node(
    wf,
    name,
    "n8n-nodes-base.emailSend",
    2.1,
    position,
    { resource: "email", operation: "send", emailFormat: "both", ...params, options: { appendAttribution: false, ...(params.options || {}) } },
    { credentials: { smtp: CREDENTIALS.smtp }, ...extra },
  );

const sticky = (wf, name, position, width, height, content, color) =>
  node(wf, name, "n8n-nodes-base.stickyNote", 1, position, { content, height, width, color });

const configNode = (wf, position, cfg) =>
  node(wf, "Config", "n8n-nodes-base.set", 3.5, position, {
    mode: "manual",
    assignments: {
      assignments: Object.entries(cfg).map(([name, value]) => ({
        id: uuid(`${wf}:config:${name}`),
        name,
        value,
        type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string",
      })),
    },
    includeOtherFields: false,
    options: {},
  });

const geminiCall = (wf, name, position) =>
  node(
    wf,
    name,
    "n8n-nodes-base.httpRequest",
    4.5,
    position,
    {
      method: "POST",
      url: "={{ $json.url }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googlePalmApi",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.body) }}",
      options: { timeout: 25000 },
    },
    {
      credentials: { googlePalmApi: CREDENTIALS.gemini },
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 2000,
      onError: "continueErrorOutput",
    },
  );

// Shared snippets used inside Code node entries.
const RAN = "const ran = (name) => { try { return $(name).isExecuted; } catch (e) { return false; } };";
const REQ = "const { request, started_ms } = $('Validate request').first().json;";
const CFG = "const config = $('Config').first().json;";
const FACTS = "const { facts } = $('Compute royalty facts').first().json;";

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------
export function mainWorkflow(cfg) {
  const W = "main";
  const X = (col) => col * 230;
  const Y = (row) => 300 + row * 190;

  const nodes = [
    sticky(W, "Note: receive", [X(0) - 40, Y(-1) - 40], 940, 600,
      "## 1 · Receive & validate\nBubble calls this webhook from a **backend workflow** (never the browser).\n- **Header auth:** `X-BookLeaf-Key` must match the credential, otherwise n8n answers 403 before the workflow runs.\n- **Validate request** rejects malformed payloads, figures that don't add up (earned ≠ paid + pending) and requests older than 10 min (replay protection) with HTTP 400.\n- Bubble sends the **full author + books payload**: Bubble's free plan has no Data API, and this keeps the Bubble admin token out of n8n.",
      7),
    node(W, "Bubble webhook", "n8n-nodes-base.webhook", 2.2, [X(0), Y(0)], {
      httpMethod: "POST",
      path: WEBHOOK_PATH,
      authentication: "headerAuth",
      responseMode: "responseNode",
      options: {},
    }, { webhookId: uuid("bookleaf-royalty-webhook"), credentials: { httpHeaderAuth: CREDENTIALS.webhookKey } }),
    configNode(W, [X(1), Y(0)], cfg),
    code(W, "Validate request", [X(2), Y(0)],
      `${CFG}\nreturn [{ json: { ...validateRequest($('Bubble webhook').first().json.body, config, Date.now()), started_ms: Date.now() } }];`),
    ifTrue(W, "Request valid?", [X(3), Y(0)], "={{ $json.ok }}"),
    respond(W, "Respond · rejected", [X(4), Y(1)]),
    node(W, "Tag execution", "n8n-nodes-base.executionData", 1.1, [X(4), Y(-1) + 60], {
      dataToSave: {
        values: [
          { key: "notification_id", value: "={{ $json.request.notification_id }}" },
          { key: "author_id", value: "={{ $json.request.author.author_id }}" },
          { key: "trigger_type", value: "={{ $json.request.trigger_type }}" },
        ],
      },
    }),
    ifTrue(W, "Dry run?", [X(5), Y(-1) + 60], "={{ $('Validate request').first().json.request.dry_run }}"),
    code(W, "Build dry-run response", [X(6), Y(-2) + 60], `${REQ}\nreturn [{ json: nodeDryRun(request, $execution.id, Date.now()) }];`),
    respond(W, "Respond · dry run", [X(7), Y(-2) + 60]),

    sticky(W, "Note: idempotency", [X(6) - 40, Y(-1) + 160], 1180, 470,
      "## 2 · Idempotency (first writer wins)\nEvery run **inserts its own row first**, then reads all runs for the same author. The lowest row id that is still *processing* or already *succeeded* within the cooldown owns the author; later runs answer **Duplicate**. Two racing double-clicks see the same rows, so they agree on the winner without an atomic lock. A replayed `notification_id` is always a duplicate. Failed runs never block a retry.\nThe table is created automatically on first run (n8n Data Tables).",
      5),
    node(W, "Ensure runs table", "n8n-nodes-base.dataTable", 1.1, [X(6), Y(0)], {
      resource: "table",
      operation: "create",
      tableName: RUNS_TABLE,
      columns: { column: RUN_COLUMNS.map(([name, type]) => ({ name, type })) },
      options: { createIfNotExists: true },
    }),
    node(W, "Record run start", "n8n-nodes-base.dataTable", 1.1, [X(7), Y(0)], {
      resource: "row",
      operation: "insert",
      dataTableId: table,
      columns: {
        mappingMode: "defineBelow",
        value: {
          notification_id: "={{ $('Validate request').first().json.request.notification_id }}",
          author_id: "={{ $('Validate request').first().json.request.author.author_id }}",
          trigger_type: "={{ $('Validate request').first().json.request.trigger_type }}",
          status: "processing",
          started_at_ms: "={{ Date.now() }}",
          execution_id: "={{ $execution.id }}",
        },
        matchingColumns: [],
        schema: RUN_COLUMNS.map(([id, type]) => col(id, type)),
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {},
    }),
    node(W, "Find recent runs for author", "n8n-nodes-base.dataTable", 1.1, [X(8), Y(0)], {
      resource: "row",
      operation: "get",
      dataTableId: table,
      matchType: "allConditions",
      filters: {
        conditions: [
          { keyName: "author_id", condition: "eq", keyValue: "={{ $('Validate request').first().json.request.author.author_id }}" },
          {
            keyName: "started_at_ms",
            condition: "gte",
            keyValue: "={{ Date.now() - Math.max($('Config').first().json.cooldown_minutes, $('Config').first().json.max_request_age_minutes) * 60000 }}",
          },
        ],
      },
      returnAll: true,
      orderBy: true,
      orderByColumn: "id",
      orderByDirection: "ASC",
    }, { alwaysOutputData: true }),
    code(W, "Check for duplicate", [X(9), Y(0)],
      `${REQ}\n${CFG}\nconst myRow = $('Record run start').first().json;\nconst rows = $input.all().map((i) => i.json);\nconst activeSinceMs = Date.now() - config.cooldown_minutes * 60000;\nreturn [{ json: decideDuplicate(myRow, rows, request.notification_id, activeSinceMs) }];`),
    ifTrue(W, "Is duplicate?", [X(10), Y(0)], "={{ $json.is_duplicate }}"),
    tableUpdate(W, "Mark run duplicate", [X(11), Y(-1) + 60], {
      status: "duplicate",
      duplicate_of: "={{ $('Check for duplicate').first().json.duplicate_of }}",
      finished_at_ms: "={{ Date.now() }}",
    }),
    code(W, "Build duplicate response", [X(12), Y(-1) + 60],
      `${REQ}\nconst decision = $('Check for duplicate').first().json;\nreturn [{ json: nodeDuplicateResponse(request, decision, $execution.id, started_ms, Date.now()) }];`),
    respond(W, "Respond · duplicate", [X(13), Y(-1) + 60]),

    sticky(W, "Note: ai", [X(11) - 40, Y(0) + 110], 1640, 640,
      "## 3 · Facts → Gemini → guardrails\n**The model writes words, code writes numbers.** *Compute royalty facts* works out every amount, date, quarter and case (paid up / scheduled / overdue / never paid / below ₹1,000 / in production) from the KB policy: quarterly cycle, 45-day window, ₹1,000 minimum, 90-day overdue rule.\nGemini returns JSON (one field per email section); *Check AI output* rejects any ₹ amount, date or quarter not in FACTS, a missing book, or a missing case (e.g. no 48-hour finance update when overdue).\n**Resilience:** each call retries once (2 s), then a **different model family** is tried with the rejected draft's violations fed back. If both fail → failure path.",
      4),
    code(W, "Compute royalty facts", [X(11), Y(1) + 60], `${REQ}\nreturn [{ json: { facts: computeFacts(request) } }];`),
    code(W, "Build Gemini request · primary", [X(12), Y(1) + 60], `${REQ}\n${CFG}\n${FACTS}\nreturn [{ json: nodeBuildPrimaryRequest(facts, request, config) }];`),
    geminiCall(W, "Gemini · primary model", [X(13), Y(1) + 60]),
    code(W, "Check AI output · primary", [X(14), Y(1)],
      `${FACTS}\nconst req = $('Build Gemini request · primary').first().json;\nreturn [{ json: nodeCheckAiOutput($input.first().json, facts, req.model, req.attempt) }];`),
    ifTrue(W, "Primary draft OK?", [X(15), Y(1)], "={{ $json.ok }}"),
    code(W, "Build Gemini request · fallback", [X(15), Y(2) + 60],
      `${REQ}\n${CFG}\n${FACTS}\nreturn [{ json: nodeBuildFallbackRequest($input.first().json, facts, request, config) }];`),
    geminiCall(W, "Gemini · fallback model", [X(16), Y(2) + 60]),
    code(W, "Check AI output · fallback", [X(17), Y(2)],
      `${FACTS}\nconst req = $('Build Gemini request · fallback').first().json;\nreturn [{ json: nodeCheckAiOutput($input.first().json, facts, req.model, req.attempt) }];`),
    ifTrue(W, "Fallback draft OK?", [X(18), Y(2)], "={{ $json.ok }}"),

    sticky(W, "Note: deliver", [X(17) - 40, Y(-1) + 160], 1630, 470,
      "## 4 · Deliver & answer Bubble\n*Render email* builds HTML + text (figures from FACTS, prose from Gemini). In **demo mode** every email goes to the demo inbox (the dataset's addresses are real-looking `email.com` mailboxes); the intended recipient is shown in the email and logged.\nIf any book is overdue, the finance team gets an alert, which makes the email's 48-hour promise real.\nThe run is recorded in the Data Table, then **Respond · result** returns the outcome, email content and timestamps to Bubble, which writes them to its Notification Log.",
      6),
    code(W, "Render email", [X(19), Y(0)], `${REQ}\n${CFG}\n${FACTS}\nreturn [{ json: nodeRenderEmail($input.first().json, facts, request, config) }];`),
    ifTrue(W, "Email enabled?", [X(20), Y(0)], "={{ $('Config').first().json.email_enabled }}"),
    sendEmail(W, "Send summary email", [X(21), Y(-1) + 60], {
      fromEmail: "={{ $json.from }}",
      toEmail: "={{ $json.to }}",
      subject: "={{ $json.subject }}",
      text: "={{ $json.text }}",
      html: "={{ $json.html }}",
      options: { replyTo: "={{ $json.reply_to }}" },
    }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: "continueErrorOutput" }),
    ifTrue(W, "Overdue royalties?", [X(22), Y(-1) + 60], "={{ $('Render email').first().json.needs_finance_alert }}"),
    code(W, "Build finance alert", [X(23), Y(-2) + 60], `${REQ}\n${FACTS}\nreturn [{ json: nodeFinanceAlert(facts, request, $execution.id) }];`),
    sendEmail(W, "Alert finance team", [X(24), Y(-2) + 60], {
      fromEmail: "={{ $('Config').first().json.from_email }}",
      toEmail: "={{ $('Config').first().json.finance_alert_recipient }}",
      subject: "={{ $json.subject }}",
      emailFormat: "html",
      html: "={{ $json.html }}",
    }, { onError: "continueRegularOutput" }),
    tableUpdate(W, "Record run success", [X(25), Y(0)], {
      status: "success",
      finished_at_ms: "={{ Date.now() }}",
      ai_model: "={{ $('Render email').first().json.ai_model }}",
      email_delivery: "={{ $('Config').first().json.email_enabled ? 'sent' : 'disabled' }}",
    }),
    code(W, "Build success response", [X(26), Y(0)],
      `${RAN}\n${REQ}\n${CFG}\n${FACTS}\nconst rendered = $('Render email').first().json;\nconst emailEnabled = config.email_enabled === true;\nreturn [{ json: nodeSuccessResponse({ request, facts, rendered, emailEnabled, emailSent: emailEnabled && ran('Send summary email'), executionId: $execution.id, startedMs: started_ms, nowMs: Date.now() }) }];`),
    respond(W, "Respond · result", [X(27), Y(1)]),

    sticky(W, "Note: failure", [X(19) - 40, Y(2) + 110], 1630, 380,
      "## 5 · Failure path (never silent)\nReached when both Gemini models fail, both drafts fail the guardrails, or SMTP rejects the email. *Classify failure* names the cause (`ai_unavailable`, `ai_output_invalid`, `email_failed`) with both attempts' errors; the run is marked failed and Bubble gets **status: Failed** with the reason (the generated email is kept when only delivery failed, so it can be resent).\nAnything unexpected (a crash) triggers the **BookLeaf · Error handler** workflow, and Bubble receives HTTP 500.",
      3),
    code(W, "Classify failure", [X(20), Y(3)],
      `${RAN}\nconst current = $input.first().json;\nconst primaryFailure = ran('Build Gemini request · fallback') ? $('Build Gemini request · fallback').first().json.primary_failure : null;\nlet fallbackCheck = null;\nif (ran('Check AI output · fallback')) {\n  const c = $('Check AI output · fallback').first().json;\n  if (!c.ok) fallbackCheck = { error_code: c.error_code, error_message: c.error_message };\n}\nreturn [{ json: classifyFailure({ current, emailAttempted: ran('Send summary email'), primaryFailure, fallbackCheck }) }];`),
    tableUpdate(W, "Record run failure", [X(21), Y(3)], {
      status: "failed",
      finished_at_ms: "={{ Date.now() }}",
      error_code: "={{ $('Classify failure').first().json.error_code }}",
    }),
    code(W, "Build failure response", [X(22), Y(3)],
      `${RAN}\n${REQ}\nconst failure = $('Classify failure').first().json;\nconst facts = ran('Compute royalty facts') ? $('Compute royalty facts').first().json.facts : null;\nconst rendered = ran('Render email') ? $('Render email').first().json : null;\nreturn [{ json: nodeFailureResponse({ request, failure, facts, rendered, executionId: $execution.id, startedMs: started_ms, nowMs: Date.now() }) }];`),
  ];

  const c = (from, ...targets) => [from, targets];
  const connections = buildConnections([
    c("Bubble webhook", ["Config"]),
    c("Config", ["Validate request"]),
    c("Validate request", ["Request valid?"]),
    c("Request valid?", ["Tag execution"], ["Respond · rejected"]),
    c("Tag execution", ["Dry run?"]),
    c("Dry run?", ["Build dry-run response"], ["Ensure runs table"]),
    c("Build dry-run response", ["Respond · dry run"]),
    c("Ensure runs table", ["Record run start"]),
    c("Record run start", ["Find recent runs for author"]),
    c("Find recent runs for author", ["Check for duplicate"]),
    c("Check for duplicate", ["Is duplicate?"]),
    c("Is duplicate?", ["Mark run duplicate"], ["Compute royalty facts"]),
    c("Mark run duplicate", ["Build duplicate response"]),
    c("Build duplicate response", ["Respond · duplicate"]),
    c("Compute royalty facts", ["Build Gemini request · primary"]),
    c("Build Gemini request · primary", ["Gemini · primary model"]),
    c("Gemini · primary model", ["Check AI output · primary"], ["Build Gemini request · fallback"]),
    c("Check AI output · primary", ["Primary draft OK?"]),
    c("Primary draft OK?", ["Render email"], ["Build Gemini request · fallback"]),
    c("Build Gemini request · fallback", ["Gemini · fallback model"]),
    c("Gemini · fallback model", ["Check AI output · fallback"], ["Classify failure"]),
    c("Check AI output · fallback", ["Fallback draft OK?"]),
    c("Fallback draft OK?", ["Render email"], ["Classify failure"]),
    c("Render email", ["Email enabled?"]),
    c("Email enabled?", ["Send summary email"], ["Record run success"]),
    c("Send summary email", ["Overdue royalties?"], ["Classify failure"]),
    c("Overdue royalties?", ["Build finance alert"], ["Record run success"]),
    c("Build finance alert", ["Alert finance team"]),
    c("Alert finance team", ["Record run success"]),
    c("Record run success", ["Build success response"]),
    c("Build success response", ["Respond · result"]),
    c("Classify failure", ["Record run failure"]),
    c("Record run failure", ["Build failure response"]),
    c("Build failure response", ["Respond · result"]),
  ]);

  return {
    id: MAIN_WORKFLOW_ID,
    name: "BookLeaf · Royalty Summary (Bubble → Gemini → Email)",
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      timezone: "Asia/Kolkata",
      saveDataErrorExecution: "all",
      saveDataSuccessExecution: "all",
      saveManualExecutions: true,
      saveExecutionProgress: true,
      callerPolicy: "workflowsFromSameOwner",
      errorWorkflow: ERROR_WORKFLOW_ID,
    },
    pinData: {},
    meta: { templateCredsSetupCompleted: true },
    tags: [],
  };
}

// ---------------------------------------------------------------------------
// Error workflow: catches crashes the main workflow's error branches can't.
// ---------------------------------------------------------------------------
export function errorWorkflow(cfg) {
  const W = "error";
  const nodes = [
    sticky(W, "Note: error handler", [-40, 80], 1180, 420,
      "## BookLeaf · Error handler\nSet as the **Error workflow** of *BookLeaf · Royalty Summary* (Workflow settings). Runs only when the main workflow crashes in a way its own error branches don't handle (for example a bug or an n8n outage mid-run). Bubble already got an HTTP 500 and marked the notification Failed; this marks the run as crashed in the Data Table and emails ops with a link to the execution.",
      3),
    node(W, "Error Trigger", "n8n-nodes-base.errorTrigger", 1, [0, 300], {}),
    configNode(W, [230, 300], { email_enabled: cfg.email_enabled, from_email: cfg.from_email, ops_alert_recipient: cfg.finance_alert_recipient }),
    code(W, "Format crash alert", [460, 300], "return [{ json: nodeFormatCrashAlert($('Error Trigger').first().json) }];"),
    node(W, "Mark run crashed", "n8n-nodes-base.dataTable", 1.1, [690, 300], {
      resource: "row",
      operation: "update",
      dataTableId: table,
      matchType: "allConditions",
      filters: { conditions: [{ keyName: "execution_id", condition: "eq", keyValue: "={{ $('Format crash alert').first().json.execution_id }}" }] },
      columns: {
        mappingMode: "defineBelow",
        value: { status: "crashed", error_code: "workflow_crashed", finished_at_ms: "={{ Date.now() }}" },
        matchingColumns: [],
        schema: [col("status", "string"), col("error_code", "string"), col("finished_at_ms", "number")],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {},
    }, { alwaysOutputData: true, onError: "continueRegularOutput" }),
    ifTrue(W, "Email enabled?", [920, 300], "={{ $('Config').first().json.email_enabled }}"),
    sendEmail(W, "Alert ops", [1150, 220], {
      fromEmail: "={{ $('Config').first().json.from_email }}",
      toEmail: "={{ $('Config').first().json.ops_alert_recipient }}",
      subject: "={{ $('Format crash alert').first().json.subject }}",
      emailFormat: "html",
      html: "={{ $('Format crash alert').first().json.html }}",
    }, { onError: "continueRegularOutput" }),
  ];
  const connections = buildConnections([
    ["Error Trigger", [["Config"]]],
    ["Config", [["Format crash alert"]]],
    ["Format crash alert", [["Mark run crashed"]]],
    ["Mark run crashed", [["Email enabled?"]]],
    ["Email enabled?", [["Alert ops"], []]],
  ]);
  return {
    id: ERROR_WORKFLOW_ID,
    name: "BookLeaf · Error handler",
    nodes,
    connections,
    settings: { executionOrder: "v1", timezone: "Asia/Kolkata", saveDataErrorExecution: "all", saveDataSuccessExecution: "all" },
    pinData: {},
    meta: { templateCredsSetupCompleted: true },
    tags: [],
  };
}

function buildConnections(list) {
  const out = {};
  for (const [from, outputs] of list) {
    out[from] = { main: outputs.map((targets) => (targets || []).map((t) => ({ node: t, type: "main", index: 0 }))) };
  }
  return out;
}
