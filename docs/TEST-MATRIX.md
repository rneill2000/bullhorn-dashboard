# Test matrix — run before every merge

Rule: every row that can cost money or trust has an automated test or a recorded manual smoke.
If a bug escapes, add its row (and a failing test) BEFORE the fix.
Run: `node --test` (CI runs it on every PR; a red run blocks merge).

## Quick Capture

Axes: who (named / unnamed / colleague / ambiguous) · person type (candidate / contact) · job reference (none / clear / vague / tie / no jobs) · link result (confirmed / fallback / not confirmed) · content (normal / empty) · kind (note / task / job / opportunity)

| # | Case | Risk if wrong | Covered by |
|---|------|---------------|------------|
| Q1 | Note, no person named, client known | Note lands on a random contact | test: note with no named person asks who… |
| Q2 | Commit a note with no person | Silent fallback write | test: commit refuses a note with no person… |
| Q3 | New job, no hiring contact | Random contact on a job | tests: new job … / commit refuses a new job… |
| Q4 | Opportunity, no contact | Random contact on a deal | test: opportunity with no contact… |
| Q5 | "Send Peter X" (colleague, first name, no company) | Task linked to a client named Peter | test: internal to-do about a colleague… |
| Q6 | Colleague full name vs client contact sharing first name | Wrong link either way | test: colleague full name is internal… |
| Q7 | Candidate note, clear job hint, 2 submissions | Note on the wrong job | test: candidate note is matched to the submission… |
| Q8 | Candidate note, vague hint ("his analyst role") | Guessed job | test: vague job hint asks which job… |
| Q9 | Two jobs equally match the hint | Guessed job | test: tied job hint asks |
| Q10 | Note with no job hint | Note forced onto a job | test: note with no job hint stays on the person only |
| Q11 | Candidate with no submissions but a hint | Question with no options / crash | test: candidate with no submissions stays person-only |
| Q12 | Contact note, hint matches the client's open job; closed job ignored | Note on a closed req | test: contact note links to the client's open job… |
| Q13 | Job link confirmed on read-back | Reports success that didn't happen | test: commit writes the note on the person AND the job… |
| Q14 | Job link missing on read-back | Silent missing link | test: commit flags the entry if Bullhorn does not show… |
| Q15 | jobOrders association fails, NoteEntity fallback works | Link lost | test: falls back to NoteEntity… |
| Q16 | Same job listed twice | Duplicate link calls | test: duplicate job ids link once |
| Q17 | Empty note text | Blank note in Bullhorn | test: empty note is refused… |
| Q18 | Person picked by hand later | Jobs never load | test: picking a person by hand loads their jobs… |
| Q19 | Source still has a "most recent contact" fallback | Regression | test: no 'most recent contact' fallback… |
| M1 | Manual smoke after deploy: paste the Bryce/Jonathan/Skagit/Peter sample, write Bryce's note, open job 336 in Bullhorn | Real API differs from fakes | Record date + result in the PR |

## Submittal Forge (rows for the v2 work — tests land with the code)

Axes: owner (mine / other) · status (internal / client-submitted / closed) · client (same / different) · rate (match / mismatch / missing) · resume (default / client-tailored / none) · availability date (past / today / UTC-midnight) · comments (labeled / HTML / internal note / empty)

| # | Case | Risk |
|---|------|------|
| F1 | Comments contain "Pay Rate: 120 at 1099" | Pay rate to client |
| F2 | Comments start "Hi Peter…" / references / C2H | Internal note to client |
| F3 | HTML comments with inline labels | Markup in email; missed bill rate/location |
| F4 | No labeled Why Me | Raw dump sent |
| F5 | Bill rate differs from live Bullhorn | Wrong rate to client |
| F6 | Submission client blank, job has client | No recipients / wrong client |
| F7 | Two jobs same client, different owners | Two owners pitch one candidate |
| F8 | "Mine" filter on owner A, other row is owner B's | Badge hidden |
| F9 | Same client, other submission already client-submitted | Duplicate submittal (red) |
| F10 | Same client, rates differ | Two rates to one client (red) |
| F11 | Same client, resume from the earlier draft | Client gets two résumé versions |
| F12 | Client-tailored PDF for a different client | Wrong cut sent |
| F13 | date_available 2026-10-01T00:00:00Z | Off-by-one date |
| F14 | Availability in the past | Stale date to client |
| F15 | Draft already exists | Duplicate drafts |
| M2 | Manual smoke: create draft with PDF, open in Outlook, confirm PDF name and that nothing was sent | Real Graph/attachment behavior |

## Live toasts and session host

| # | Case | Risk if wrong | Covered by |
|---|------|---------------|------------|
| T1 | Forge Create gets HTTP 200 created:false (no mailbox / missing Graph scope) | Red toast reads as a crash; copy-the-email panel is the instruction | test: soft outlook failure does not raise an error toast |
| T2 | Forge Create or Capture Commit while the session is dead (401) | "Sign in required" error toast on top of the login redirect | test: sign-in redirect does not also toast |
| T3 | Capture commit HTTP 200 with some results ok:false | Red "N written, M failed" for a partial write | test: partial capture commit uses a warn toast |
| T4 | Bullhorn callback host is *.up.railway.app, user is on dashboard.anuraconnect.com | Session cookie stuck on the railway host | test: production callback host hands the session to the custom domain |
| M3 | Manual: Forge Create with Outlook disconnected — yellow panel, no red toast. Expired session on Create or Write to Bullhorn — login page, no red toast | Real cookie / Graph behavior | Record date + result in the PR |
