# How Bullhorn is built — Anura Connect's instance

Written from Bullhorn's own metadata (`meta=full`) and Anura's configured settings, 2026-10-02.
This is the spec the rebuild follows. Field-level detail for every entity is in `README.md`; raw metadata per entity is in the `.json` files.

## 1. The shape of it

Bullhorn is seven core records and the links between them. Everything else hangs off these.

```
ClientCorporation (shown as "Company")
   └── ClientContact ("Contact")          — people at the company
   └── JobOrder ("Job")                   — a role the company wants filled
         └── JobSubmission                — ONE CANDIDATE ↔ ONE JOB, with a status. This is the pipeline.
               └── JobSubmissionHistory  — every status change, with timestamp and who did it
               └── Sendout               — the moment a candidate was sent to the client contact
               └── Appointment           — interviews
               └── Placement             — when a submission becomes a hire/contract
                     └── PlacementChangeRequest — proposed edits to a live placement (rate, end date), approved separately
   └── Opportunity (shown as "MSA")       — agreement-level deal with the company; a JobOrder can point at one
Candidate                                — the consultant; has Education, WorkHistory, References, Certifications
Lead                                     — a person not yet a Contact; converts into Contact + Company
Note / Task / Appointment                — activity, attachable to any of the above
Tearsheet                                — a saved list of records (people or jobs) for a campaign or hotlist
CorporateUser                            — your team; every record has owner(s) and an "added by"
```

Three structural rules that drive how screens work:

1. **The Job Submission is the unit of recruiting.** A candidate isn't "on" a job; a JobSubmission row is. Its `status` field is the pipeline stage. Moving a candidate through stages = changing that one field; Bullhorn writes a JobSubmissionHistory row each time, which is how time-in-stage and conversion reporting work.
2. **A Placement is a copy, not a link.** When a submission is placed, Bullhorn creates a Placement with its own rates, dates, and ~300 fields, snapshotting the job's `correlatedCustom*` fields into it. Editing the job afterward does not change the placement. Changes to a live placement go through PlacementChangeRequest and an approval.
3. **Custom fields are first-class.** Anura has renamed ~70 generic slots (`customText3` = "Preferred Role(s)", `customFloat1` = "Bill Rate High") and these appear on screens under their labels. The rebuild must use labels from metadata, never hard-coded names.

## 2. Anura's configuration (what makes this instance *yours*)

**Entity labels:** Candidate, Contact, Company, Job, Placement, **MSA** (Opportunity), Lead. Novo UI enabled. Currency USD.

**Pipeline — JobSubmission.status, in the order the team uses it:**
Reached Out → Recruiter Screen → Internally Submitted → *(sent to client)* → Candidate (client reviewing) → Offer Out → Offer Accepted
Exits: Unavailable, Sales Rejected, Client Rejected, Withdrew, Offer Rejected, On Hold / Hold.
"Internally Submitted" is the recruiter-to-sales handoff; "Sent to client" is recorded as a Sendout rather than a status.

**Job.status:** Accepting Candidates, Covered, On Hold, Offer Out, Placed, Lost - Competitor, Lost - Filled Internally, Lost, Archive.
**Placement.status:** Submitted, Rejected, Actively On Contract, Drop Out, Terminated, Contract Completed, Direct Hire Completed.
**Candidate.status:** Not Screened, Active, Active-Reviewed, Placed, DNU, Archive, Not Seeking Employment, Former Anura Consultant.
**Company.status:** Unqualified, Proposal, Active Account, Passive Account, DNC, Archive. **Contact.status:** Active, Passive, DNC, Left Company, Archive, Private.
**MSA.status:** Identified, Qualifying, Negotiating, Legal Review, Executed, Burner, Closed. **Lead.status:** New Lead, Qualifying, Unqualified, No Interest, Non-Responsive, Converted.

**Anura's custom fields, by record:**

| Record | Fields the team actually uses |
|---|---|
| Candidate | Primary Certification(s), Secondary Certification(s), Preferred Role(s), Travel Preferences, Epic Role, Candidate Grade, Candidate Urgency, Credentials, City, State, Sourced By, Candidate Notes, Submission Count, Bullhorn Automation Score |
| Contact | LinkedIn Profile, Bullhorn Automation Score |
| Company | Type, Contract Status (No MSA / MSA In Progress / Signed MSA / Signed MSA - Expired), Background Check Required, Drug Screen Required, Special Screening, Growth Plan, Submission Requirements Detail |
| Job | Bill Rate High/Low, Expected Value, Rate Notes, Contract Duration, Recruiting Owner, Sales Owner, Background/Drug/Special screening, Next Steps, Submission Requirements Detail |
| Submission | Bill Rate, Consultant Pay Rate, Date Available, Date Available/Notice Needed |
| Placement | Consultant Advocate, Extension Contract, plus a 9-row rate card (OT 12Hr, Specialty, Holiday, Call Back, On Call, Charge, Shut Down, Flat, Long-Term) for bill and pay |
| MSA | MSA Effective/Expiration Date, NDA Signed Date, Term Length, Renewal Notice Days, Next Action, Auto-Renewal, Exclusivity, Rate Card Attached, Client Signing Authority, Key Commercial Terms, Negotiation Notes |

## 3. What a screen is, in Bullhorn terms

Every Bullhorn screen is one of four things:

- **List view** of one entity: a saved column set + filters + sort over `search/<Entity>`. Columns are fields; filters are field conditions. The team's saved views are the spec.
- **Record view** of one row: a header card (name, status, owner, key fields), a tab strip. Tabs are either the record's own fields (Overview, Edit) or a list view of a *related* entity filtered to this record (Notes, Activity, Submissions, Placements, Files, Tearsheets). So most tabs are list views in disguise.
- **Form**: add/edit for one entity, laid out from the entity's field list in the order Bullhorn's "field map" defines. Required flags and pick lists come from metadata.
- **Action**: a status change or a link creation (Add Submission, Send Out, Add Placement, Convert Lead, Add to Tearsheet). Each is a small form that writes one row and usually a history/note row.

This is why the rebuild is tractable: 7 entities × (list + record + form) plus ~10 actions, all driven by one metadata file.

## 4. What is *not* in the API, and must be handled separately

- Attachments (resumes, contracts) — fetched per record via the file endpoints; archived separately.
- Email bodies logged through Bullhorn's Outlook add-in — stored as Notes with action "Email"; the attachment-level email is not retrievable.
- Field maps / screen layouts — not exposed; captured from screenshots of your Bullhorn.
- Reports, saved searches, user preferences — not exposed; rebuilt from what the team says they use.
- Bullhorn Automation (newsletter journeys) — separate product, separate rebuild.
