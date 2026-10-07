/**
 * Every answer n8n gives Bubble has the same keys, whatever the outcome, so
 * Bubble's API Connector can be initialised once and every field mapped into
 * the Notification Log. Empty strings / zeros mean "not applicable".
 */
export const RESPONSE_TEMPLATE = {
  status: "", // "Success" | "Failed" | "Duplicate"
  notification_id: "",
  author_id: "",
  completed_at: "", // ISO-8601 timestamp of when n8n finished
  email_subject: "",
  email_html: "",
  email_text: "",
  email_delivery: "not_attempted", // "sent" | "disabled" | "failed" | "not_attempted"
  intended_recipient: "",
  delivered_to: "",
  ai_model: "",
  ai_attempts: 0,
  prompt_version: "",
  total_earned: 0,
  total_paid: 0,
  total_pending: 0,
  overdue_books: 0,
  escalated_to_finance: "no",
  duplicate_of: "",
  error_code: "",
  error_message: "",
  n8n_execution_id: "",
  duration_ms: 0,
};

export function buildResponse(fields, nowMs) {
  const response = { ...RESPONSE_TEMPLATE };
  for (const key of Object.keys(RESPONSE_TEMPLATE)) {
    if (fields[key] !== undefined && fields[key] !== null) response[key] = fields[key];
  }
  response.completed_at = response.completed_at || new Date(nowMs ?? Date.now()).toISOString();
  response.error_message = String(response.error_message).slice(0, 500);
  return response;
}
