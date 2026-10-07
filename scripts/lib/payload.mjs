/**
 * Builds the webhook body exactly as Bubble's API Connector sends it (see
 * docs/bubble-build-guide.md, "API Connector"): every scalar is a string,
 * dates are UNIX milliseconds of the date as entered in India (IST, UTC+5:30),
 * yes/no are "yes"/"no", platforms are a comma-separated string.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/bookleaf_sample_data.json");

export const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8"));

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "2023-06-20" -> ms of 2023-06-20 00:00 IST, which is what Bubble stores. */
export function bubbleDateMs(iso) {
  if (!iso) return "";
  return String(Date.parse(`${iso}T00:00:00Z`) - IST_OFFSET_MS);
}

/** Dataset status -> Bubble "Book Status" option display. */
export function bubbleStatus(status) {
  return String(status).replace(/^In Production\s*-\s*/i, "");
}

export function findAuthor(authorId) {
  const author = dataset.authors.find((a) => a.author_id === authorId);
  if (!author) throw new Error(`Unknown author ${authorId}`);
  return author;
}

export function bubblePayload(authorId, options = {}) {
  const author = findAuthor(authorId);
  const nowMs = options.nowMs ?? Date.now();
  const notificationId = options.notificationId ?? `test-${authorId}-${nowMs}`;
  return {
    schema_version: "1",
    notification_id: notificationId,
    idempotency_key: `${authorId}-${notificationId}`,
    trigger_type: options.triggerType ?? "Single",
    triggered_by: options.triggeredBy ?? "admin@bookleaf.demo",
    requested_at_ms: String(nowMs),
    as_of_ms: options.asOfIso ? bubbleDateMs(options.asOfIso) : String(nowMs),
    simulate_failure: options.simulate ?? "",
    dry_run: options.dryRun ? "yes" : "no",
    author: {
      author_id: author.author_id,
      name: author.name,
      email: author.email,
      city: author.city,
    },
    books: author.books.map((b) => ({
      book_id: b.book_id,
      title: b.title,
      isbn: b.isbn,
      genre: b.genre,
      status: bubbleStatus(b.status),
      is_published: b.status === "Published & Live" ? "yes" : "no",
      publication_date_ms: bubbleDateMs(b.publication_date),
      mrp: b.mrp == null ? "" : String(b.mrp),
      royalty_per_copy: b.author_royalty_per_copy == null ? "" : String(b.author_royalty_per_copy),
      copies_sold: String(b.total_copies_sold),
      royalty_earned: String(b.total_royalty_earned),
      royalty_paid: String(b.royalty_paid),
      royalty_pending: String(b.royalty_pending),
      last_payout_date_ms: bubbleDateMs(b.last_royalty_payout_date),
      print_partner: b.print_partner ?? "",
      available_on: (b.available_on ?? []).join(", "),
    })),
  };
}
