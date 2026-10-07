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
| F16 | Bill rate and Why Me fields blank, labeled note has both | False "missing" / Forge rate check blocked | test: blank bill rate and Why Me come from a labeled note |
| F17 | Bill rate field and Why Me already filled | Note overwrites a real value | test: a filled bill rate field and a filled Why Me are not replaced |
| F18 | Note is prose, or Why Me label is empty | Invented Why Me or a calculated rate | test: prose and an empty Why Me label do not invent text |
| F19 | Two notes disagree; one note is linked to the job | Wrong job's rate or Why Me | test: disagreeing notes are not guessed |
| F20 | W-2 2/3, 1099 3/4, VMS only on W-2, site lead $5 | Wrong split, or a rate invented to make it match | test: Dan's split checks |
| F21 | Live Bullhorn bill field blank, note has the rate | Draft blocked as a mismatch | test: a blank Bullhorn bill field does not block |
| F22 | Why Me note also contains another client's recruiter note, or that note is a separate Bullhorn note | Internal note in the client email | test: Why Me from notes never includes an internal or other-client note |
| F23 | Open one Forge row, then another before the first preview returns | Previous candidate's draft stays on screen | test: preview race cannot show the previous candidate |
| F24 | Why Me names Lahey, SSM, CHRISTUS, or University Hospitals as past experience, and the same note has a client-label recruiter line | Experience deleted, or the recruiter line left in | test: Frary Why Me keeps experience and drops the other-client note |
| F25 | Positive reference on file; recruiter has not checked one | Reference included automatically | test: a reference is offered and left out until it is picked |
| F26 | Quote names the writer and their hospital, plus email, phone, and a LinkedIn URL | Writer or organization reaches the client | test: the reference guard strips the writer, the hospital, and contact details |
| F27 | No explicit title on the reference | A guessed job title | test: a missing title stays Former manager |
| F28 | Negative reference, or a note that is only "collecting references" | A bad quote or recruiter logistics in the email | test: negative and logistics notes are not offered |
| F29 | Recruiter picks are saved | Selection written to the Neon mirror | test: reference picks use the session database |
| F30 | Quote names the candidate and the writer in different sentences | Candidate name removed | test: the candidate name survives and a broken sentence is dropped |
| F31 | Writer's name sits in the middle of a sentence | Broken English in the client draft | test: the candidate name survives and a broken sentence is dropped |
| F32 | Recruiter edits the quote and types the writer's name | Writer name returns in the draft | test: the candidate name survives and a broken sentence is dropped |
| M2 | Manual smoke: create draft with PDF, open in Outlook, confirm PDF name and that nothing was sent | Real Graph/attachment behavior |
| M5 | Manual: Forge → Owner All → Chris Frary / Memorial Hermann SBO Analyst. Why Me from notes must not include the University Hospitals recruiter note. Then click Jake Given (Cook Children's) as soon as Frary's draft is up; the panel must not keep Frary's draft while Jake is selected. | Stale note or stale preview | Record date + result in the PR |
| M4 | Manual: open Forge on Internally Submitted Frary 886 and Jake Given 856. Blank bill rate / Why Me should show the note value labeled "from notes". A filled field stays. Digest JSON for those rows should not list them under missing. | Real note text differs from the fixtures | Record date + result in the PR |

## LinkedIn warm graph

Axes: key (email / LinkedIn URL / name+company / company only) · uniqueness (one record / two records) · company (exact / fuzzy / generic)

| # | Case | Risk if wrong | Covered by |
|---|------|---------------|------------|
| L1 | Two candidates share an email | Connection pinned to a guessed person | test: email match is high and unique |
| L2 | Name matches, company does not | Name-only match | test: unique name plus exact company is medium; name alone is not a match |
| L3 | Name matches two fuzzy companies (Epic Systems and Epic Games) | Guessed employer | test: fuzzy company is low, and two fuzzy companies are not a guess |
| L4 | Self-employed / Health as a company | Every generic row sticks to a client | test: client company match … skips generic labels |
| L5 | Badge or status payload includes the connection email | Personal graph leaves the app | test: badge payload never includes the connection email |
| L6 | Tools page offers a connection export | Full graph download | test: dashboard surfaces do not add a connection export |
| L7 | Connections.csv of 26k rows stays on one HTTP request through ingest and match | Edge returns 499; the browser shows Failed to fetch after the rows have landed | test: upload acks before matching and status stays readable |
| L8 | The upload response is lost after the server has accepted the file | UI shows Failed to fetch for a job that is still matching | test: a dropped upload response follows the running job |

## Clients page placement counts

Axes: company id shape (integer / numeric string / `{id}` / bare id) · where the company lives (placement column / placement.clientCorporation / jobOrder.clientCorporation / jobs.client_id) · person (client corporation vs client contact) · status (Actively On Contract / anything else)

| # | Case | Risk if wrong | Covered by |
|---|------|---------------|------------|
| C1 | query/Placement stores no company id; the job's clientCorporation is an integer, a numeric string, or a bare id. A client contact id is also present. | Clients page shows 0 placed consultants while Placements shows the active rows | test: active placements join to clients across real id shapes |
| C2 | Neon placements/jobs query mentions is_deleted, and that column is missing | The placement query throws, the error is swallowed, and the counts stay 0 | test: client placement SQL does not require is_deleted |
| M6 | Manual: Clients summary "Placed Consultants" equals Placements "Total Active". "Clients w/ Placements" equals the distinct companies on those active rows. | Counts still disagree after deploy | Record date + result in the PR |

## Live toasts and session host

| # | Case | Risk if wrong | Covered by |
|---|------|---------------|------------|
| T1 | Forge Create gets HTTP 200 created:false (no mailbox / missing Graph scope) | Red toast reads as a crash; copy-the-email panel is the instruction | test: soft outlook failure does not raise an error toast |
| T2 | Forge Create or Capture Commit while the session is dead (401) | "Sign in required" error toast on top of the login redirect | test: sign-in redirect does not also toast |
| T3 | Capture commit HTTP 200 with some results ok:false | Red "N written, M failed" for a partial write | test: partial capture commit uses a warn toast |
| T4 | Bullhorn callback host is *.up.railway.app, user is on dashboard.anuraconnect.com | Session cookie stuck on the railway host | test: production callback host hands the session to the custom domain |
| T5 | Deploy or process restart while the bh_session cookie is still inside 24h | Everyone is sent back through Bullhorn login | test: a session saved in Postgres is restored by a new process |
| T6 | Session table created on the Neon Bullhorn mirror (DATABASE_URL) | App login rows mixed into the Bullhorn clone | test: the Neon Bullhorn mirror is not the session database |
| M3 | Manual: Forge Create with Outlook disconnected — yellow panel, no red toast. Expired session on Create or Write to Bullhorn — login page, no red toast | Real cookie / Graph behavior | Record date + result in the PR |
| M5 | Manual: log in on dashboard.anuraconnect.com, redeploy or restart the Railway service, reload. Still signed in. Forge and Mail still see that user. Log out, restart, still logged out. Confirm app.user_sessions is on Railway Postgres, not Neon. | Real cookie and Railway Postgres | Record date + result in the PR |
