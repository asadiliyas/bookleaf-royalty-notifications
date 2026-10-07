# Screen recording script (target 4:30, hard limit 5:00)

**Setup before recording**
- Two browser windows: a normal one (admin) and a private one (author).
- Third tab: n8n with the *BookLeaf · Royalty Summary* workflow open.
- Fourth tab: the demo inbox (Gmail).
- In the Bubble admin, set the as-of date to **Use today**.
- Make sure Priya, Ananya and Meera haven't been sent a summary in the last 5 minutes.
- Close other tabs, hide bookmarks, zoom to 110%.

| Time | Screen | Say (roughly) |
|---|---|---|
| 0:00–0:20 | README top | "This is BookLeaf's royalty dashboard: Bubble for the app, n8n for automation, Gemini on the free tier. Everything here runs on free plans." |
| 0:20–1:05 | Private window: sign in as **ananya.reddy@email.com** | "Authors sign in with email and password. Ananya sees only her book: ISBN, genre, status, MRP, platforms, and the royalty figures. The red badge is the 90-day rule: ₹2,546 pending, never paid, and published well over 90 days ago." Sign out, sign in as **kavita.deshmukh@email.com**: "Kavita's ₹850 is yellow, not red: the Knowledge Base says balances under ₹1,000 roll over. Her second book is in Typesetting, stage 4 of 9." |
| 1:05–1:20 | Still Kavita: change the URL to `/admin` | "Privacy rules run on Bubble's server; an author can't reach the admin pages or other authors' data." |
| 1:20–2:05 | Admin window: **admin@bookleaf.demo** | Author list with totals. Filter city = Pune; status = Overdue; search "kap". "Statuses are as of today. Every payout in the dataset is from 2025, so most balances are overdue today. The dataset-snapshot switch shows the full spread." Click it, show the colours change, switch back. |
| 2:05–2:50 | Open **Priya Sharma**, click **Generate & Send** | "Same view the author gets, plus payout history. Generate & Send queues a backend workflow; the button locks immediately." Row goes Queued → Processing → Success live. Click **View email**. "The numbers in the table and totals come from code; Gemini writes only the words, and every amount and date is checked before sending." Switch to the inbox tab to show it arrived. |
| 2:50–3:30 | n8n tab: **Executions** → open the latest run | Walk the canvas left to right: "Header-auth webhook, validation, idempotency on a data table, royalty facts, Gemini with a fallback model, guardrails, email, finance alert because Priya's payout is overdue, and the response that Bubble writes into the log." |
| 3:30–4:00 | Back in Bubble: click Generate again on Priya | "A second click is blocked in the UI, again in Bubble's backend, and n8n deduplicates too." Then on **Meera's** page choose *Simulate AI failure* → Generate → the row turns **Failed** with both models' errors. "Failures are never silent." |
| 4:00–4:30 | Admin → **Send summaries to all authors with pending royalties** → confirm → Notification log | "Bulk calls the same webhook once per eligible author, 8 seconds apart for the free-tier rate limit; authors summarised in the last 5 minutes are skipped." Show rows arriving. "Docs, workflow JSON, tests and sample emails are in the repo. Thanks!" |

**If something misbehaves live:** keep going. The README documents every failure mode, and a visible *Failed* row with a clear reason is itself a demo of the error handling.
