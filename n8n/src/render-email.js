/**
 * Renders the final email (HTML + plain text). The figures (totals card and
 * per-book table) come from FACTS; the model's prose fills the paragraphs.
 * Email-client-safe markup: tables and inline styles only, every dynamic
 * value HTML-escaped. Brand colours match bookleafpub.in (coral / blush).
 *
 * Depends on: shared.js, royalty-facts.js
 */

const C = {
  coral: "#e9566a",
  coralDark: "#b32f40",
  ink: "#2b2627",
  inkSoft: "#5f5658",
  paper: "#fcf8f7",
  blush: "#fdf1f2",
  line: "#efe4e4",
};

const BADGE_STYLE = {
  green: { fg: "#1f7a45", bg: "#e6f4ec" },
  yellow: { fg: "#8a5a00", bg: "#fff3d6" },
  red: { fg: "#b32f40", bg: "#fde8ea" },
  grey: { fg: "#5f5658", bg: "#f1eded" },
};

export function renderEmail(draft, facts, delivery) {
  const subject = buildSubject(facts);
  const notes = new Map(draft.book_notes.map((n) => [n.book_id, n.note]));
  const published = facts.books.filter((b) => b.is_published);
  const production = facts.books.filter((b) => !b.is_published);
  const e = escapeHtml;
  const p = (text, style = "") =>
    text && text.trim() ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.ink};${style}">${e(text)}</p>` : "";

  const badge = (b) => {
    const s = BADGE_STYLE[b.badge] || BADGE_STYLE.grey;
    return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:bold;color:${s.fg};background:${s.bg};">${e(b.label)}</span>`;
  };

  const stat = (label, value, color) =>
    `<td width="33%" style="padding:14px 8px;text-align:center;">
      <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${C.inkSoft};">${label}</div>
      <div style="font-size:22px;font-weight:bold;color:${color};margin-top:4px;">${e(formatInr(value))}</div>
    </td>`;

  const cell = (label, value) =>
    `<td style="padding:6px 8px;font-size:13px;color:${C.ink};"><div style="color:${C.inkSoft};font-size:11px;">${label}</div>${e(value)}</td>`;

  const publishedHtml = published
    .map(
      (b) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:8px;margin:0 0 12px;">
      <tr><td style="padding:12px 12px 4px;">
        <span style="font-size:16px;font-weight:bold;color:${C.ink};">${e(b.title)}</span>&nbsp; ${badge(b)}
      </td></tr>
      <tr><td style="padding:0 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${cell("Copies sold", formatCount(b.copies_sold))}
          ${cell("Earned", formatInr(b.royalty_earned))}
          ${cell("Paid", formatInr(b.royalty_paid))}
          ${cell("Pending", formatInr(b.royalty_pending))}
          ${cell("Last payout", b.last_payout_date ? formatLongDate(b.last_payout_date) : "Not yet")}
        </tr></table>
      </td></tr>
      ${notes.get(b.book_id) ? `<tr><td style="padding:4px 12px 12px;font-size:14px;line-height:1.55;color:${C.ink};">${e(notes.get(b.book_id))}</td></tr>` : ""}
    </table>`,
    )
    .join("");

  const productionHtml = production
    .map((b) => {
      const s = productionStage(b.status);
      const stageLine = s.stage_number ? `Stage ${s.stage_number} of ${s.of}: ${s.current_stage}${s.next_stage ? ` · next: ${s.next_stage}` : ""}` : s.current_stage;
      return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed ${C.line};border-radius:8px;margin:0 0 12px;background:${C.paper};">
      <tr><td style="padding:12px;">
        <span style="font-size:16px;font-weight:bold;color:${C.ink};">${e(b.title)}</span>&nbsp; ${badge(b)}
        <div style="font-size:13px;color:${C.inkSoft};margin-top:4px;">${e(stageLine)}</div>
        ${notes.get(b.book_id) ? `<div style="font-size:14px;line-height:1.55;color:${C.ink};margin-top:8px;">${e(notes.get(b.book_id))}</div>` : ""}
      </td></tr>
    </table>`;
    })
    .join("");

  const demoNotice =
    delivery && delivery.demo_mode
      ? `<p style="margin:12px 0 0;font-size:12px;color:${C.inkSoft};">Demo mode: this summary is addressed to ${e(delivery.intended_recipient)} and was delivered to the BookLeaf demo inbox instead.</p>`
      : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};font-family:Lato,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(draft.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid ${C.line};border-radius:12px;overflow:hidden;">
  <tr><td style="background:${C.coral};padding:20px 24px;">
    <div style="font-size:20px;font-weight:bold;color:#ffffff;">BookLeaf Publishing</div>
    <div style="font-size:13px;color:#ffffff;opacity:.9;margin-top:2px;">Royalty summary · as of ${e(facts.as_of_label)}</div>
  </td></tr>
  <tr><td style="padding:24px;">
    ${p(draft.greeting)}
    ${p(draft.opening)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.blush};border-radius:10px;margin:0 0 8px;"><tr>
      ${stat("Total earned", facts.totals.earned, C.ink)}
      ${stat("Total paid", facts.totals.paid, "#1f7a45")}
      ${stat("Total pending", facts.totals.pending, facts.overdue.count ? C.coralDark : C.ink)}
    </tr></table>
    ${p(draft.totals_note, `font-size:13px;color:${C.inkSoft};`)}
    ${published.length ? `<h2 style="font-size:16px;color:${C.ink};margin:20px 0 10px;">Your published books</h2>${publishedHtml}` : ""}
    <h2 style="font-size:16px;color:${C.ink};margin:20px 0 10px;">When you'll be paid</h2>
    ${p(draft.payout_note)}
    ${production.length ? `<h2 style="font-size:16px;color:${C.ink};margin:20px 0 10px;">Books in production</h2>${productionHtml}${p(draft.production_note)}` : ""}
    ${p(draft.closing)}
    <p style="margin:0;font-size:15px;line-height:1.6;color:${C.ink};">Warm regards,<br><strong>Team BookLeaf</strong><br><span style="color:${C.inkSoft};">Author Relations · BookLeaf Publishing</span></p>
  </td></tr>
  <tr><td style="padding:16px 24px;border-top:1px solid ${C.line};background:${C.paper};">
    <p style="margin:0;font-size:12px;line-height:1.5;color:${C.inkSoft};">Figures as of ${e(facts.as_of_label)}. Royalties are calculated quarterly and paid within 45 days of the quarter ending; balances below ₹1,000 roll over to the next quarter. Your dashboard has the full breakdown.</p>
    ${demoNotice}
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text: renderText(draft, facts, notes, delivery) };
}

function renderText(draft, facts, notes, delivery) {
  const lines = [draft.greeting, "", draft.opening, ""];
  lines.push(`Total earned: ${formatInr(facts.totals.earned)}`, `Total paid: ${formatInr(facts.totals.paid)}`, `Total pending: ${formatInr(facts.totals.pending)}`);
  if (draft.totals_note) lines.push("", draft.totals_note);
  const published = facts.books.filter((b) => b.is_published);
  if (published.length) {
    lines.push("", "YOUR PUBLISHED BOOKS");
    for (const b of published) {
      lines.push(
        "",
        `${b.title} [${b.label}]`,
        `Copies sold ${formatCount(b.copies_sold)} | Earned ${formatInr(b.royalty_earned)} | Paid ${formatInr(b.royalty_paid)} | Pending ${formatInr(b.royalty_pending)} | Last payout ${b.last_payout_date ? formatLongDate(b.last_payout_date) : "not yet"}`,
      );
      if (notes.get(b.book_id)) lines.push(notes.get(b.book_id));
    }
  }
  lines.push("", "WHEN YOU'LL BE PAID", draft.payout_note);
  const production = facts.books.filter((b) => !b.is_published);
  if (production.length) {
    lines.push("", "BOOKS IN PRODUCTION");
    for (const b of production) {
      const s = productionStage(b.status);
      lines.push("", `${b.title}: ${s.current_stage}${s.next_stage ? ` (next: ${s.next_stage})` : ""}`);
      if (notes.get(b.book_id)) lines.push(notes.get(b.book_id));
    }
    if (draft.production_note) lines.push("", draft.production_note);
  }
  lines.push("", draft.closing, "", "Warm regards,", "Team BookLeaf", "Author Relations · BookLeaf Publishing");
  lines.push("", `Figures as of ${facts.as_of_label}.`);
  if (delivery && delivery.demo_mode) lines.push(`Demo mode: addressed to ${delivery.intended_recipient}, delivered to the BookLeaf demo inbox.`);
  return lines.join("\n");
}
