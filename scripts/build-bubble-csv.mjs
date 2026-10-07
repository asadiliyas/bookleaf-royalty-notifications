/**
 * Converts data/bookleaf_sample_data.json into one CSV per Bubble data type,
 * ready for Data → App data → "Upload" in the Bubble editor.
 *
 * References between things (Book → Author etc.) can't be uploaded directly
 * because Bubble only learns its unique IDs after the upload. So every CSV
 * carries the dataset's own codes (author_code, book_code) and a one-off
 * backend workflow ("link_imported_data", see docs/bubble-build-guide.md)
 * fills in the real references afterwards.
 *
 * Column headers match the Bubble field names exactly, so the uploader maps
 * them automatically. Option set columns contain the option's Display text.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bubbleStatus, dataset } from "./lib/payload.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/bubble-import");
mkdirSync(OUT, { recursive: true });

// Bubble's CSV uploader reads dates as month/day/year.
const usDate = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const write = (file, rows) => {
  const header = Object.keys(rows[0]);
  const csv = [header.join(","), ...rows.map((r) => header.map((h) => cell(r[h])).join(","))].join("\r\n");
  writeFileSync(path.join(OUT, file), `${csv}\r\n`);
  console.log(`${file}: ${rows.length} rows`);
};

const authors = dataset.authors.map((a) => ({
  author_code: a.author_id,
  name: a.name,
  email: a.email,
  phone: a.phone,
  city: a.city,
  joined_date: usDate(a.joined_date),
}));

const books = dataset.authors.flatMap((a) =>
  a.books.map((b) => ({
    book_code: b.book_id,
    author_code: a.author_id,
    title: b.title,
    isbn: b.isbn,
    genre: b.genre,
    status: bubbleStatus(b.status),
    publication_date: usDate(b.publication_date),
    mrp: b.mrp ?? "",
    print_partner: b.print_partner ?? "",
    available_on: (b.available_on ?? []).join(", "),
  })),
);

// One royalty record per book (zeros for books still in production), so every
// book has a ledger row and the UI never has to special-case a missing one.
const royaltyRecords = dataset.authors.flatMap((a) =>
  a.books.map((b) => ({
    book_code: b.book_id,
    author_code: a.author_id,
    royalty_per_copy: b.author_royalty_per_copy ?? 0,
    copies_sold: b.total_copies_sold,
    royalty_earned: b.total_royalty_earned,
    royalty_paid: b.royalty_paid,
    royalty_pending: b.royalty_pending,
    last_payout_date: usDate(b.last_royalty_payout_date),
  })),
);

// The dataset only records the amount paid to date and the last payout date,
// not individual payouts. Each book with a payout gets one row that says so.
const payouts = dataset.authors.flatMap((a) =>
  a.books
    .filter((b) => b.last_royalty_payout_date && b.royalty_paid > 0)
    .map((b) => ({
      book_code: b.book_id,
      author_code: a.author_id,
      amount: b.royalty_paid,
      paid_on: usDate(b.last_royalty_payout_date),
      note: "Total paid to date (the dataset records the latest payout date, not each payout)",
    })),
);

write("1-authors.csv", authors);
write("2-books.csv", books);
write("3-royalty-records.csv", royaltyRecords);
write("4-payouts.csv", payouts);
