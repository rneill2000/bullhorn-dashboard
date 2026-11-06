# Submittal Forge audit (do not implement from this branch)

Audit of Forge on `main` after the v1 merge (`3e93195`). Findings only.

Forge v2 is being implemented by cloud agent `bc-9cda44fb`. This branch does not change `forge.js`, `public/forge-ui.js`, or any other application code. An earlier code commit on this branch was reverted so it would not conflict with v2. Do not merge this pull request.

Line numbers are `main` at the time of the audit.

## Confirmed hold

Creating an Outlook draft does not write Bullhorn. `forge.js` never calls `bhWrite`. The draft route posts Graph `/me/messages` and inserts `submittal_forge_drafts`. The response says status was not changed (`forge.js:922`). `Mark client submitted` is disabled (`public/forge-ui.js:168`). That matches the Bryce Plemons sub 810 smoke test.

Edits in the form (name, Why Me, availability, location, bill rate, subject, To) are sent only into that Outlook draft. They are not written back to Railway candidate/submission rows or to Bullhorn. A second click creates a second draft. Copy does not write anything.

## P0

### Date available shows one day early

`forge.js:109-114` formats Bullhorn date-only epochs with `timeZone: "America/Chicago"`. Those fields (`Candidate.dateAvailable`, submission `customDate2`) are midnight UTC. Chicago (UTC−5/−6) prints the previous calendar day. `pickAvailability` (`forge.js:246-254`) and the stale-date check use that same instant, so the warning can also fire on the evening of the correct Chicago day.

Fix direction for v2: format the UTC calendar date, and compare that date to today in Chicago. Do not use Chicago local time on the raw epoch.

### Pay and margin can reach the client email

Comment labels are only Why Me, Availability, Location, Bill Rate, and Name (`forge.js:128-134`). The dashboard submit template writes `Availability Date:`, `Pay Rate:`, and `Margin:`.

- `Availability Date:` does not match `^availability` plus a colon, because of the extra word `Date`. The line stays in Why Me.
- `Pay Rate:` is not a header, so it stays in Why Me.
- `Margin:` stays in the bill-rate section. `formatRate` returns the whole string when it contains letters, so the client line can include the margin.

Fix direction for v2: treat `Availability Date`, `Date Available`, `Pay Rate`, and `Margin` as their own sections. Never put pay or margin in the client bill-rate line.

### Submit to Job drops rate and availability and writes a status Forge cannot see

`POST /api/submissions` (`server.js:1267-1279`) reads `candidateId`, `jobId`, `comments`, and `notifyUsers`. The UI also sends `payRate`, `billRate`, and `availDate`. Those three are discarded. The create sets `status: "Internal Submission"`.

JobSubmission's real option is `Internally Submitted` (`docs/bullhorn-model/JobSubmission.json`). Forge's queue is `LOWER(s.status) = 'internally submitted'` (`forge.js:681`). The digest is the exact string `Internally Submitted` (`digest.js:50`). Rows stored as `Internal Submission` never show up.

Editable Anura fields, if v2 writes them: `customText10` Bill Rate, `customText11` Consultant Pay Rate, `customText12` Date Available / Notice Needed. `billRate`, `payRate`, and `customDate2` are read-only. Do not write those three or the create can fail.

## P1

### Submission bill rate is the wrong column

`submissions.client_bill_rate` is filled from `clientBillRate` (`db.js:1401`). JobSubmission has no `clientBillRate`. The editable bill rate is `customText10` (already in `SUBMISSION_FIELDS` and read at `forge.js:60`). The numeric field is read-only `billRate`, which is not requested (`db.js:980` requests `payRate` and `salary` only).

Forge order today (`forge.js:528-536`): comment rate, then `customText10`, then `submissions.client_bill_rate` (always empty), then `jobs.client_bill_rate`. Consultant pay lives in editable `customText11`, which is also not synced, so the pay-versus-bill guard only sees numeric `payRate`.

Job Bill Rate High / Low are `jobs.custom_float1` / `custom_float2` (JobOrder `customFloat1` / `customFloat2`). Forge does not read them. Do not silently send Bill Rate High as the client rate.

### Notice text is read but never synced

Forge selects `raw_json->>'customText12'` (`forge.js:61`). `SUBMISSION_FIELDS` stops at `customText10` (`db.js:983`). `customText12` is never in `raw_json`, so submission "Date Available, Notice Needed" is always blank and Forge falls through to candidate `date_available` (with the Chicago date bug).

`customDate2` (submission Date Available) is requested (`db.js:987`) and stored in `raw_json`, but Forge never reads it. Availability should be: comments, then `customText12`, then `customDate2`, then candidate `dateAvailable`.

New query fields appear on the next sync of that row. Untouched submissions keep the old `raw_json` until a full submissions sync. Incremental sync is every 5 minutes for `dateLastModified` only (`db.js:1923`).

### Location can mix two sources

`pickLocation` (`forge.js:233-237`) takes city from address, else custom City (`customText8`), and state from address, else custom State (`customText9`). A filled address city plus an empty address state becomes address city + custom state. Use one complete pair. When both address and custom City/State are complete and they differ, say which one won. Anura's labeled City/State are `customText8` / `customText9`. Candidate detail uses the address.

### Suggested mailbox casing

`suggestedMailbox` (`forge.js:781`) lowercases the user email and looks for that exact string in the mailbox list. Tokens are often mixed case, so the From dropdown does not preselect the signed-in mailbox and the draft can be saved on the first connected account. The POST path already compares case-insensitively. The suggestion should return the stored address.

### Sync can be stale with no signal

Forge reads only Postgres. The event feed (`events.js`) logs Bullhorn writes and does not refresh `candidates`, `jobs`, or `submissions`. A healthy loop is about 5 minutes behind for changed rows. If the loop is down, rates and availability stay old and the draft does not say so. v2 should surface `sync_state.last_incremental_sync` for submissions, candidates, and jobs.

`jobs.skill_list` is mapped from `skillList` (`db.js:1225`) but `JOB_FIELDS` does not request `skillList`, so the column stays empty.

## P2

| Item | Where |
|---|---|
| Why Me fallback uses `Candidate.description` (labeled Resume), not Candidate Notes (`customTextBlock1`). Last 3 notes are polish context only. | `forge.js` `templateWhyMe`, `loadNotes` |
| Grade (`customText6`) is loaded and not shown on the email form. | `forge.js` bundle select, `public/forge-ui.js` |
| Other screens format Bullhorn dates with `toLocaleDateString()` and no time zone. On a UTC host that matches the UTC date. On a Chicago host they are one day early too. | `server.js:1133`, `db.js:2042` |
| Submit-form date prefill does `new Date(localeString).toISOString()`. Fragile. Chicago + a UTC server usually stays on the right day. | `public/index.html` submit form, around the `submit-avail-date` prefill |
| Nested `candidate`, `jobOrder`, and `sendingUser` are requested without subfields. If Bullhorn returns ids only, name and "submitted by" depend on the candidate and job joins. Job title already falls back to `jobs.title`. Client name does not fall back to `jobs.client_name`. | `db.js:976-979`, `forge.js:57-62` |
| When address and custom city/state are both complete, address wins. | `forge.js:235-237` |

## Résumé

Rachel: the PDF must come from Bullhorn files. Do not add or extend `RESUME_TOOL_*`.

Today, if `RESUME_TOOL_API_URL` is unset, Forge creates the draft with no PDF and the UI links to ResumeKiln (`forge.js:18-23`, `forge.js:624`, `public/forge-ui.js:163`). Bullhorn files are already listed and downloaded at `GET /api/candidates/:id/files` and `GET /api/candidates/:id/files/:fileId` (`server.js:7284`). No open PR for the file dropdown was on the repo at audit time. Leave that to v2.

## Field map

Every Forge field is loaded from Railway Postgres. Nothing on open calls Bullhorn live.

| Forge field | Postgres | Bullhorn |
|---|---|---|
| Queue status | `submissions.status` | JobSubmission.status `Internally Submitted` |
| Candidate name | `submissions.candidate_name` | nested candidate first/last at sync |
| Job title | `jobs.title`, else `submissions.job_title` | JobOrder.title |
| Client | `submissions.client_name` only | client on the submission snapshot |
| Subject | derived from title and certs | not stored |
| Certs / role / grade | `candidates.custom_text1`, `2`, `5`, `6` | Primary Certification(s), Secondary Certification(s), Epic Role, Candidate Grade |
| Why Me | comments section, else occupation + cert + description | JobSubmission.comments; Candidate.description is the Resume field |
| Availability | comments, else `customText12` (not synced), else `candidates.date_available` | submission notice text, else candidate Date Available. `customDate2` ignored |
| Location | comments, else address city/state, else `customText8`/`9` | address, or City / State |
| Bill rate | comments, else `customText10`, else `submissions.client_bill_rate` (wrong field), else `jobs.client_bill_rate` | customText10 Bill Rate; job Client Bill Rate. Pay withheld only when it matches numeric `payRate` |
| SLA | `submissions.date_added` | dateAdded timestamp (elapsed time, not a date-only field) |
| To | `client_contacts` | ClientContact email |
| From | Outlook tokens | not Bullhorn |
| Résumé | ResumeKiln env URL | not Bullhorn files |

## Write map

| Action | Railway | Bullhorn | Outlook |
|---|---|---|---|
| Open queue or preview | read | no | no |
| Edit the form | not saved | no | only on create |
| Create Outlook draft | insert `submittal_forge_drafts` | no status change, no field write | `POST /me/messages` only. No `sendMail` |
| Dashboard Submit to Job | note insert if that succeeds; the submission arrives on the next sync | create with status `Internal Submission`, comments only. Pay, bill, and availability dropped | colleague notification only if someone was tagged |
