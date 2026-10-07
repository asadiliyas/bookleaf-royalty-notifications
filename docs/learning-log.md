# Learning log

A dated record of what I learned, what didn't work, and how I worked around it. The brief asks for the learning process, not just the result, so the dead ends are kept in.

## 6 Oct 2026 · Brief received
- Second assignment, 7 days: Bubble.io + n8n + an AI API, same dataset and Knowledge Base as Assignment 1.
- Constraint I set myself: **₹0 spend**. Every service has to work on a free tier.

## 7 Oct 2026 · Plan, free-tier research, n8n workflow

**Researching the free plans before designing anything**
- Bubble's pricing page lists the Free plan as *development version only, 1 app editor, 50K workload units, API Connector included; recurring workflows from Starter*.
- Forum threads (Apr and Dec 2024) report that the **Data API and Workflow API return 401 on the free plan**, even at `/version-test/`, while **backend workflows were opened to free plans**. The settings page even says "Test this feature for free", which a Bubble moderator called misleading.
- Consequence for the design:
  1. n8n can't fetch from Bubble → Bubble sends the full payload in the webhook.
  2. n8n can't call Bubble back → n8n returns the result in its webhook response, received by a Bubble backend workflow.
  3. No collaborators on Free → reviewers get the read-only *Everyone can view* editor link.
  4. No recurring workflows → statuses refresh on the first admin visit of the day.
- n8n Cloud's trial is 14 days with no card, so the workflow is built and tested on a **local n8n (Docker)** and moved to the Cloud trial near submission, so the trial covers the review period.

**Learning n8n 2.x precisely**
- The installed n8n (2.42) ships TypeScript definitions for every node version (`node-definitions/…/v22.ts` etc.). I read those instead of guessing parameter names. That's how I found that the Data Table node can address a table **by name** (portable between instances) and that a table can be created with *create if not exists*, so the workflow sets up its own storage.
- n8n 2.x *publishes* workflow versions: `import:workflow` + `publish:workflow` + a restart. For a few seconds after a restart the webhook answers 404 while it re-registers. My first crash test hit the old version, so the deploy script now waits until the webhook answers 403 (registered, no key).
- Code nodes can't import files. The logic lives in `n8n/src/*.js` with unit tests, and a small build script inlines only the functions each node uses. Tests and n8n run the same code.

**Idempotency without a lock**
- n8n Data Tables have no atomic "insert if absent". Check-then-insert would let two simultaneous clicks both pass.
- Solution: **insert first, then read**. Every run inserts its row, then reads all runs for the author; the lowest id that is processing or succeeded wins. Both racing runs see the same rows, so they agree. The smoke test fires two requests at the same millisecond: one Success, one Duplicate.

**The Gemini free tier changed**
- The first full run of all 10 authors: 6 of 10 emails came from the *fallback* model.
- I assumed my guardrails were too strict. Calling Gemini directly showed `429 RESOURCE_EXHAUSTED … limit: 20, model: gemini-2.5-flash`: the free tier is now **20 requests per day** for Flash models.
- Reports for Sept 2026 give ~500/day for 3.5 Flash-Lite and 3.1 Flash-Lite, each with its own quota. The primary/fallback pair is now those two, about 1,000 free emails a day. A good side effect: the fallback design had already proven itself on a real outage.

**Reading every email: four fixes that tests alone wouldn't have found**
1. Subjects and bodies contained `₹` instead of `₹`. Gemini had double-escaped the rupee sign, and the amount checks (which look for `₹`) silently skipped those amounts. Fix: decode escapes before checking; reject any that remain.
2. One subject came back as "Your BookLeaf royalty summary: ⏎Happiness and how to get it". Fix: the subject is built in code from the totals; single-line checks on the preheader.
3. *"₹4,175 is pending from sales up to Q2 2026"* was an invented claim. Q2 2026 slipped through because I'd shown the model the previous payout cycle for context. Fix: show only the next payout; only its quarter is allowed.
4. Diya's email said "₹2,540 pending" for her **total**. ₹2,540 is a real number, but it's one book's figure; the total is ₹4,115. An "is this amount in the facts?" check can't catch that. Fix: **section-aware checks**: the totals sentence must state exactly the three totals, and each book note may only use that book's figures.

After these: 20/20 delivered across both as-of dates, 18 accepted on the first draft.

**Things I'd tell myself at the start**
- Read the platform's real limits before designing, not after.
- Evaluate AI output by reading it. Every guardrail in the final design comes from a real failure I read.

---

## Bubble build days

*(Written by me as I build the app; prompts below.)*

### 8 Oct 2026
- What I expected Bubble to work like vs what it actually does:
- Data types vs option sets: how I decided:
- Privacy rules: what I misunderstood at first:

### 9 Oct 2026
- Workflows: "Only when" instead of if/else, and what that means for the status rules:
- Backend workflows and "Ignore privacy rules": why `attach_account` needs it:
- What broke and how I fixed it:

### 10 Oct 2026
- API Connector: initialising the call, private headers, "include errors in response":
- Building the books JSON with `:format as text` and `:formatted as JSON-safe`:
- Repeating groups and live updates: what surprised me:

### Resources that helped
- manual.bubble.io sections:
- Videos / forum threads:
