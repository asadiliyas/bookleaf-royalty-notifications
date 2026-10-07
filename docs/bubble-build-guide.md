# Bubble build guide: BookLeaf Royalty Dashboard

Follow this top to bottom in the Bubble editor. Each part ends with a **✅ Check** so you know it works before moving on. Names in `code` must be typed exactly as written: the n8n payload, the CSV files and the tests depend on them.

**Notation**
- `Search for Books (author = X)` means *Do a search for* → type *Book* → constraint *author = X*.
- `→` separates workflow actions, in order.
- **Only when** is the condition field at the bottom of every action and event.
- [square brackets] inside a text template mean *insert dynamic data* there.

> **Time budget:** about 6–8 hours spread over 2–3 sessions. Parts 1–5 (data) take ~1.5 h, parts 6–8 (pages) ~3 h, parts 9–11 (n8n integration) ~1.5 h.

---

## Part 0 · Create the app and check the free plan (15 min)

1. Sign up at bubble.io (free) → **Create an app** → name it `bookleaf-royalty` (the URL becomes `bookleaf-royalty.bubbleapps.io`). Start from a **blank** app; skip the AI generator and templates.
2. **Settings → General**
   - *Expose the option to add an ID attribute to HTML elements* → ✅ (the automated tests find elements by ID).
   - Leave *Application rights* as **Private app** for now. Part 12 opens it for reviewers.
3. **Settings → API**
   - ✅ *Enable Workflow API and backend workflows*.
   - ✅ **Check:** a **Backend workflows** entry now appears in the page dropdown (top-left). Free plans include backend workflows; external calls *into* Bubble (Data API / Workflow API) are a paid feature, which is why n8n answers through its webhook response instead of calling Bubble back (see README §4).
4. **Settings → General → Time zone**: set the app's default to **Asia/Calcutta** (IST). Dates are entered and shown in Indian time.

---

## Part 1 · Option sets (15 min)

**Data → Option sets.** Create each set, add its attributes (*Create a new attribute*), then add the options in this order.

| Option set | Attributes | Options (Display → attribute values) |
|---|---|---|
| `Role` | – | `Author`, `Admin` |
| `Book Status` | `stage_no` (number), `is_published` (yes/no) | `Manuscript Received` (1, no) · `Editing` (2, no) · `Cover Design` (3, no) · `Typesetting` (4, no) · `Proofreading` (5, no) · `ISBN Assignment` (6, no) · `Printing` (7, no) · `Distribution Setup` (8, no) · `Published & Live` (9, **yes**) |
| `Platform` | – | `Amazon India`, `Flipkart`, `Amazon US`, `Amazon UK`, `BookLeaf Store` |
| `Print Partner` | – | `In-House`, `Repro India`, `Epitome Books` |
| `Payout Status` | `text_color` (text), `bg_color` (text), `severity` (number) | `In production` (#5F5658, #F1EDED, 0) · `Paid up` (#1F7A45, #E6F4EC, 1) · `Pending` (#8A5A00, #FFF3D6, 2) · `Overdue` (#B32F40, #FDE8EA, 3) |
| `Notification Status` | `text_color` (text), `bg_color` (text) | `Queued` (#5F5658, #F1EDED) · `Processing` (#34449A, #DFE3F6) · `Success` (#1F7A45, #E6F4EC) · `Failed` (#B32F40, #FDE8EA) · `Duplicate` (#8A5A00, #FFF3D6) |
| `Trigger Type` | – | `Single`, `Bulk` |

*Why option sets:* statuses and platforms are a fixed vocabulary, so they live in the app definition, not in database rows: they're free to read, can't be mistyped, and carry attributes like the badge colours.

---

## Part 2 · Data types and fields (30 min)

**Data → Data types.** For each type: *New type* → name → then *Create a new field* for each row. "list" means tick *This field is a list (multiple entries)*.

**User** (exists already; `email` is built in)

| Field | Type |
|---|---|
| `role` | Role |
| `author` | Author *(create Author first, then come back and add this field)* |

**Author**

| Field | Type | Field | Type |
|---|---|---|---|
| `author_code` | text | `account` | User |
| `name` | text | `payout_status` | Payout Status |
| `email` | text | `total_books` | number |
| `phone` | text | `total_copies` | number |
| `city` | text | `total_earned` | number |
| `joined_date` | date | `total_paid` | number |
| | | `total_pending` | number |
| | | `overdue_books` | number |

**Book**

| Field | Type | Field | Type |
|---|---|---|---|
| `book_code` | text | `status` | Book Status |
| `author_code` | text | `publication_date` | date |
| `author` | Author | `mrp` | number |
| `owner` | User | `print_partner` | Print Partner |
| `title` | text | `available_on` | Platform (**list**) |
| `isbn` | text | `royalty` | Royalty Record *(add after creating Royalty Record)* |
| `genre` | text | | |

**Royalty Record** (one per book: the money side of a book)

| Field | Type | Field | Type |
|---|---|---|---|
| `book_code` | text | `royalty_per_copy` | number |
| `author_code` | text | `copies_sold` | number |
| `book` | Book | `royalty_earned` | number |
| `author` | Author | `royalty_paid` | number |
| `owner` | User | `royalty_pending` | number |
| `payout_status` | Payout Status | `last_payout_date` | date |
| `status_reason` | text | | |

**Payout** (payout history)

| Field | Type |
|---|---|
| `book_code`, `author_code`, `note` | text |
| `book` | Book |
| `author` | Author |
| `owner` | User |
| `amount` | number |
| `paid_on` | date |

**Royalty Notification** (the Notification Log)

| Field | Type | Field | Type |
|---|---|---|---|
| `author` | Author | `email_subject` | text |
| `triggered_by` | User | `email_html` | text |
| `trigger_type` | Trigger Type | `email_text` | text |
| `batch_id` | text | `email_delivery` | text |
| `status` | Notification Status | `intended_recipient` | text |
| `requested_at` | date | `delivered_to` | text |
| `started_at` | date | `ai_model` | text |
| `completed_at` | date | `ai_attempts` | number |
| `idempotency_key` | text | `prompt_version` | text |
| `n8n_execution_id` | text | `escalated_to_finance` | yes/no |
| `duration_ms` | number | `duplicate_of` | text |
| `simulate_failure` | text | `error_code` | text |
| | | `error_message` | text |

**App Settings** (a single row of configuration)

| Field | Type | Default |
|---|---|---|
| `status_as_of_date` | date | – |
| `as_of_mode` | text | `today` |
| `signup_open` | yes/no | yes |
| `cooldown_minutes` | number | 5 |
| `bulk_interval_seconds` | number | 8 |
| `last_status_refresh` | date | – |

**Why this shape** (also in the README):
- Author, Book, Royalty Record and Payout are separate because they change for different reasons. A book's catalogue data (ISBN, MRP, platforms) is not its money, and royalty records could later become one row per quarter without touching Book.
- `owner` (User) is copied onto every author-owned row so each privacy rule is a single, fast check: *This record's owner is Current User*.
- `author_code` / `book_code` keep the dataset's IDs. They are what the CSV import links on, and they make the data traceable back to the JSON.
- Totals and statuses are stored on Author (refreshed by a workflow, Part 5) so the admin list can filter and sort on them with plain search constraints.

---

## Part 3 · Import the dataset (20 min)

The CSV files are in [`data/bubble-import/`](../data/bubble-import) (generated from `bookleaf_sample_data.json` by `npm run build:csv`).

**Data → App data → Upload** (*Upload a CSV*), one type at a time, in this order:

| File | Data type | Mapping notes |
|---|---|---|
| `1-authors.csv` | Author | Columns match field names. `joined_date` is a date. |
| `2-books.csv` | Book | `status`, `print_partner` map to the option sets (Display text). `available_on` → list of Platform (comma-separated). Leave `author` / `owner` / `royalty` unmapped. |
| `3-royalty-records.csv` | Royalty Record | Leave `book` / `author` / `owner` / `payout_status` unmapped. |
| `4-payouts.csv` | Payout | Leave references unmapped. |

Then create the settings row: **App data → App Settings → New entry** with `as_of_mode` = `today`, `signup_open` = yes, `cooldown_minutes` = 5, `bulk_interval_seconds` = 8, `status_as_of_date` = today.

✅ **Check:** App data shows 10 Authors, 18 Books, 18 Royalty Records, 12 Payouts, 1 App Settings. Open *Midnight in Mysore*: status *Cover Design*, no MRP.

> If the uploader refuses the `available_on` list column, import it into a temporary text field, or skip it and set the platforms by hand for the 16 published books. Note what happened in the learning log; it's exactly the kind of thing reviewers want to read about.

---

## Part 4 · Backend workflows: link the imported data (20 min)

Page dropdown → **Backend workflows**. For each workflow: *New API workflow* → name it → *Add parameter*. Leave *Expose as a public API workflow* **unticked**. Tick **Ignore privacy rules when running the workflow** on all of them, because they do system bookkeeping.

**`link_book`**: parameter `book` (Book)
1. *Make changes to thing* → `book`:
   - `author` = `Search for Authors (author_code = book's author_code):first item`
   - `royalty` = `Search for Royalty Records (book_code = book's book_code):first item`

**`link_royalty_record`**: parameter `record` (Royalty Record)
1. *Make changes to thing* → `record`:
   - `book` = `Search for Books (book_code = record's book_code):first item`
   - `author` = `Search for Authors (author_code = record's author_code):first item`

**`link_payout`**: parameter `payout` (Payout)
1. *Make changes to thing* → `payout`: `book` and `author` exactly as above.

**`attach_account`**: parameter `user` (User). Links a login to its author record and stamps `owner` on that author's rows.
1. *Make changes to thing* → `user`: `author` = `Search for Authors (email = user's email):first item`, `role` = `Author`.
   **Only when** `Search for Authors (email = user's email):count > 0`
2. *Make changes to thing* → `user`: `role` = `Admin`. **Only when** `user's email contains @bookleaf.demo`
3. *Make changes to thing* → `user's author`: `account` = `user`. **Only when** `user's author is not empty`
4. *Make changes to a list of things* → `Search for Books (author = user's author)`: `owner` = `user`. **Only when** `user's author is not empty`
5. Same for `Search for Royalty Records (author = user's author)` → `owner` = `user`.
6. Same for `Search for Payouts (author = user's author)` → `owner` = `user`.

*Run them.* Create a page `setup` (Part 7.5 shows the full page). For now put one button **Link imported data** on it with this workflow:
- *Schedule API workflow on a list* → type Book, list `Search for Books`, workflow `link_book`, interval 0
- → same for Royalty Records / `link_royalty_record`
- → same for Payouts / `link_payout`

Preview the `setup` page and click the button once.

✅ **Check:** in App data, every Book has an author and a royalty; every Royalty Record and Payout has a book and an author.

---

## Part 5 · Backend workflows: royalty status and totals (30 min)

These implement the badge rules from the brief, plus the Knowledge Base's ₹1,000 minimum. The same rules are coded in n8n (`n8n/src/royalty-facts.js`), so the dashboard and the email always agree.

| Badge | Rule |
|---|---|
| ⚪ In production | book's status is not *Published & Live* |
| 🟢 Paid up | nothing pending |
| 🟡 Pending | something pending and still within the normal cycle, **or** below the ₹1,000 minimum (KB: it rolls over; it isn't late) |
| 🔴 Overdue | ≥ ₹1,000 pending and the last payout was > 90 days ago, **or** never paid and published > 90 days ago |

**`refresh_record_status`**: parameters `record` (Royalty Record), `as_of` (date). The steps run in order and later ones overwrite earlier ones, which is how Bubble expresses if/else:
1. *Make changes* → `record`: `payout_status` = `In production`, `status_reason` = `Not published yet`.
   **Only when** `record's book's status's is_published is no`
2. *Make changes* → `record`: `payout_status` = `Paid up`, `status_reason` = `Nothing pending`.
   **Only when** `record's book's status's is_published is yes and record's royalty_pending ≤ 0`
3. *Make changes* → `record`: `payout_status` = `Pending`, `status_reason` = `Within the normal quarterly payout cycle`.
   **Only when** `record's book's status's is_published is yes and record's royalty_pending > 0`
4. *Make changes* → `record`: `status_reason` = `Below the ₹1,000 minimum payout: rolls over to the next quarter`.
   **Only when** `record's book's status's is_published is yes and record's royalty_pending > 0 and record's royalty_pending < 1000`
5. *Make changes* → `record`: `payout_status` = `Overdue`, `status_reason` = `Last payout was more than 90 days ago`.
   **Only when** `record's royalty_pending ≥ 1000 and record's last_payout_date is not empty and record's last_payout_date < as_of +(days): -90`
6. *Make changes* → `record`: `payout_status` = `Overdue`, `status_reason` = `Never paid, published more than 90 days ago`.
   **Only when** `record's royalty_pending ≥ 1000 and record's last_payout_date is empty and record's book's publication_date < as_of +(days): -90`
7. *Schedule API workflow* → `refresh_author_totals`, `author` = `record's author`, scheduled date `Current date/time +(seconds): 3`.

**`refresh_author_totals`**: parameter `author` (Author)
1. *Make changes* → `author`:
   - `total_books` = `Search for Books (author = author):count`
   - `total_copies` = `Search for Royalty Records (author = author):each item's copies_sold:sum`
   - `total_earned` / `total_paid` / `total_pending` = the same with `royalty_earned` / `royalty_paid` / `royalty_pending`
   - `overdue_books` = `Search for Royalty Records (author = author, payout_status = Overdue):count`
   - `payout_status` = `Paid up`
2. *Make changes* → `author`: `payout_status` = `Pending`. **Only when** `Result of step 1's total_pending > 0`
3. *Make changes* → `author`: `payout_status` = `Overdue`. **Only when** `Result of step 1's overdue_books > 0`

**`refresh_all_statuses`**: parameter `as_of` (date)
1. *Make changes* → `Search for App Settings:first item`: `last_status_refresh` = `Current date/time`, `status_as_of_date` = `as_of`
2. *Schedule API workflow on a list* → Royalty Record, `Search for Royalty Records`, `refresh_record_status`, `record` = *This Royalty Record*, `as_of` = `as_of`

*Free plan note:* recurring (daily) workflows are a paid feature, so the refresh runs when an admin opens the dashboard and the last refresh wasn't today (Part 7.3), and whenever the as-of date is changed.

Add a second button to the `setup` page: **Refresh statuses** → *Schedule API workflow* `refresh_all_statuses` (`as_of` = `Current date/time:rounded down to day`). Click it.

✅ **Check** (wait ~20 s): Rohit Kapoor has `total_pending` 13,024 and status *Overdue*; Farhan Sheikh is *Paid up*; Kavita Deshmukh is *Pending* (her ₹850 is below the minimum).

---

## Part 6 · Privacy rules (15 min)

**Data → Privacy.** For each type, *Define a new rule*. Then make sure **Everyone else (default permissions)** has every box **unticked**, unless the table says otherwise.

| Type | Rule name | When | Permissions |
|---|---|---|---|
| User | `Self` | `This User is Current User` | View all fields, Find this in searches |
| User | `Admins` | `Current User's role is Admin` | View all fields, Find this in searches |
| Author | `Own profile` | `This Author's account is Current User` | View all fields, Find this in searches |
| Author | `Admins` | `Current User's role is Admin` | View all fields, Find this in searches |
| Book | `Own books` | `This Book's owner is Current User` | View all fields, Find this in searches |
| Book | `Admins` | `Current User's role is Admin` | View all fields, Find this in searches |
| Royalty Record | `Own records` / `Admins` | as for Book | as for Book |
| Payout | `Own payouts` / `Admins` | as for Book | as for Book |
| Royalty Notification | `Admins` | `Current User's role is Admin` | View all fields, Find this in searches |
| App Settings | *(no rule)* | – | Everyone else: **View all fields + Find this in searches** (it holds no personal data) |

Leave *Allow auto-binding* off everywhere: no input in this app writes straight to the database.

*Why this is enough:* privacy rules run on Bubble's server before any data reaches the browser. An author can't see another author's rows even by building a search in the browser console, because those rows are never sent.

---

## Part 7 · Pages and reusable elements (3 h)

Keep the design simple: a white card on a light background, coral `#E9566A` buttons, Lato font (Styles tab → set the app font to Lato and the primary colour to `#E9566A`). Use **Column** containers for vertical stacks and **Row** containers for side-by-side items. That gives you responsive layout for free.

### 7.1 Reusable element `Header`
- Text `BookLeaf` (bold, coral) · Text `Royalty Dashboard`
- Text `Current User's email`, right-aligned
- Button `Log out` (ID `logout`) → *Log the user out* → *Go to page* `index`
- Only visible to admins: links `Authors` (→ page `admin`) and `Notification log` (→ page `admin`, send parameter `tab` = `log`)

### 7.2 Reusable element `Royalty View` (type of content: **Author**)
Used by both the author dashboard and the admin's author page, so the two always show the same thing.

1. **Summary row**: four cards
   - `Total earned`: `₹` + `Parent group's Author's total_earned:formatted as 1,029`
   - `Total paid`: same with `total_paid`
   - `Total pending`: same with `total_pending`
   - `Books`: `total_books`
   - plus an **author status badge**: text `Parent group's Author's payout_status's Display`. Background colour and text colour come from conditionals: *When Parent group's Author's payout_status is Overdue → background #FDE8EA, font #B32F40*, and the same for Pending and Paid up with the colours from Part 1.
2. **Repeating group `Books`** (ID `books-list`): type Book, data source `Search for Books (author = Parent group's Author)` sorted by `publication_date` (descending). One column, rows fit content. Each cell is a card:
   - Title `Current cell's Book's title` (bold) + **status badge** (same idea, reading `Current cell's Book's royalty's payout_status`, with 4 conditionals for the 4 colours)
   - Details line: `ISBN [isbn] · [genre] · [status's Display] · Published [publication_date:formatted as 15 Oct 2025] · MRP ₹[mrp]`
     - Conditional on this text: when `Current cell's Book's status's is_published is no` → show `[genre] · In production: [status's Display] (stage [status's stage_no] of 9)`
   - Platforms: `Available on: [available_on:each item's Display:join with ", "]`
   - Royalty row (*Only visible when* `Current cell's Book's status's is_published is yes`): `Copies sold [royalty's copies_sold]` · `Earned ₹[royalty_earned]` · `Paid ₹[royalty_paid]` · `Pending ₹[royalty_pending]` · `Last payout [royalty's last_payout_date:formatted as 15 Oct 2025]`. Conditional: when `last_payout_date is empty` → show `Last payout: not yet`.
   - Small grey text `Current cell's Book's royalty's status_reason`

### 7.3 Page `index` (sign in)
- Inputs: `Email` (ID `login-email`, content format Email), `Password` (ID `login-password`, content format Password)
- Button `Sign in` (ID `login-submit`)
- Small text with the demo accounts (see README)
- **Workflows**
  - *Button Sign in is clicked* → *Log the user in* (email, password, stay logged in = yes) → *Go to page* `admin` **Only when** `Current User's role is Admin` → *Go to page* `dashboard` **Only when** `Current User's role is not Admin`
  - *Page is loaded* **Only when** `Current User is logged in` → the same two *Go to page* actions

### 7.4 Page `dashboard` (author portal)
- `Header`, then `Royalty View` with data source `Current User's author`
- A heading `My books` above it and the text `Figures as of [Search for App Settings:first item's status_as_of_date:formatted as 7 Oct 2026]`
- **Workflow:** *Page is loaded* → *Go to page* `index` **Only when** `Current User is logged out`; → *Go to page* `admin` **Only when** `Current User's role is Admin`

### 7.5 Page `setup` (one-time admin tools)
Everything on this page sits in a group that is visible only when `Search for App Settings:first item's signup_open is yes`.
- Buttons from Parts 4–5: **Link imported data**, **Refresh statuses**
- **Create login** form: inputs `Email` (ID `setup-email`), `Password` (ID `setup-password`), button `Create login` (ID `setup-submit`), text (ID `setup-result`) bound to a custom state `last_created` (text)
  - Workflow: *Sign the user up* (email, password) → *Schedule API workflow* `attach_account` (`user` = `Result of step 1`) → *Set state* `last_created` = `Created [Input email's value]` → *Log the user out* → *Reset relevant inputs*
- After the logins exist (Part 8), set `signup_open` = no in App data. The page then shows nothing, and there is **no public sign-up anywhere in the app**.

### 7.6 Page `admin` (operations overview)
**Page workflows**
- *Page is loaded* → *Go to page* `index` **Only when** `Current User's role is not Admin`
- *Page is loaded* → *Schedule API workflow* `refresh_all_statuses` (`as_of` = `Current date/time:rounded down to day`) **Only when** `Search for App Settings:first item's as_of_mode is "today" and Search for App Settings:first item's last_status_refresh < Current date/time:rounded down to day`
- *Page is loaded* → *Set state* `tab` of the page = `Get data from page URL: parameter tab` (custom state `tab`, text, default `authors`)

**Top bar**
- Text `Statuses as of [App Settings's status_as_of_date:formatted as 7 Oct 2026]`
- Button `Use today` → *Make changes* to App Settings (`as_of_mode` = `today`, `status_as_of_date` = `Current date/time:rounded down to day`) → *Schedule API workflow* `refresh_all_statuses` (same date)
- Button `Use dataset snapshot (1 Jan 2026)` → same, with `as_of_mode` = `snapshot` and an *Arbitrary date/time* of 01/01/2026 00:00
- *Why:* every payout in the dataset is from Dec 2025 or earlier, so judged against today almost every pending balance is overdue. The snapshot date shows the full green/yellow/red spread the brief describes, and both are honest because the date is always displayed.
- Tabs: two buttons `Authors` / `Notification log` setting the `tab` state

**Authors tab** (visible when `tab is authors`)
- Summary: `Search for Authors:count` authors · total earned `Search for Authors:each item's total_earned:sum` · total pending (same) · overdue authors `Search for Authors (payout_status = Overdue):count`
- Filters
  - Input `Search author name` (ID `filter-name`)
  - Dropdown `City` (ID `filter-city`): dynamic choices `Search for Authors:each item's city:unique`, placeholder `All cities`
  - Dropdown `Payout status` (ID `filter-status`): type Payout Status, choices `All Payout Statuses` minus `In production`, placeholder `All statuses`
- **Repeating group `Authors`** (ID `authors-list`): `Search for Authors (name contains Input Search's value, city = Dropdown City's value, payout_status = Dropdown Payout status's value)` with **Ignore empty constraints** ✅, sorted by `name`
  - Columns: Name, City, Books (`total_books`), Earned, Paid, Pending (₹ formatted), status badge (as in 7.2), last summary (`Search for Royalty Notifications (author = Current cell's Author):first item's status's Display`, sorted by `requested_at` descending)
  - Button `View` → *Go to page* `admin_author`, data to send `Current cell's Author`
- Button **Send summaries to all authors with pending royalties ([Search for Authors (total_pending > 0):count])** (ID `bulk-send`) → shows Popup `Confirm bulk` → its *Send* button runs the bulk workflow in Part 10.3

**Notification log tab** (visible when `tab is log`)
- **Repeating group** (ID `log-list`): `Search for Royalty Notifications` sorted by `requested_at` descending
  - Columns: Requested (`requested_at:formatted as 7 Oct 2026 14:05`), Author (`author's name`), Trigger (`trigger_type's Display`), Status badge (background `status's bg_color`, conditionals as before), Completed (`completed_at`), Duration (`duration_ms / 1000` s), Model (`ai_model`), Email (`email_delivery`), Error (`error_message`, truncated to 80 characters)
  - Button `View email` (visible when `email_html is not empty`) → *Display data in group/popup* Popup `Email preview` (type Royalty Notification) → *Show* the popup. The popup holds an **HTML** element whose content is `Parent group's Royalty Notification's email_html`, plus `To: [intended_recipient] (delivered to [delivered_to])`.

### 7.7 Page `admin_author` (type of content: **Author**)
- *Page is loaded* → *Go to page* `index` **Only when** `Current User's role is not Admin`
- `Header`, link `← All authors`, heading `Current page Author's name` · `city` · `email`
- `Royalty View`, data source `Current page Author`
- **Payout history** repeating group: `Search for Payouts (author = Current page Author)` sorted by `paid_on` descending, showing book title, `amount`, `paid_on`, `note`
- **Generate & Send** block (Part 10.2)
- **This author's notifications**: the log repeating group from 7.6 with an extra constraint `author = Current page Author`

---

## Part 8 · Create the logins (10 min, or let the script do it)

The demo password for every account is `BookLeaf@2026`. Admins use the `@bookleaf.demo` domain, which `attach_account` turns into the Admin role.

| Login | Role |
|---|---|
| `admin@bookleaf.demo` | Admin |
| the 10 author emails from the dataset (`priya.sharma@email.com` …) | Author |

**Automatic:** with `signup_open` = yes, run `BUBBLE_APP_URL=https://bookleaf-royalty.bubbleapps.io/version-test node scripts/bubble-create-logins.mjs` (it fills the `setup` page for each account). **By hand:** use the Create login form 11 times.

Then **App data → App Settings → `signup_open` = no**.

✅ **Check, data isolation:** open `version-test`, sign in as `priya.sharma@email.com`. You see exactly 2 books (*Whispers of the Ganges*, *The Saffron Diaries*). Sign in as `ananya.reddy@email.com`: 1 book, *Overdue*. In App data → User → `priya…` → **Run as** → the dashboard shows only Priya's data. Visiting `/admin` as an author bounces you back.

---

## Part 9 · Connect n8n: API Connector (30 min)

Do this after importing the workflows into n8n (README §6: you need the production webhook URL and the webhook key).

1. **Plugins → Add plugins → API Connector** (by Bubble) → Install.
2. **Add another API** → name `BookLeaf n8n` → Authentication **None or self-handled**.
   - **Shared headers**: `X-BookLeaf-Key` = *your webhook key* → tick **Private** (it then never reaches the browser). `Content-Type` = `application/json`.
3. **Add another call** → name `Generate royalty summary`
   - *Use as*: **Action** · *Data type*: JSON · **POST** · URL: `https://<your-n8n>/webhook/bookleaf/royalty-summary`
   - Tick **Include errors in response and allow workflow actions to continue**: this is what lets Bubble record *Failed* instead of stopping when n8n is down or returns an error.
   - *Body type*: JSON. Paste this body exactly:

```json
{
  "schema_version": "1",
  "notification_id": "<notification_id>",
  "idempotency_key": "<idempotency_key>",
  "trigger_type": "<trigger_type>",
  "triggered_by": "<triggered_by>",
  "requested_at_ms": "<requested_at_ms>",
  "as_of_ms": "<as_of_ms>",
  "simulate_failure": "<simulate_failure>",
  "dry_run": "<dry_run>",
  "author": {
    "author_id": "<author_id>",
    "name": <author_name>,
    "email": "<author_email>",
    "city": <author_city>
  },
  "books": [<books>]
}
```

   - For every `<param>`, untick *Private* (so workflows can fill it) and enter the sample value below for initialisation:

| Param | Sample value |
|---|---|
| notification_id | `init-test-001` |
| idempotency_key | `init-test-001` |
| trigger_type | `Single` |
| triggered_by | `admin@bookleaf.demo` |
| requested_at_ms | `1767225600000` |
| as_of_ms | `1767225600000` |
| simulate_failure | *(empty)* |
| dry_run | `yes` |
| author_id | `AUTH001` |
| author_name | `"Priya Sharma"` *(with the quotes)* |
| author_email | `priya.sharma@email.com` |
| author_city | `"Mumbai"` *(with the quotes)* |
| books | `{"book_id":"BK001","title":"Whispers of the Ganges","status":"Published & Live","is_published":"yes","publication_date_ms":"1687199400000","royalty_per_copy":"35","copies_sold":"342","royalty_earned":"11970","royalty_paid":"8400","royalty_pending":"3570","last_payout_date_ms":"1760466600000"}` |

4. Click **Initialize call**. n8n answers a *dry run* instantly with every field filled. Check that `completed_at` is detected as a **date** (change the type in the response list if it shows text) and `total_*`, `ai_attempts`, `duration_ms` as **numbers** → **Save**.
5. Set `dry_run`'s sample value back to `no`.

*Why `author_name` and `title` have no quotes in the template:* they are filled with Bubble's `:formatted as JSON-safe`, which adds the quotes and escapes anything (like `"` or `'`) that would break the JSON.

---

## Part 10 · Notification workflows (40 min)

### 10.1 Backend workflows
**`send_royalty_summary`**: parameter `notification` (Royalty Notification), *Ignore privacy rules* ✅
1. *Make changes* → `notification`: `status` = `Processing`, `started_at` = `Current date/time`
2. **Plugins → BookLeaf n8n – Generate royalty summary**, with:
   - `notification_id` = `notification's unique id`
   - `idempotency_key` = `notification's idempotency_key`
   - `trigger_type` = `notification's trigger_type's Display`
   - `triggered_by` = `notification's triggered_by's email`
   - `requested_at_ms` = `Current date/time:extract UNIX`
   - `as_of_ms` = `Search for App Settings:first item's status_as_of_date:extract UNIX`
   - `simulate_failure` = `notification's simulate_failure`
   - `dry_run` = `no`
   - `author_id` = `notification's author's author_code`
   - `author_name` = `notification's author's name:formatted as JSON-safe`
   - `author_email` = `notification's author's email`
   - `author_city` = `notification's author's city:formatted as JSON-safe`
   - `books` = `Search for Books (author = notification's author):format as text`, with *Content to show per list item* typed as below (each `[…]` is *Insert dynamic data* on *This Book*) and *Delimiter* `,`:

```
{"book_id":"[This Book's book_code]","title":[This Book's title:formatted as JSON-safe],"status":"[This Book's status's Display]","is_published":"[This Book's status's is_published]","publication_date_ms":"[This Book's publication_date:extract UNIX]","royalty_per_copy":"[This Book's royalty's royalty_per_copy]","copies_sold":"[This Book's royalty's copies_sold]","royalty_earned":"[This Book's royalty's royalty_earned]","royalty_paid":"[This Book's royalty's royalty_paid]","royalty_pending":"[This Book's royalty's royalty_pending]","last_payout_date_ms":"[This Book's royalty's last_payout_date:extract UNIX]"}
```
3. *Make changes* → `notification` **Only when** `Result of step 2's returned an error is no and Result of step 2's status is "Success"`:
   `status` = `Success`, `completed_at` = `Result of step 2's completed_at`, `email_subject`, `email_html`, `email_text`, `email_delivery`, `intended_recipient`, `delivered_to`, `ai_model`, `ai_attempts`, `prompt_version`, `n8n_execution_id`, `duration_ms` = the matching `Result of step 2's …` fields, `escalated_to_finance` = `Result of step 2's escalated_to_finance is "yes"`
4. *Make changes* → `notification` **Only when** `… returned an error is no and Result of step 2's status is "Duplicate"`:
   `status` = `Duplicate`, `completed_at` = `Result of step 2's completed_at`, `duplicate_of`, `error_message`
5. *Make changes* → `notification` **Only when** `… returned an error is no and Result of step 2's status is "Failed"`:
   `status` = `Failed`, `completed_at`, `error_code`, `error_message`, `email_subject`, `email_html`, `email_text`, `ai_model`, `n8n_execution_id` from the result
6. *Make changes* → `notification` **Only when** `Result of step 2's returned an error is yes`:
   `status` = `Failed`, `completed_at` = `Current date/time`, `error_code` = `n8n HTTP [Result of step 2's error status code]`, `error_message` = `Result of step 2's error body:truncated to 500`
   *(covers n8n unreachable, a wrong key (403), invalid data (400) and a crash (500))*

**`mark_timed_out`**: parameter `notification`. A watchdog so nothing stays "Processing" forever.
1. *Make changes* → `notification`: `status` = `Failed`, `completed_at` = `Current date/time`, `error_code` = `timeout`, `error_message` = `No answer from n8n within 3 minutes`.
   **Only when** `notification's status is Queued or notification's status is Processing`

**`queue_summary_for_author`**: parameters `author` (Author), `trigger_type` (Trigger Type), `batch_id` (text), `triggered_by` (User), `simulate_failure` (text). This is the single entry point used by both buttons.
- **Only when** (on the workflow itself, *or* on step 1):
  `Search for Royalty Notifications (author = author, status = Queued):count + Search for Royalty Notifications (author = author, status = Processing):count is 0`
  `and Search for Royalty Notifications (author = author, status = Success, completed_at > Current date/time +(minutes): -5):count is 0`
1. *Create a new thing* → Royalty Notification: `author`, `trigger_type`, `batch_id`, `triggered_by`, `simulate_failure` from the parameters; `status` = `Queued`; `requested_at` = `Current date/time`; `idempotency_key` = `[author's author_code]-[Current date/time:extract UNIX]`
2. *Schedule API workflow* `send_royalty_summary`, `notification` = `Result of step 1`, at `Current date/time`
3. *Schedule API workflow* `mark_timed_out`, `notification` = `Result of step 1`, at `Current date/time +(minutes): 3`

### 10.2 Single trigger (page `admin_author`)
- Button **Generate & Send Royalty Summary** (ID `send-summary`)
  - Conditional: **not clickable** and greyed when `page's sending is yes`, **or** this author has a Queued/Processing notification (the same counts as above, with `author = Current page Author`), **or** a Success in the last 5 minutes.
  - Text under it (ID `send-state`): `Sending… (status updates live below)` while active; `Sent [x] minutes ago: available again after the 5-minute cooldown` during cooldown.
- Dropdown **Test mode** (admins only, for the demo): choices `""`, `ai`, `email`, labelled *Normal* / *Simulate AI failure* / *Simulate email failure*
- **Workflow** *Button Generate is clicked*:
  1. *Set state* page `sending` = yes
  2. *Schedule API workflow* `queue_summary_for_author` (`author` = `Current page Author`, `trigger_type` = `Single`, `triggered_by` = `Current User`, `simulate_failure` = `Dropdown Test mode's value`)
  3. *Pause before next action* 2000 ms → *Set state* `sending` = no

The notifications list on the page updates by itself (Bubble pushes database changes to open pages): Queued → Processing → Success/Failed, with no refresh and no spinner.

### 10.3 Bulk trigger (page `admin`, popup `Confirm bulk`)
- Text: `This sends a royalty summary to [Search for Authors (total_pending > 0):count] authors with pending royalties, one every 8 seconds (Gemini free-tier rate limit). Authors with a summary in progress or sent in the last 5 minutes are skipped.`
- Button **Send** (ID `bulk-confirm`) →
  1. *Schedule API workflow on a list* → type Author, list `Search for Authors (total_pending > 0)`, workflow `queue_summary_for_author`, `author` = `This Author`, `trigger_type` = `Bulk`, `batch_id` = `bulk-[Current date/time:extract UNIX]`, `triggered_by` = `Current User`, interval = `Search for App Settings:first item's bulk_interval_seconds`
  2. *Hide* the popup → *Set state* `tab` = `log`

Same webhook, once per eligible author: exactly what the brief asks for.

✅ **Check:** on Priya's page, click Generate. Within ~5 s the row turns *Success* and *View email* shows the message; the email also arrives in the demo inbox. Click again immediately: the button is disabled. Pick *Simulate AI failure* on Meera's page → *Failed* with both models' errors. Run the bulk send → 9 rows appear, about 8 s apart.

---

## Part 11 · Error handling recap (what you should be able to explain)

| What goes wrong | What the admin sees |
|---|---|
| n8n is down / URL wrong | Row turns **Failed**, `n8n HTTP …` + the connection error (step 6) |
| Wrong webhook key | **Failed**, `n8n HTTP 403` |
| Bubble sends inconsistent data | **Failed**, `n8n HTTP 400` + which field |
| Gemini fails on both models | **Failed**, `ai_unavailable` + both errors |
| AI drafts fail the fact checks twice | **Failed**, `ai_output_invalid` + the violations |
| Email can't be delivered | **Failed**, `email_failed`; the generated email is kept |
| n8n crashes mid-run | **Failed**, `n8n HTTP 500`; n8n's error workflow emails ops |
| Bubble's own workflow dies | `mark_timed_out` marks it **Failed** after 3 min |
| Double click / second admin | Button disabled; if two requests still reach n8n, the second is **Duplicate** |

---

## Part 12 · Share with reviewers (5 min)

1. **Settings → General → Application rights** → **Everyone can view**. Free plans can't add collaborators, so reviewers get a read-only editor link instead: copy the editor URL from your browser (`https://bubble.io/page?id=bookleaf-royalty&tab=…`).
2. The live app is `https://bookleaf-royalty.bubbleapps.io/version-test` (free plans run the development version; *Deploy to live* is a paid feature).
3. Test logins: `admin@bookleaf.demo` and `ananya.reddy@email.com` (or any author), password `BookLeaf@2026`.
