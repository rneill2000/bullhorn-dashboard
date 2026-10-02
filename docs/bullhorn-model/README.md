# Bullhorn data model — Anura Connect instance

Generated 2026-10-02 from Bullhorn's own metadata (meta=full). Custom fields carry their configured labels.

## Relationships

| From | Field | To | Type |
|---|---|---|---|
| Candidate | activePlacements | Placement | TO_MANY |
| Candidate | addressSourceLocation | Location | TO_ONE |
| Candidate | branch | Branch | TO_ONE |
| Candidate | businessSectors | BusinessSector | TO_MANY |
| Candidate | candidateSource | CandidateSource | TO_ONE |
| Candidate | categories | Category | TO_MANY |
| Candidate | category | Category | TO_ONE |
| Candidate | certificationList | CandidateCertification | TO_MANY |
| Candidate | clientCorporationBlackList | ClientCorporation | TO_MANY |
| Candidate | clientCorporationWhiteList | ClientCorporation | TO_MANY |
| Candidate | customObject1s | PersonCustomObjectInstance1 | TO_MANY |
| Candidate | educations | CandidateEducation | TO_MANY |
| Candidate | fileAttachments | CandidateFileAttachment | TO_MANY |
| Candidate | interviews | Appointment | TO_MANY |
| Candidate | leads | Lead | TO_MANY |
| Candidate | linkedPerson | Person | TO_ONE |
| Candidate | locations | Location | TO_MANY |
| Candidate | notes | Note | TO_MANY |
| Candidate | owner | CorporateUser | TO_ONE |
| Candidate | parsedResumeFile | CandidateFileAttachment | TO_ONE |
| Candidate | placements | Placement | TO_MANY |
| Candidate | primarySkills | Skill | TO_MANY |
| Candidate | references | CandidateReference | TO_MANY |
| Candidate | referredByPerson | Person | TO_ONE |
| Candidate | secondaryOwners | CorporateUser | TO_MANY |
| Candidate | secondarySkills | Skill | TO_MANY |
| Candidate | sendouts | Sendout | TO_MANY |
| Candidate | shifts | Shift | TO_MANY |
| Candidate | specialties | Specialty | TO_MANY |
| Candidate | submissions | JobSubmission | TO_MANY |
| Candidate | tasks | Task | TO_MANY |
| Candidate | tearsheets | Tearsheet | TO_MANY |
| Candidate | trust | CandidateTrustData | TO_ONE |
| Candidate | userType | UserType | TO_ONE |
| Candidate | webResponses | JobSubmission | TO_MANY |
| Candidate | workHistories | CandidateWorkHistory | TO_MANY |
| ClientContact | activePlacements | Placement | TO_MANY |
| ClientContact | addressSourceLocation | Location | TO_ONE |
| ClientContact | appointments | Appointment | TO_MANY |
| ClientContact | branch | Branch | TO_ONE |
| ClientContact | businessSectors | BusinessSector | TO_MANY |
| ClientContact | categories | Category | TO_MANY |
| ClientContact | category | Category | TO_ONE |
| ClientContact | clientCorporation | ClientCorporation | TO_ONE |
| ClientContact | clientLocations | Location | TO_MANY |
| ClientContact | customObject1s | PersonCustomObjectInstance1 | TO_MANY |
| ClientContact | departmentOwners | CorporationDepartment | TO_MANY |
| ClientContact | fileAttachments | ClientContactFileAttachment | TO_MANY |
| ClientContact | interviews | Appointment | TO_MANY |
| ClientContact | jobOrders | JobOrder | TO_MANY |
| ClientContact | jobSubmissions | JobSubmission | TO_MANY |
| ClientContact | leads | Lead | TO_MANY |
| ClientContact | linkedPerson | Person | TO_ONE |
| ClientContact | notes | Note | TO_MANY |
| ClientContact | opportunities | Opportunity | TO_MANY |
| ClientContact | owner | CorporateUser | TO_ONE |
| ClientContact | placements | Placement | TO_MANY |
| ClientContact | referredByPerson | Person | TO_ONE |
| ClientContact | reportToPerson | Person | TO_ONE |
| ClientContact | secondaryOwners | CorporateUser | TO_MANY |
| ClientContact | sendouts | Sendout | TO_MANY |
| ClientContact | skills | Skill | TO_MANY |
| ClientContact | specialties | Specialty | TO_MANY |
| ClientContact | tasks | Task | TO_MANY |
| ClientContact | tearsheets | Tearsheet | TO_MANY |
| ClientContact | userType | UserType | TO_ONE |
| ClientCorporation | branch | Branch | TO_ONE |
| ClientCorporation | certificationGroups | CertificationGroup | TO_MANY |
| ClientCorporation | certifications | ClientCorporationCertification | TO_MANY |
| ClientCorporation | childClientCorporations | ClientCorporation | TO_MANY |
| ClientCorporation | clientContactNotes | Note | TO_MANY |
| ClientCorporation | clientContacts | ClientContact | TO_MANY |
| ClientCorporation | department | CorporationDepartment | TO_ONE |
| ClientCorporation | departmentOwners | CorporationDepartment | TO_MANY |
| ClientCorporation | fileAttachments | ClientCorporationFileAttachment | TO_MANY |
| ClientCorporation | leads | Lead | TO_MANY |
| ClientCorporation | locations | Location | TO_MANY |
| ClientCorporation | owners | CorporateUser | TO_MANY |
| ClientCorporation | parentClientCorporation | ClientCorporation | TO_ONE |
| ClientCorporation | requirements | Certification | TO_MANY |
| ClientCorporation | userOwners | CorporateUser | TO_MANY |
| JobOrder | appointments | Appointment | TO_MANY |
| JobOrder | approvedPlacements | Placement | TO_MANY |
| JobOrder | assignedUsers | CorporateUser | TO_MANY |
| JobOrder | branch | Branch | TO_ONE |
| JobOrder | businessSectors | BusinessSector | TO_MANY |
| JobOrder | categories | Category | TO_MANY |
| JobOrder | certificationGroups | CertificationGroup | TO_MANY |
| JobOrder | certifications | Certification | TO_MANY |
| JobOrder | clientContact | ClientContact | TO_ONE |
| JobOrder | clientCorporation | ClientCorporation | TO_ONE |
| JobOrder | fileAttachments | JobOrderFileAttachment | TO_MANY |
| JobOrder | interviews | Appointment | TO_MANY |
| JobOrder | jobOrderScreenerQuestions | JobOrderScreenerQuestion | TO_MANY |
| JobOrder | location | Location | TO_ONE |
| JobOrder | notes | Note | TO_MANY |
| JobOrder | opportunity | Opportunity | TO_ONE |
| JobOrder | owner | CorporateUser | TO_ONE |
| JobOrder | placements | Placement | TO_MANY |
| JobOrder | publishedCategory | Category | TO_ONE |
| JobOrder | reportToClientContact | ClientContact | TO_ONE |
| JobOrder | responseUser | CorporateUser | TO_ONE |
| JobOrder | sendouts | Sendout | TO_MANY |
| JobOrder | shift | Shift | TO_ONE |
| JobOrder | shifts | Shift | TO_MANY |
| JobOrder | skills | Skill | TO_MANY |
| JobOrder | specialties | Specialty | TO_MANY |
| JobOrder | submissions | JobSubmission | TO_MANY |
| JobOrder | tasks | Task | TO_MANY |
| JobOrder | tearsheets | Tearsheet | TO_MANY |
| JobOrder | timeUnits | TimeUnit | TO_MANY |
| JobOrder | webResponses | JobSubmission | TO_MANY |
| JobOrder | workersCompRate | WorkersCompensationRate | TO_ONE |
| JobSubmission | appointments | Appointment | TO_MANY |
| JobSubmission | branch | Branch | TO_ONE |
| JobSubmission | candidate | Candidate | TO_ONE |
| JobSubmission | history | JobSubmissionHistory | TO_MANY |
| JobSubmission | jobOrder | JobOrder | TO_ONE |
| JobSubmission | jobSubmissionCertificationRequirements | JobSubmissionCertificationRequirement | TO_MANY |
| JobSubmission | latestAppointment | Appointment | TO_ONE |
| JobSubmission | owners | CorporateUser | TO_MANY |
| JobSubmission | sendingUser | Person | TO_ONE |
| JobSubmission | tasks | Task | TO_MANY |
| JobSubmissionHistory | jobSubmission | JobSubmission | TO_ONE |
| JobSubmissionHistory | modifyingUser | Person | TO_ONE |
| Placement | appointments | Appointment | TO_MANY |
| Placement | approvingClientContact | ClientContact | TO_ONE |
| Placement | backupApprovingClientContact | ClientContact | TO_ONE |
| Placement | billingClientContact | ClientContact | TO_ONE |
| Placement | branch | Branch | TO_ONE |
| Placement | bteSyncStatus | BteSyncStatusLookup | TO_ONE |
| Placement | candidate | Candidate | TO_ONE |
| Placement | changeRequests | PlacementChangeRequest | TO_MANY |
| Placement | clientContact | ClientContact | TO_ONE |
| Placement | clientCorporation | ClientCorporation | TO_ONE |
| Placement | commissions | PlacementCommission | TO_MANY |
| Placement | fileAttachments | PlacementFileAttachment | TO_MANY |
| Placement | housingAmenities | HousingComplexAmenity | TO_MANY |
| Placement | jobLocation | Location | TO_ONE |
| Placement | jobOrder | JobOrder | TO_ONE |
| Placement | jobSubmission | JobSubmission | TO_ONE |
| Placement | lastApprovedPlacementChangeRequest | PlacementChangeRequest | TO_ONE |
| Placement | location | Location | TO_ONE |
| Placement | notes | Note | TO_MANY |
| Placement | owner | CorporateUser | TO_ONE |
| Placement | owners | CorporateUser | TO_MANY |
| Placement | payrollEmployeeType | PayrollEmployeeTypeLookup | TO_ONE |
| Placement | payrollSyncStatus | PayrollSyncStatusLookup | TO_ONE |
| Placement | placementCertifications | PlacementCertification | TO_MANY |
| Placement | shift | Shift | TO_ONE |
| Placement | statementClientContact | ClientContact | TO_ONE |
| Placement | tasks | Task | TO_MANY |
| Placement | timeAndExpense | PlacementTimeAndExpense | TO_ONE |
| Placement | timeUnits | TimeUnit | TO_MANY |
| Placement | userHousingComplexUnits | UserHousingComplexUnit | TO_MANY |
| Placement | vendorClientCorporation | ClientCorporation | TO_ONE |
| Placement | workersCompensationRate | WorkersCompensationRate | TO_ONE |
| PlacementChangeRequest | approvingClientContact | ClientContact | TO_ONE |
| PlacementChangeRequest | approvingUser | CorporateUser | TO_ONE |
| PlacementChangeRequest | backupApprovingClientContact | ClientContact | TO_ONE |
| PlacementChangeRequest | billingClientContact | ClientContact | TO_ONE |
| PlacementChangeRequest | editHistory | PlacementChangeRequestEditHistory | TO_MANY |
| PlacementChangeRequest | housingAmenities | HousingComplexAmenity | TO_MANY |
| PlacementChangeRequest | location | Location | TO_ONE |
| PlacementChangeRequest | payrollEmployeeType | PayrollEmployeeTypeLookup | TO_ONE |
| PlacementChangeRequest | placement | Placement | TO_ONE |
| PlacementChangeRequest | requestingUser | CorporateUser | TO_ONE |
| PlacementChangeRequest | statementClientContact | ClientContact | TO_ONE |
| PlacementChangeRequest | timeAndExpense | PlacementTimeAndExpenseChangeRequest | TO_ONE |
| PlacementChangeRequest | vendorClientCorporation | ClientCorporation | TO_ONE |
| PlacementChangeRequest | workersCompRate | WorkersCompensationRate | TO_ONE |
| PlacementCommission | editHistory | PlacementCommissionEditHistory | TO_MANY |
| PlacementCommission | placement | Placement | TO_ONE |
| PlacementCommission | user | CorporateUser | TO_ONE |
| Opportunity | appointments | Appointment | TO_MANY |
| Opportunity | assignedUsers | CorporateUser | TO_MANY |
| Opportunity | branch | Branch | TO_ONE |
| Opportunity | businessSector | BusinessSector | TO_ONE |
| Opportunity | businessSectors | BusinessSector | TO_MANY |
| Opportunity | categories | Category | TO_MANY |
| Opportunity | category | Category | TO_ONE |
| Opportunity | certifications | Certification | TO_MANY |
| Opportunity | clientContact | ClientContact | TO_ONE |
| Opportunity | clientCorporation | ClientCorporation | TO_ONE |
| Opportunity | fileAttachments | OpportunityFileAttachment | TO_MANY |
| Opportunity | history | OpportunityHistory | TO_MANY |
| Opportunity | jobOrders | JobOrder | TO_MANY |
| Opportunity | lead | Lead | TO_ONE |
| Opportunity | notes | Note | TO_MANY |
| Opportunity | owner | CorporateUser | TO_ONE |
| Opportunity | reportToClientContact | ClientContact | TO_ONE |
| Opportunity | responseUser | CorporateUser | TO_ONE |
| Opportunity | shift | Shift | TO_ONE |
| Opportunity | skills | Skill | TO_MANY |
| Opportunity | specialties | Specialty | TO_MANY |
| Opportunity | tasks | Task | TO_MANY |
| Opportunity | tearsheets | Tearsheet | TO_MANY |
| Opportunity | workersCompRate | WorkersCompensationRate | TO_ONE |
| Lead | addressSourceLocation | Location | TO_ONE |
| Lead | assignedTo | CorporateUser | TO_MANY |
| Lead | branch | Branch | TO_ONE |
| Lead | businessSectors | BusinessSector | TO_MANY |
| Lead | candidates | Candidate | TO_MANY |
| Lead | categories | Category | TO_MANY |
| Lead | category | Category | TO_ONE |
| Lead | clientContacts | ClientContact | TO_MANY |
| Lead | clientCorporation | ClientCorporation | TO_ONE |
| Lead | customObject1s | PersonCustomObjectInstance1 | TO_MANY |
| Lead | history | LeadHistory | TO_MANY |
| Lead | notes | Note | TO_MANY |
| Lead | owner | CorporateUser | TO_ONE |
| Lead | primarySkills | Skill | TO_MANY |
| Lead | referredByPerson | Person | TO_ONE |
| Lead | reportToPerson | Person | TO_ONE |
| Lead | secondarySkills | Skill | TO_MANY |
| Lead | specialties | Specialty | TO_MANY |
| Lead | tearsheets | Tearsheet | TO_MANY |
| Lead | userType | UserType | TO_ONE |
| Note | candidateCertifications | CandidateCertification | TO_MANY |
| Note | candidates | Candidate | TO_MANY |
| Note | clientContacts | ClientContact | TO_MANY |
| Note | commentingPerson | Person | TO_ONE |
| Note | corporateUsers | CorporateUser | TO_MANY |
| Note | entities | NoteEntity | TO_MANY |
| Note | jobOrder | JobOrder | TO_ONE |
| Note | jobOrders | JobOrder | TO_MANY |
| Note | leads | Lead | TO_MANY |
| Note | opportunities | Opportunity | TO_MANY |
| Note | people | Person | TO_MANY |
| Note | personReference | Person | TO_ONE |
| Note | placementCertifications | PlacementCertification | TO_MANY |
| Note | placements | Placement | TO_MANY |
| NoteEntity | note | Note | TO_ONE |
| Task | assignees | CorporateUser | TO_MANY |
| Task | candidate | Candidate | TO_ONE |
| Task | childTaskOwners | CorporateUser | TO_MANY |
| Task | childTasks | Task | TO_MANY |
| Task | clientContact | ClientContact | TO_ONE |
| Task | clientContactReferences | ClientContact | TO_MANY |
| Task | editHistory | TaskEditHistory | TO_MANY |
| Task | jobOrder | JobOrder | TO_ONE |
| Task | jobSubmission | JobSubmission | TO_ONE |
| Task | lead | Lead | TO_ONE |
| Task | opportunity | Opportunity | TO_ONE |
| Task | owner | CorporateUser | TO_ONE |
| Task | parentTask | Task | TO_ONE |
| Task | placement | Placement | TO_ONE |
| Task | secondaryOwners | CorporateUser | TO_MANY |
| Appointment | candidateReference | Candidate | TO_ONE |
| Appointment | childAppointments | Appointment | TO_MANY |
| Appointment | clientContactReference | ClientContact | TO_ONE |
| Appointment | editHistory | AppointmentEditHistory | TO_MANY |
| Appointment | guests | Person | TO_MANY |
| Appointment | jobOrder | JobOrder | TO_ONE |
| Appointment | jobSubmission | JobSubmission | TO_ONE |
| Appointment | lead | Lead | TO_ONE |
| Appointment | opportunity | Opportunity | TO_ONE |
| Appointment | owner | Person | TO_ONE |
| Appointment | parentAppointment | Appointment | TO_ONE |
| Appointment | placement | Placement | TO_ONE |
| AppointmentAttendee | appointment | Appointment | TO_ONE |
| AppointmentAttendee | attendee | Person | TO_ONE |
| Sendout | candidate | Candidate | TO_ONE |
| Sendout | clientContact | ClientContact | TO_ONE |
| Sendout | clientCorporation | ClientCorporation | TO_ONE |
| Sendout | jobOrder | JobOrder | TO_ONE |
| Sendout | jobSubmission | JobSubmission | TO_ONE |
| Sendout | user | CorporateUser | TO_ONE |
| Tearsheet | candidates | Candidate | TO_MANY |
| Tearsheet | clientContacts | ClientContact | TO_MANY |
| Tearsheet | jobOrders | JobOrder | TO_MANY |
| Tearsheet | leads | Lead | TO_MANY |
| Tearsheet | opportunities | Opportunity | TO_MANY |
| Tearsheet | owner | CorporateUser | TO_ONE |
| Tearsheet | recipients | TearsheetRecipient | TO_MANY |
| Tearsheet | users | CorporateUser | TO_MANY |
| TearsheetMember | person | Person | TO_ONE |
| TearsheetMember | tearsheet | Tearsheet | TO_ONE |
| CorporateUser | addressSourceLocation | Location | TO_ONE |
| CorporateUser | branch | Branch | TO_ONE |
| CorporateUser | branches | Branch | TO_MANY |
| CorporateUser | delegations | CorporateUser | TO_MANY |
| CorporateUser | departments | CorporationDepartment | TO_MANY |
| CorporateUser | jobAssignments | JobOrder | TO_MANY |
| CorporateUser | primaryDepartment | CorporationDepartment | TO_ONE |
| CorporateUser | reportToPerson | Person | TO_ONE |
| CorporateUser | taskAssignments | Task | TO_MANY |
| CorporateUser | userType | UserType | TO_ONE |
| CandidateEducation | candidate | Candidate | TO_ONE |
| CandidateWorkHistory | candidate | Candidate | TO_ONE |
| CandidateWorkHistory | clientCorporation | ClientCorporation | TO_ONE |
| CandidateWorkHistory | jobOrder | JobOrder | TO_ONE |
| CandidateWorkHistory | placement | Placement | TO_ONE |
| CandidateReference | candidate | Candidate | TO_ONE |
| CandidateReference | clientCorporation | ClientCorporation | TO_ONE |
| CandidateReference | jobOrder | JobOrder | TO_ONE |
| CandidateReference | referenceClientContact | ClientContact | TO_ONE |
| CandidateReference | responses | CandidateReferenceResponse | TO_MANY |
| CandidateCertification | candidate | Candidate | TO_ONE |
| CandidateCertification | certification | Certification | TO_ONE |
| CandidateCertification | certificationFileAttachments | CertificationFileAttachment | TO_MANY |
| CandidateCertification | fileAttachments | CandidateFileAttachment | TO_MANY |
| CandidateCertification | modifyingUser | CorporateUser | TO_ONE |
| CandidateCertification | notes | Note | TO_MANY |
| Certification | categories | Category | TO_MANY |
| Certification | category | Category | TO_ONE |
| Certification | certificationGroups | CertificationGroup | TO_MANY |
| Certification | countryID | Country | TO_ONE |
| Certification | equivalents | Certification | TO_MANY |
| Certification | skills | Skill | TO_MANY |
| Certification | specialties | Specialty | TO_MANY |
| Certification | specialty | Specialty | TO_ONE |
| Certification | supplementals | Certification | TO_MANY |
| Skill | categories | Category | TO_MANY |
| Category | skills | Skill | TO_MANY |
| Category | specialties | Specialty | TO_MANY |
| Specialty | parentCategory | Category | TO_ONE |
| Country | states | State | TO_MANY |
| State | country | Country | TO_ONE |
| ClientCorporationCustomObjectInstance1 | clientCorporation | ClientCorporation | TO_ONE |
| JobOrderCustomObjectInstance1 | jobOrder | JobOrder | TO_ONE |
| PlacementCustomObjectInstance1 | placement | Placement | TO_ONE |
| WorkersCompensationRate | compensation | WorkersCompensation | TO_ONE |
| HousingComplex | amenities | HousingComplexAmenity | TO_MANY |
| HousingComplex | owner | CorporateUser | TO_ONE |
| HousingComplex | units | HousingComplexUnit | TO_MANY |
| HousingComplex | whitelistClientCorporations | ClientCorporation | TO_MANY |
| HousingComplex | zipCodeGis | ZipCodeGis | TO_ONE |
| JobBoardPost | appointments | Appointment | TO_MANY |
| JobBoardPost | approvedPlacements | Placement | TO_MANY |
| JobBoardPost | assignedUsers | CorporateUser | TO_MANY |
| JobBoardPost | branch | Branch | TO_ONE |
| JobBoardPost | businessSectors | BusinessSector | TO_MANY |
| JobBoardPost | categories | Category | TO_MANY |
| JobBoardPost | certificationGroups | CertificationGroup | TO_MANY |
| JobBoardPost | certifications | Certification | TO_MANY |
| JobBoardPost | clientContact | ClientContact | TO_ONE |
| JobBoardPost | clientCorporation | ClientCorporation | TO_ONE |
| JobBoardPost | fileAttachments | JobOrderFileAttachment | TO_MANY |
| JobBoardPost | interviews | Appointment | TO_MANY |
| JobBoardPost | jobOrderScreenerQuestions | JobOrderScreenerQuestion | TO_MANY |
| JobBoardPost | location | Location | TO_ONE |
| JobBoardPost | notes | Note | TO_MANY |
| JobBoardPost | opportunity | Opportunity | TO_ONE |
| JobBoardPost | owner | CorporateUser | TO_ONE |
| JobBoardPost | parentJobOrder | JobOrder | TO_ONE |
| JobBoardPost | placements | Placement | TO_MANY |
| JobBoardPost | publishedCategory | Category | TO_ONE |
| JobBoardPost | reportToClientContact | ClientContact | TO_ONE |
| JobBoardPost | responseUser | CorporateUser | TO_ONE |
| JobBoardPost | sendouts | Sendout | TO_MANY |
| JobBoardPost | shift | Shift | TO_ONE |
| JobBoardPost | shifts | Shift | TO_MANY |
| JobBoardPost | skills | Skill | TO_MANY |
| JobBoardPost | specialties | Specialty | TO_MANY |
| JobBoardPost | submissions | JobSubmission | TO_MANY |
| JobBoardPost | tasks | Task | TO_MANY |
| JobBoardPost | tearsheetRecipients | TearsheetRecipient | TO_MANY |
| JobBoardPost | tearsheets | Tearsheet | TO_MANY |
| JobBoardPost | timeUnits | TimeUnit | TO_MANY |
| JobBoardPost | webResponses | JobSubmission | TO_MANY |
| JobBoardPost | workersCompRate | WorkersCompensationRate | TO_ONE |
| CandidateSource | candidate | Candidate | TO_ONE |
| Location | candidate | Candidate | TO_ONE |
| Location | clientContacts | ClientContact | TO_MANY |
| Location | clientCorporation | ClientCorporation | TO_ONE |
| Location | owner | CorporateUser | TO_ONE |
| Location | versions | LocationVersion | TO_MANY |

## Candidate

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| activePlacements | Active Placements | TO_MANY |  |  | → Placement |
| address | Address | COMPOSITE | Address |  |  |
| addressSourceLocation | Address Source Location | TO_ONE |  |  | → Location |
| branch | Branch ID | TO_ONE |  |  | → Branch |
| businessSectors | Industries | TO_MANY |  |  | → BusinessSector |
| canEnterTime | Can Enter Time | SCALAR | Boolean |  |  |
| candidateSource | 3rd Party (Field is Not Searchable) | TO_ONE |  |  | → CandidateSource |
| categories | Categories | TO_MANY |  |  | → Category |
| category | Category | TO_ONE |  |  | → Category |
| certificationList | Certifications | TO_MANY |  |  | → CandidateCertification |
| certifications | Certifications | SCALAR | String(2147483647) |  | CCM, CFA, Chartered Accountant, CMA, CAN, CNE, CPA, MCE, MCSE, MCSE, MS SQL Server Administration, Notary Public …(18) |
| clientCorporationBlackList | Blacklist (Field is Not Searchable) | TO_MANY |  |  | → ClientCorporation |
| clientCorporationWhiteList | Whitelist (Field is Not Searchable) | TO_MANY |  |  | → ClientCorporation |
| clientRating | Client Survey Rating | SCALAR | Integer |  |  |
| comments | General Candidate Comments | SCALAR | String(2147483647) |  |  |
| companyName | Current Company | SCALAR | String(100) |  |  |
| companyURL | LinkedIn URL | SCALAR | String(100) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate10 | Custom Date 10 | SCALAR | Timestamp |  |  |
| customDate11 | Custom Date 11 | SCALAR | Timestamp |  |  |
| customDate12 | Custom Date 12 | SCALAR | Timestamp |  |  |
| customDate13 | Custom Date 13 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customDate4 | Custom Date 4 | SCALAR | Timestamp |  |  |
| customDate5 | Custom Date 5 | SCALAR | Timestamp |  |  |
| customDate6 | Custom Date 6 | SCALAR | Timestamp |  |  |
| customDate7 | Custom Date 7 | SCALAR | Timestamp |  |  |
| customDate8 | Custom Date 8 | SCALAR | Timestamp |  |  |
| customDate9 | Custom Date 9 | SCALAR | Timestamp |  |  |
| customEncryptedText1 | Custom Encrypted Text 1 | SCALAR | String(2147483647) |  |  |
| customEncryptedText10 | Custom Encrypted Text 10 | SCALAR | String(2147483647) |  |  |
| customEncryptedText2 | Custom Encrypted Text 2 | SCALAR | String(2147483647) |  |  |
| customEncryptedText3 | Custom Encrypted Text 3 | SCALAR | String(2147483647) |  |  |
| customEncryptedText4 | Custom Encrypted Text 4 | SCALAR | String(2147483647) |  |  |
| customEncryptedText5 | Custom Encrypted Text 5 | SCALAR | String(2147483647) |  |  |
| customEncryptedText6 | Custom Encrypted Text 6 | SCALAR | String(2147483647) |  |  |
| customEncryptedText7 | Custom Encrypted Text 7 | SCALAR | String(2147483647) |  |  |
| customEncryptedText8 | Custom Encrypted Text 8 | SCALAR | String(2147483647) |  |  |
| customEncryptedText9 | Custom Encrypted Text 9 | SCALAR | String(2147483647) |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat10 | Custom Float 10 | SCALAR | Double |  |  |
| customFloat11 | Custom Float 11 | SCALAR | Double |  |  |
| customFloat12 | Custom Float 12 | SCALAR | Double |  |  |
| customFloat13 | Custom Float 13 | SCALAR | Double |  |  |
| customFloat14 | Custom Float 14 | SCALAR | Double |  |  |
| customFloat15 | Custom Float 15 | SCALAR | Double |  |  |
| customFloat16 | Custom Float 16 | SCALAR | Double |  |  |
| customFloat17 | Custom Float 17 | SCALAR | Double |  |  |
| customFloat18 | Custom Float 18 | SCALAR | Double |  |  |
| customFloat19 | Custom Float 19 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat20 | Custom Float 20 | SCALAR | Double |  |  |
| customFloat21 | Custom Float 21 | SCALAR | Double |  |  |
| customFloat22 | Custom Float 22 | SCALAR | Double |  |  |
| customFloat23 | Custom Float 23 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customFloat4 | Custom Float 4 | SCALAR | Double |  |  |
| customFloat5 | Custom Float 5 | SCALAR | Double |  |  |
| customFloat6 | Custom Float 6 | SCALAR | Double |  |  |
| customFloat7 | Custom Float 7 | SCALAR | Double |  |  |
| customFloat8 | Custom Float 8 | SCALAR | Double |  |  |
| customFloat9 | Custom Float 9 | SCALAR | Double |  |  |
| customInt1 | Bullhorn Automation Score | SCALAR | Integer |  |  |
| customInt10 | Custom Int 10 | SCALAR | Integer |  |  |
| customInt11 | Custom Int 11 | SCALAR | Integer |  |  |
| customInt12 | Custom Int 12 | SCALAR | Integer |  |  |
| customInt13 | Custom Int 13 | SCALAR | Integer |  |  |
| customInt14 | Custom Int 14 | SCALAR | Integer |  |  |
| customInt15 | Custom Int 15 | SCALAR | Integer |  |  |
| customInt16 | Custom Int 16 | SCALAR | Integer |  |  |
| customInt17 | Custom Int 17 | SCALAR | Integer |  |  |
| customInt18 | Custom Int 18 | SCALAR | Integer |  |  |
| customInt19 | Custom Int 19 | SCALAR | Integer |  |  |
| customInt2 | Submission Count | SCALAR | Integer |  |  |
| customInt20 | Custom Int 20 | SCALAR | Integer |  |  |
| customInt21 | Custom Int 21 | SCALAR | Integer |  |  |
| customInt22 | Custom Int 22 | SCALAR | Integer |  |  |
| customInt23 | Custom Int 23 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customInt4 | Custom Int 4 | SCALAR | Integer |  |  |
| customInt5 | Custom Int 5 | SCALAR | Integer |  |  |
| customInt6 | Custom Int 6 | SCALAR | Integer |  |  |
| customInt7 | Custom Int 7 | SCALAR | Integer |  |  |
| customInt8 | Custom Int 8 | SCALAR | Integer |  |  |
| customInt9 | Custom Int 9 | SCALAR | Integer |  |  |
| customObject1s | Custom Object1s | TO_MANY |  |  | → PersonCustomObjectInstance1 |
| customText1 | Primary Certification(s) | SCALAR | String(100) |  | optionsType SkillText |
| customText10 | Sourced By | SCALAR | String(100) | yes | optionsType CorporateUserText |
| customText11 | Credentials | SCALAR | String(100) |  | PharmD, PMP, RN |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | Secondary Certification(s) | SCALAR | String(100) |  | optionsType SkillText |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText21 | Custom Text 21 | SCALAR | String(100) |  |  |
| customText22 | Custom Text 22 | SCALAR | String(100) |  |  |
| customText23 | Custom Text 23 | SCALAR | String(100) |  |  |
| customText24 | Custom Text 24 | SCALAR | String(100) |  |  |
| customText25 | Custom Text 25 | SCALAR | String(100) |  |  |
| customText26 | Custom Text 26 | SCALAR | String(100) |  |  |
| customText27 | Custom Text 27 | SCALAR | String(100) |  |  |
| customText28 | Custom Text 28 | SCALAR | String(100) |  |  |
| customText29 | Custom Text 29 | SCALAR | String(100) |  |  |
| customText3 | Preferred Role(s) | SCALAR | String(100) | yes | Analyst, PM, Trainer, Manager, Director (Rev Cycle), Director (Ancillary Apps), Director (Clinical), Director (Patient Access), Executive |
| customText30 | Custom Text 30 | SCALAR | String(100) |  |  |
| customText31 | Custom Text 31 | SCALAR | String(100) |  |  |
| customText32 | Custom Text 32 | SCALAR | String(100) |  |  |
| customText33 | Custom Text 33 | SCALAR | String(100) |  |  |
| customText34 | Custom Text 34 | SCALAR | String(100) |  |  |
| customText35 | Custom Text 35 | SCALAR | String(100) |  |  |
| customText36 | Custom Text 36 | SCALAR | String(100) |  |  |
| customText37 | Custom Text 37 | SCALAR | String(100) |  |  |
| customText38 | Custom Text 38 | SCALAR | String(100) |  |  |
| customText39 | Custom Text 39 | SCALAR | String(100) |  |  |
| customText4 | Travel Preferences | SCALAR | String(100) |  | None - Only Remote, On-site as Needed, Up to 25%, 50%+, Travel Ok |
| customText40 | Custom Text 40 | SCALAR | String(100) |  |  |
| customText5 | Epic Role | SCALAR | String(100) |  | IS, TS, Dev, QA, BFF, Trainer, IE |
| customText6 | Candidate Grade | SCALAR | String(100) |  | A, B, C, D, Not a Fit |
| customText7 | Candidate Urgency | SCALAR | String(100) |  | Urgent, Hot, Warm, Cold |
| customText8 | City | SCALAR | String(100) |  |  |
| customText9 | State | SCALAR | String(100) |  | optionsType NorthAmericaState |
| customTextBlock1 | Candidate Notes | SCALAR | String(2147483647) |  |  |
| customTextBlock10 | Custom Text Block 10 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| customTextBlock6 | Custom Text Block 6 | SCALAR | String(2147483647) |  |  |
| customTextBlock7 | Custom Text Block 7 | SCALAR | String(2147483647) |  |  |
| customTextBlock8 | Custom Text Block 8 | SCALAR | String(2147483647) |  |  |
| customTextBlock9 | Custom Text Block 9 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateAvailable | Date Available | SCALAR | Timestamp |  |  |
| dateAvailableEnd | Available Until | SCALAR | Timestamp |  |  |
| dateI9Expiration | Date I9 Expiration | SCALAR | Timestamp |  |  |
| dateLastComment | Last Note | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| dateLastPayrollProviderSync | Date Last Payroll Provider Sync | SCALAR | Timestamp |  |  |
| dateNextCall | Date Next Call | SCALAR | Timestamp |  |  |
| dateOfBirth | Date of Birth | SCALAR | Timestamp |  |  |
| dayRate | Day Rate | SCALAR | BigDecimal |  |  |
| dayRateLow | Day Rate Low | SCALAR | BigDecimal |  |  |
| degreeList | Degrees | SCALAR | String(2147483647) |  | Associate, BA, BBA, BFA, BS, MA, MBA, MS, MD, Paralegal Certificate, Phd |
| description | Resume | SCALAR | String(2147483647) |  |  |
| desiredLocations | Desired Locations | SCALAR | String(2147483647) |  |  |
| disability | Disability | SCALAR | String(1) |  | Unknown, Yes, No |
| educationDegree | Education Level | SCALAR | String(2147483647) |  | Not Specified, Associate, Bachelor, Masters, Doctoral, Post Doctoral, High School, Some College, Technical College |
| educations | Education | TO_MANY |  |  | → CandidateEducation |
| email | Email | SCALAR | String(100) | yes |  |
| email2 | Email 2 | SCALAR | String(100) |  |  |
| email3 | Email 3 | SCALAR | String(100) |  |  |
| employeeType | Employee Type | SCALAR | String(30) |  | W2, 1099, Corp-to-Corp |
| employmentPreference | Employment Preference | SCALAR | String(200) |  | Permanent, Contract, Contract To Hire |
| estaffGUID | eStaff GUID | SCALAR | String(36) |  |  |
| ethnicity | Ethnicity | SCALAR | String(50) |  | Unknown, American Indian/Alaskan Native, Asian, Pacific Islander, Black or African American, Hispanic or Latino, White, Two or More Races |
| experience | Years Experience | SCALAR | Integer |  |  |
| externalID | External ID | SCALAR | String(100) |  |  |
| fax | Fax | SCALAR | String(50) |  |  |
| fax2 | Fax 2 | SCALAR | String(50) |  |  |
| fax3 | Fax 3 | SCALAR | String(50) |  |  |
| federalAddtionalWitholdingsAmount | Federal Addtional Witholdings Amount | SCALAR | BigDecimal |  |  |
| federalExemptions | Federal Exemptions | SCALAR | Integer |  |  |
| federalExtraWithholdingAmount | Federal Extra Withholding Amount (for each pay period) | SCALAR | BigDecimal |  |  |
| federalFilingStatus | Federal Filing Status | SCALAR | String(1) |  |  |
| fileAttachments | File Attachments | TO_MANY |  |  | → CandidateFileAttachment |
| firstName | First Name | SCALAR | String(50) | yes |  |
| gender | Gender | SCALAR | String(1) |  | Unknown, Male, Female |
| hourlyRate | Desired Pay Rate | SCALAR | BigDecimal |  |  |
| hourlyRateLow | Current Pay Rate | SCALAR | BigDecimal |  |  |
| i9OnFile | I9 On File | SCALAR | Integer |  |  |
| interviews | Interviews | TO_MANY |  |  | → Appointment |
| isAnonymized | Is Anonymized | SCALAR | Boolean |  |  |
| isDayLightSavings | Is Daylight Savings | SCALAR | Boolean |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isEditable | Allow candidate to edit profile (Field is Not Searchable) | SCALAR | Boolean |  |  |
| isExempt | Is Exempt | SCALAR | Boolean |  |  |
| isLockedOut | Is Locked Out | SCALAR | Boolean |  |  |
| lastEmailReceivedDate | Last Email Received Date | SCALAR | Date |  |  |
| lastName | Last Name | SCALAR | String(50) | yes |  |
| leads | Leads | TO_MANY |  |  | → Lead |
| linkedPerson | Linked Person | TO_ONE |  |  | → Person |
| localAddtionalWitholdingsAmount | Local Addtional Witholdings Amount | SCALAR | BigDecimal |  |  |
| localExemptions | Local Exemptions | SCALAR | Integer |  |  |
| localFilingStatus | Local Filing Status | SCALAR | String(1) |  |  |
| localTaxCode | Local Tax Code | SCALAR | String(40) |  |  |
| locations | Locations | TO_MANY |  |  | → Location |
| maritalStatus | Marital Status | SCALAR | String(100) |  |  |
| massMailOptOut | Opted Out | SCALAR | Boolean |  |  |
| masterUserID | Master User ID | SCALAR | Integer |  |  |
| middleName | Middle Name | SCALAR | String(50) |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| mobile | Mobile Phone | SCALAR | String(50) |  |  |
| name | Name | SCALAR | String(100) |  |  |
| namePrefix | Prefix | SCALAR | String(20) |  | , Mr., Mrs., Ms., Dr., Miss |
| nameSuffix | Suffix | SCALAR | String(5) |  | , Jr., III, IV, V, PhD, Esq. |
| nickName | Nickname | SCALAR | String(50) |  |  |
| notes | Notes | TO_MANY |  |  | → Note |
| numCategories | Number of Categories | SCALAR | Integer |  |  |
| numOwners | Number of Owners | SCALAR | Integer |  |  |
| occupation | Job Title | SCALAR | String(100) |  |  |
| onboardingDocumentReceivedCount | Onboarding Docs Received | SCALAR | Integer |  |  |
| onboardingDocumentSentCount | Onboarding Docs Sent | SCALAR | Integer |  |  |
| onboardingPercentComplete | % Complete | SCALAR | Integer |  |  |
| onboardingReceivedSent | Onboarding Received Sent | COMPOSITE | OnboardingReceivedSent |  |  |
| onboardingStatus | Onboarding Status | SCALAR | String(100) |  |  |
| otherDeductionsAmount | Other Deductions Amount | SCALAR | BigDecimal |  |  |
| otherIncomeAmount | Other Income Amount | SCALAR | BigDecimal |  |  |
| owner | Ownership | TO_ONE |  | yes | → CorporateUser |
| pager | Pager | SCALAR | String(50) |  |  |
| paperWorkOnFile | Paper Work On File | SCALAR | String(2147483647) |  |  |
| parsedResumeFile | Parsed Resume File | TO_ONE |  |  | → CandidateFileAttachment |
| password | Password | SCALAR | String(200) |  |  |
| payrollClientStartDate | Payroll Client Start Date | SCALAR | Timestamp |  |  |
| payrollStatus | Payroll Status | SCALAR | String(100) |  |  |
| personSubtype | Person Subtype | SCALAR | String(100) |  |  |
| phone | Primary Phone | SCALAR | String(50) |  |  |
| phone2 | Other Phone | SCALAR | String(50) |  |  |
| phone3 | Phone 3 | SCALAR | String(50) |  |  |
| placements | Placements | TO_MANY |  |  | → Placement |
| preferredContact | Preferred Contact | SCALAR | String(15) |  | Home, Work, Cell/Mobile, Email |
| primarySkills | Skills | TO_MANY |  |  | → Skill |
| recentClientList | Recent Employers | SCALAR | String(2147483647) |  |  |
| references | References | TO_MANY |  |  | → CandidateReference |
| referredBy | Referred By | SCALAR | String(50) |  |  |
| referredByPerson | Referred By | TO_ONE |  |  | → Person |
| salary | Desired Salary | SCALAR | BigDecimal |  |  |
| salaryLow | Current Salary | SCALAR | BigDecimal |  |  |
| secondaryAddress | Address | COMPOSITE | SecondaryAddress |  |  |
| secondaryOwners | Sourcer | TO_MANY |  |  | → CorporateUser |
| secondarySkills | Secondary Skills | TO_MANY |  |  | → Skill |
| sendouts | Sendouts | TO_MANY |  |  | → Sendout |
| shifts | Shifts | TO_MANY |  |  | → Shift |
| skillSet | Additional Skills (resume parser) | SCALAR | String(2147483647) |  |  |
| smsOptIn | Opted In - SMS Messages | SCALAR | Boolean |  | Yes, No |
| source | Source | SCALAR | String(200) |  | Referral, Internal, Website, LinkedIn |
| specialties | Specialty Sub-Category | TO_MANY |  |  | → Specialty |
| ssn | SSN | SCALAR | String(18) |  |  |
| stateAddtionalWitholdingsAmount | State Addtional Witholdings Amount | SCALAR | BigDecimal |  |  |
| stateExemptions | State Exemptions | SCALAR | Integer |  |  |
| stateFilingStatus | State Filing Status | SCALAR | String(1) |  |  |
| status | Status | SCALAR | String(100) | yes | Not Screened, Active, Active-Reviewed, Placed, DNU, Archive, Not Seeking Employment, Former Anura Consultant |
| submissions | Submissions | TO_MANY |  |  | → JobSubmission |
| tasks | Tasks | TO_MANY |  |  | → Task |
| taxID | Tax ID | SCALAR | String(18) |  |  |
| taxState | Tax State | SCALAR | String(100) |  |  |
| tearsheets | Tearsheets | TO_MANY |  |  | → Tearsheet |
| timeZoneOffsetEST | Time Zone Offset EST | SCALAR | Integer |  |  |
| tobaccoUser | Tobacco User | SCALAR | String(100) |  |  |
| totalDependentClaimAmount | Total Dependent Claim Amount | SCALAR | BigDecimal |  |  |
| travelLimit | Distance Willing to Travel (miles) | SCALAR | Integer |  |  |
| travelMethod | Travel Method | SCALAR | String(100) |  |  |
| trust | Trust | TO_ONE | AbstractEmbeddedEntity |  | → CandidateTrustData |
| twoJobs | Two Jobs? | SCALAR | Boolean |  |  |
| type | Former Epic? | SCALAR | String(100) |  | Yes, No |
| userDateAdded | User Date Added | SCALAR | Timestamp |  |  |
| userType | User Type | TO_ONE |  |  | → UserType |
| username | Username | SCALAR | String(100) |  |  |
| veteran | Veteran | SCALAR | String(1) |  | Unknown, Yes, No |
| webResponses | Web Responses | TO_MANY |  |  | → JobSubmission |
| willRelocate | Willing to Relocate | SCALAR | Boolean |  | Yes, No |
| workAuthorized | Authorized to work in the US | SCALAR | Boolean |  |  |
| workHistories | Work History | TO_MANY |  |  | → CandidateWorkHistory |
| workPhone | Work Phone | SCALAR | String(50) |  |  |

## ClientContact — "Contact"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| activePlacements | Active Placements | TO_MANY |  |  | → Placement |
| address | Address | COMPOSITE | Address |  |  |
| addressSourceLocation | Address Source Location | TO_ONE |  |  | → Location |
| appointments | Appointments | TO_MANY |  |  | → Appointment |
| branch | Branch ID | TO_ONE |  |  | → Branch |
| businessSectors | Desired Industries | TO_MANY |  |  | → BusinessSector |
| categories | Category | TO_MANY |  |  | → Category |
| category | Category | TO_ONE |  |  | → Category |
| certifications | Certifications | SCALAR | String(2147483647) |  | CCM, CFA, Chartered Accountant, CMA, CAN, CNE, CPA, MCE, MCSE, MCSE, MS SQL Server Administration, Notary Public …(18) |
| clientContactID | Client Contact ID | SCALAR | Integer |  |  |
| clientCorporation | Company | TO_ONE |  | yes | → ClientCorporation |
| clientLocations | Location | TO_MANY |  |  | → Location |
| comments | General Contact Notes | SCALAR | String(2147483647) |  |  |
| companyName | Company Name | SCALAR | String(100) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customInt1 | Bullhorn Automation Score | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customObject1s | Custom Object1s | TO_MANY |  |  | → PersonCustomObjectInstance1 |
| customText1 | LinkedIn Profile | SCALAR | String(100) |  |  |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText11 | customText11 | SCALAR | String(100) |  |  |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | customText2 | SCALAR | String(100) |  |  |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText3 | customText3 | SCALAR | String(100) |  |  |
| customText4 | customText4 | SCALAR | String(100) |  |  |
| customText5 | customText5 | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastComment | Last Note | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| dateLastVisit | Last Visit | SCALAR | Timestamp |  |  |
| deleteMe | Delete Me | SCALAR | String(30) |  |  |
| departmentOwners | Department Owners | TO_MANY |  |  | → CorporationDepartment |
| description | Professional Overview / Resume | SCALAR | String(2147483647) |  |  |
| desiredCategories | Desired Categories | SCALAR | String(255) |  | optionsType CategoryText |
| desiredLocations | Desired Locations | SCALAR | String(2147483647) |  |  |
| desiredSkills | Desired Skills | SCALAR | String(255) |  | optionsType SkillText |
| desiredSpecialties | Desired Specialties Sub-Category | SCALAR | String(255) |  | optionsType SpecialtyText |
| division | Department | SCALAR | String(40) |  | Accounting, Accounts Payable, Accounts Receivable, Administration, Customer Service, Customer Support, Finance, Human Resources, Information Technology, Marketing, Operations, Payroll …(15) |
| email | Email 1 | SCALAR | String(100) | yes |  |
| email2 | Email 2 | SCALAR | String(100) |  |  |
| email3 | Email 3 | SCALAR | String(100) |  |  |
| externalID | External ID | SCALAR | String(100) |  |  |
| fax | Fax | SCALAR | String(50) |  |  |
| fax2 | Fax 2 | SCALAR | String(50) |  |  |
| fax3 | Fax 3 | SCALAR | String(50) |  |  |
| fileAttachments | File Attachments | TO_MANY |  |  | → ClientContactFileAttachment |
| firstName | First Name | SCALAR | String(50) | yes |  |
| interviews | Interviews | TO_MANY |  |  | → Appointment |
| isAnonymized | Is Anonymized | SCALAR | Boolean |  |  |
| isDayLightSavings | Is Daylight Savings | SCALAR | Boolean |  |  |
| isDefaultContact | Is Default Contact | SCALAR | Boolean |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isLockedOut | Is Locked Out | SCALAR | Boolean |  |  |
| jobOrders | Jobs | TO_MANY |  |  | → JobOrder |
| jobSubmissions | Submissions | TO_MANY |  |  | → JobSubmission |
| lastEmailReceivedDate | Last Email Received Date | SCALAR | Date |  |  |
| lastName | Last Name | SCALAR | String(50) | yes |  |
| leads | Leads | TO_MANY |  |  | → Lead |
| linkedPerson | Linked Person | TO_ONE |  |  | → Person |
| massMailOptOut | Opted Out | SCALAR | Boolean |  |  |
| masterUserID | Master User ID | SCALAR | Integer |  |  |
| middleName | Middle Name | SCALAR | String(50) |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| mobile | Mobile Phone | SCALAR | String(50) |  |  |
| name | Name | SCALAR | String(100) |  |  |
| namePrefix | Prefix | SCALAR | String(20) |  | , Mr., Mrs., Ms., Dr. |
| nameSuffix | Suffix | SCALAR | String(5) |  | , Sr., Jr., II, III, IV, MD, JD, PhD, Esq. |
| nickName | Nickname | SCALAR | String(50) |  |  |
| notes | Notes | TO_MANY |  |  | → Note |
| numEmployees | Number of Employees | SCALAR | Integer |  |  |
| occupation | Job Title | SCALAR | String(100) |  |  |
| office | Office | SCALAR | String(40) |  |  |
| opportunities | Opportunities | TO_MANY |  |  | → Opportunity |
| owner | Owner | TO_ONE |  | yes | → CorporateUser |
| pager | Pager | SCALAR | String(50) |  |  |
| password | Password | SCALAR | String(200) |  |  |
| personSubtype | Person Subtype | SCALAR | String(100) |  |  |
| phone | Direct Phone | SCALAR | String(50) |  |  |
| phone2 | Other Phone | SCALAR | String(50) |  |  |
| phone3 | Phone 3 | SCALAR | String(50) |  |  |
| placements | Placements | TO_MANY |  |  | → Placement |
| preferredContact | Preferred Contact Method | SCALAR | String(15) |  | Phone, Mobile, Email, Pager, Fax |
| referredByPerson | Referred by | TO_ONE |  |  | → Person |
| reportToPerson | Reports to | TO_ONE |  |  | → Person |
| secondaryAddress | Address | COMPOSITE | SecondaryAddress |  |  |
| secondaryOwners | Secondary Owners | TO_MANY |  |  | → CorporateUser |
| sendouts | Client Submissions | TO_MANY |  |  | → Sendout |
| skillSet | Additional Skills | SCALAR | String(2147483647) |  |  |
| skills | Primary Skills | TO_MANY |  |  | → Skill |
| smsOptIn | Opted In - SMS Messages | SCALAR | Boolean |  | Yes, No |
| source | Source | SCALAR | String(200) |  |  |
| specialties | Specialties | TO_MANY |  |  | → Specialty |
| status | Status | SCALAR | String(100) | yes | Active, Passive, DNC, Left Company, Archive, Private |
| tasks | Tasks | TO_MANY |  |  | → Task |
| tearsheets | Tearsheets | TO_MANY |  |  | → Tearsheet |
| timeZoneOffsetEST | Time Zone Offset EST | SCALAR | Integer |  |  |
| trackTitle | Track Title | SCALAR | String(200) |  |  |
| type | Type | SCALAR | String(30) |  | Primary Target, Secondary Target |
| userDateAdded | User Date Added | SCALAR | Timestamp |  |  |
| userType | User Type | TO_ONE |  |  | → UserType |
| username | Username | SCALAR | String(100) |  |  |

## ClientCorporation — "Company"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| address | Address | COMPOSITE | Address |  |  |
| annualRevenue | Annual Revenue (Millions) | SCALAR | BigDecimal |  |  |
| billingAddress | Billing Address | COMPOSITE | BillingAddress |  |  |
| billingContact | Billing Contact | SCALAR | String(100) |  |  |
| billingFrequency | Billing Frequency | SCALAR | String(20) |  | Weekly, Bi-Weekly, Semi-Monthly, Monthly |
| billingPhone | Billing Phone | SCALAR | String(20) |  |  |
| branch | Branch ID | TO_ONE |  |  | → Branch |
| businessSectorList | Business Sectors | SCALAR | String(2147483647) |  | optionsType BusinessSectorText |
| certificationGroups | Certification Groups | TO_MANY |  |  | → CertificationGroup |
| certifications | Certifications | TO_MANY |  |  | → ClientCorporationCertification |
| childClientCorporations | Child Companies | TO_MANY |  |  | → ClientCorporation |
| clientContactNotes | Client Contact Notes | TO_MANY |  |  | → Note |
| clientContacts | Contacts | TO_MANY |  |  | → ClientContact |
| companyDescription | Company Description | SCALAR | String(2147483647) |  |  |
| companyURL | Company Website | SCALAR | String(100) |  |  |
| competitors | Competitors | SCALAR | String(2147483647) |  |  |
| culture | Culture / Perks | SCALAR | String(2147483647) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customText1 | Type | SCALAR | String(100) |  | Single, Departmental, Regional, Corporate HQ, Master Vendor, National |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText11 | customText11 | SCALAR | String(100) |  |  |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | Contract Status | SCALAR | String(100) | yes | No MSA, MSA In Progress, Signed MSA, Signed MSA - Expired |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText3 | Background Check Required | SCALAR | String(100) |  |  |
| customText4 | Drug Screen Required | SCALAR | String(100) |  |  |
| customText5 | Special Screening | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | Growth Plan | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | Submission Requirements Detail | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateFounded | Year Founded | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| department | Managed From | TO_ONE |  | yes | → CorporationDepartment |
| departmentOwners | DNU_Department Owners | TO_MANY |  |  | → CorporationDepartment |
| externalID | External ID | SCALAR | String(100) |  |  |
| facebookProfileName | Facebook Profile Name | SCALAR | String(200) |  |  |
| fax | Fax | SCALAR | String(20) |  |  |
| feeArrangement | Standard Perm Fee (%) | SCALAR | Double |  |  |
| fileAttachments | File Attachments | TO_MANY |  |  | → ClientCorporationFileAttachment |
| funding | Funding Status | SCALAR | String(2147483647) |  |  |
| industryList | Sector | SCALAR | String(2147483647) |  | Aerospace & Defense, Aerospace & Defense > Aerospace, Aerospace & Defense > Defense, Automobiles, Automobiles > Automobiles, Automobiles > Auto Parts, Automobiles > Tires & Rubber, Banks, Banks > Banks, Beverages, Beverages > Brewers, Beverages > Distillers & Vintners …(148) |
| invoiceFormat | Invoice Format | SCALAR | String(50) |  |  |
| leads | Leads | TO_MANY |  |  | → Lead |
| linkedinProfileName | LinkedIn Profile Name | SCALAR | String(200) |  |  |
| locations | Locations | TO_MANY |  |  | → Location |
| name | Company Name | SCALAR | String(100) | yes |  |
| notes | Company Overview | SCALAR | String(2147483647) |  |  |
| numEmployees | # of Employees | SCALAR | Integer |  |  |
| numOffices | # of Offices | SCALAR | Integer |  |  |
| owners | Owners | TO_MANY |  |  | → CorporateUser |
| ownership | DNU_Ownership | SCALAR | String(30) |  | Public, Private |
| parentClientCorporation | Parent Company | TO_ONE |  |  | → ClientCorporation |
| phone | Main Phone | SCALAR | String(20) |  |  |
| requirements | Credential Requirements | TO_MANY |  |  | → Certification |
| revenue | revenue | SCALAR | String(2147483647) |  |  |
| status | Status | SCALAR | String(30) | yes | Unqualified, Proposal, Active Account, Passive Account, DNC, Archive |
| taxRate | Tax % | SCALAR | Double |  |  |
| tickerSymbol | Ticker Symbol | SCALAR | String(20) |  |  |
| timeAndLaborEnabledDate | Time and Labor Enabled Date | SCALAR | Timestamp |  |  |
| trackTitle | Track Title | SCALAR | String(200) |  |  |
| twitterHandle | Twitter (X) Handle | SCALAR | String(200) |  |  |
| userOwners | Owner | TO_MANY |  |  | → CorporateUser |
| workWeekStart | Work Week Begin | SCALAR | Integer |  | Sunday, Monday |

## JobOrder — "Job"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| address | Address | COMPOSITE | Address |  |  |
| appointments | Appointments | TO_MANY |  |  | → Appointment |
| approvedPlacements | Approved Placements | TO_MANY |  |  | → Placement |
| assignedUsers | Assigned Users | TO_MANY |  |  | → CorporateUser |
| benefits | Benefits | SCALAR | String(2147483647) |  | Healthcare, Dental, Vision, Life Insurance, Long-term Disability, 401K, Pension, Stock Options, Tuition Reimbursement |
| billRateCategoryID | Bill Rate Category | SCALAR | Integer |  | optionsType BillRateCategory |
| bonusPackage | Bonus Package | SCALAR | String(2147483647) |  |  |
| branch | Branch ID | TO_ONE |  |  | → Branch |
| branchCode | Branch | SCALAR | String(100) | yes |  |
| businessSectors | Industries | TO_MANY |  |  | → BusinessSector |
| categories | Categories | TO_MANY |  |  | → Category |
| certificationGroups | Certification Groups | TO_MANY |  |  | → CertificationGroup |
| certificationList | Required Epic Certifications | SCALAR | String(255) |  | CCM, CFA, Chartered Accountant, CMA, CNA, CNE, CPA, MCE, MCSE, MS SQL Server Administration, Adminstration, Notary Public …(18) |
| certifications | Licenses/Certifications: | TO_MANY |  |  | → Certification |
| clientBillRate | Client Bill Rate | SCALAR | BigDecimal |  |  |
| clientContact | Contact | TO_ONE |  | yes | → ClientContact |
| clientCorporation | Client Company | TO_ONE |  | yes | → ClientCorporation |
| correlatedCustomDate1 | correlatedCustomDate1 | SCALAR | Timestamp |  |  |
| correlatedCustomDate2 | correlatedCustomDate2 | SCALAR | Timestamp |  |  |
| correlatedCustomDate3 | correlatedCustomDate3 | SCALAR | Timestamp |  |  |
| correlatedCustomFloat1 | correlatedCustomFloat1 | SCALAR | Double |  |  |
| correlatedCustomFloat2 | correlatedCustomFloat2 | SCALAR | Double |  |  |
| correlatedCustomFloat3 | correlatedCustomFloat3 | SCALAR | Double |  |  |
| correlatedCustomInt1 | correlatedCustomInt1 | SCALAR | Integer |  |  |
| correlatedCustomInt2 | correlatedCustomInt2 | SCALAR | Integer |  |  |
| correlatedCustomInt3 | correlatedCustomInt3 | SCALAR | Integer |  |  |
| correlatedCustomText1 | Timesheet Filter | SCALAR | String(100) |  |  |
| correlatedCustomText10 | correlatedCustomText10 | SCALAR | String(100) |  |  |
| correlatedCustomText2 | correlatedCustomText2 | SCALAR | String(100) |  |  |
| correlatedCustomText3 | correlatedCustomText3 | SCALAR | String(100) |  |  |
| correlatedCustomText4 | correlatedCustomText4 | SCALAR | String(100) |  |  |
| correlatedCustomText5 | correlatedCustomText5 | SCALAR | String(100) |  |  |
| correlatedCustomText6 | correlatedCustomText6 | SCALAR | String(100) |  |  |
| correlatedCustomText7 | correlatedCustomText7 | SCALAR | String(100) |  |  |
| correlatedCustomText8 | correlatedCustomText8 | SCALAR | String(100) |  |  |
| correlatedCustomText9 | correlatedCustomText9 | SCALAR | String(100) |  |  |
| correlatedCustomTextBlock1 | correlatedCustomTextBlock1 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock2 | correlatedCustomTextBlock2 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock3 | correlatedCustomTextBlock3 | SCALAR | String(2147483647) |  |  |
| costCenter | Client Cost Center | SCALAR | String(30) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customFloat1 | Bill Rate High | SCALAR | Double |  |  |
| customFloat2 | Bill Rate Low | SCALAR | Double |  |  |
| customFloat3 | Expected Value | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customInt4 | customInt4 | SCALAR | Integer |  |  |
| customInt5 | customInt5 | SCALAR | Integer |  |  |
| customInt6 | customInt6 | SCALAR | Integer |  |  |
| customInt7 | customInt7 | SCALAR | Integer |  |  |
| customInt8 | customInt8 | SCALAR | Integer |  |  |
| customText1 | Rate Notes | SCALAR | String(100) |  |  |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText11 | customText11 | SCALAR | String(100) |  |  |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | customText2 | SCALAR | String(100) |  |  |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText21 | customText21 | SCALAR | String(100) |  |  |
| customText22 | customText22 | SCALAR | String(100) |  |  |
| customText23 | customText23 | SCALAR | String(100) |  |  |
| customText24 | customText24 | SCALAR | String(100) |  |  |
| customText25 | customText25 | SCALAR | String(100) |  |  |
| customText26 | customText26 | SCALAR | String(100) |  |  |
| customText27 | customText27 | SCALAR | String(100) |  |  |
| customText28 | customText28 | SCALAR | String(100) |  |  |
| customText29 | customText29 | SCALAR | String(100) |  |  |
| customText3 | Background Check Required | SCALAR | String(100) |  |  |
| customText30 | customText30 | SCALAR | String(100) |  |  |
| customText31 | customText31 | SCALAR | String(100) |  |  |
| customText32 | customText32 | SCALAR | String(100) |  |  |
| customText33 | customText33 | SCALAR | String(100) |  |  |
| customText34 | customText34 | SCALAR | String(100) |  |  |
| customText35 | customText35 | SCALAR | String(100) |  |  |
| customText36 | customText36 | SCALAR | String(100) |  |  |
| customText37 | customText37 | SCALAR | String(100) |  |  |
| customText38 | customText38 | SCALAR | String(100) |  |  |
| customText39 | customText39 | SCALAR | String(100) |  |  |
| customText4 | Drug Screen Required | SCALAR | String(100) |  |  |
| customText40 | customText40 | SCALAR | String(100) |  |  |
| customText5 | Special Screening | SCALAR | String(100) |  |  |
| customText6 | Recruiting Owner | SCALAR | String(100) |  | optionsType CorporateUserText |
| customText7 | Sales Owner | SCALAR | String(100) |  |  |
| customText8 | Contract Duration | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | Next Steps | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | Submission Requirements Detail | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateClosed | Date Closed | SCALAR | Timestamp |  |  |
| dateEnd | Scheduled End | SCALAR | Timestamp | yes |  |
| dateLastExported | Date Last Exported | SCALAR | Timestamp |  |  |
| dateLastModified | Last Updated | SCALAR | Timestamp |  |  |
| dateLastPublished | Date Last Published | SCALAR | Timestamp |  |  |
| degreeList | Degree Requirements | SCALAR | String(2147483647) |  | Associate, BA, BBA, BFA, BS, MA, MBA, MS, MD, Paralegal Certificate, PhD |
| description | Job Description | SCALAR | String(2147483647) | yes |  |
| durationWeeks | Job Duration | SCALAR | Double |  | Permanent, 1 Day, 2 Days, 3 Days, 4 Days, 5 Days, 1 week, 2 weeks, 3 weeks, 4 weeks, 5 weeks, 6 weeks …(37) |
| educationDegree | Education Requirements | SCALAR | String(50) |  | Not Specified, Associate, Bachelor, Masters, Doctoral, Post Doctoral, High School, Some College, Technical College |
| employmentType | Employment Type | SCALAR | String(200) | yes | Direct Hire, Contract, Contract to Hire, Extension |
| estimatedEndDate | Estimated End Date | SCALAR | Date |  |  |
| externalCategoryID | Public Category | SCALAR | Integer |  | Accounting / Human Resources: Accountant - General, Accounting / Human Resources: Accountant - Financial, Accounting / Human Resources: Accountant - Tax, Accounting / Human Resources: Accounts Receivable, Accounting / Human Resources: Accounts Payable, Accounting / Human Resources: Analyst, Accounting / Human Resources: Auditor, Accounting / Human Resources: Billing, Accounting / Human Resources: Bookkeeper, Accounting / Human Resources: Consultant, Accounting / Human Resources: Controller, Accounting / Human Resources: HR Manager …(194) |
| externalID | External ID | SCALAR | String(100) |  |  |
| feeArrangement | Perm Fee (%) | SCALAR | Double |  |  |
| fileAttachments | File Attachments | TO_MANY |  |  | → JobOrderFileAttachment |
| hoursOfOperation | Hours of Operation | SCALAR | String(30) |  | 9 to 5, 9 to 4, 9 to 6, 9 to 11, 9 to noon, 8 to 5, 8 to 4, 8 to 6, 8 to 11, 8 to noon, 7 to 3, 7 to 11 …(13) |
| hoursPerWeek | Hourly Commitment | SCALAR | Double |  |  |
| interviews | Interviews | TO_MANY |  |  | → Appointment |
| isClientEditable | Allow Client to Edit Job | SCALAR | Boolean |  | No, Yes |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isInterviewRequired | Interview Required? | SCALAR | Boolean |  | Yes, No |
| isJobcastPublished | Number of Employees | SCALAR | Boolean |  |  |
| isOpen | Open/Closed | SCALAR | Boolean | yes | Open, Closed |
| isPublic | Publishing Status | SCALAR | Integer |  | Not Published, Published - Submitted |
| isWorkFromHome | Work Type | SCALAR | Boolean |  | Remote, Hybrid |
| jobBoardList | Job Board List | SCALAR | String(2147483647) |  | CareerBuilder(Headhunter), Dice, Monster, CareerMag, CareerShop, JobOptions, ComputerJobs, CareerWeb, Net-Temps, Jobs.com, TriStateJobs, MarketingJobs …(40) |
| jobOrderScreenerQuestions | Job Order Screener Questions | TO_MANY |  |  | → JobOrderScreenerQuestion |
| jobPostingURL | Job Posting URL | SCALAR | String(100) |  |  |
| location | Location | TO_ONE |  |  | → Location |
| markUpPercentage | Mark-up % | SCALAR | Double |  |  |
| notes | Notes | TO_MANY |  |  | → Note |
| numOpenings | # of Openings | SCALAR | Integer | yes |  |
| onSite | Location Requirements | SCALAR | String(20) |  | Remote, Milestones, Up to 25%, Up to 50%, More than 50%, Not Specified |
| opportunity | Linked Opportunity ID | TO_ONE |  |  | → Opportunity |
| optionsPackage | Options Package | SCALAR | String(2147483647) |  |  |
| owner | Owner | TO_ONE |  | yes | → CorporateUser |
| payRate | Pay Rate | SCALAR | BigDecimal |  |  |
| placements | Placements | TO_MANY |  |  | → Placement |
| publicDescription | Public Job Description | SCALAR | String(2147483647) |  |  |
| publishedCategory | Published Category | TO_ONE |  |  | → Category |
| publishedZip | Published Zip Code | SCALAR | String(18) | yes |  |
| reasonClosed | Reason Closed | SCALAR | String(2147483647) |  |  |
| reportTo | Reporting to (other) | SCALAR | String(100) |  |  |
| reportToClientContact | Reporting to (contact) | TO_ONE |  |  | → ClientContact |
| responseUser | Published Contact Info | TO_ONE |  | yes | → CorporateUser |
| salary | Salary | SCALAR | BigDecimal |  |  |
| salaryUnit | Pay Type | SCALAR | String(12) |  | Per Hour, Per Day |
| screenerQuestionsStatus | Screener Questions Ready | SCALAR | Integer |  | Not Ready, Ready |
| sendouts | Client Submissions | TO_MANY |  |  | → Sendout |
| shift | Shift | TO_ONE |  |  | → Shift |
| shifts | Shifts | TO_MANY |  |  | → Shift |
| skillList | skills | SCALAR | String(2147483647) | yes | optionsType SkillText |
| skills | Skills | TO_MANY |  |  | → Skill |
| source | Source | SCALAR | String(100) | yes |  |
| specialties | Specialties | TO_MANY |  |  | → Specialty |
| startDate | Start Date | SCALAR | Timestamp | yes |  |
| status | Status | SCALAR | String(200) | yes | Accepting Candidates, Covered, On Hold, Offer Out, Placed, Lost - Competitor, Lost - Filled Internally, Lost, Archive |
| submissions | Submissions | TO_MANY |  |  | → JobSubmission |
| tasks | Tasks | TO_MANY |  |  | → Task |
| taxRate | Tax % | SCALAR | Double |  |  |
| taxStatus | Tax Preference | SCALAR | String(20) |  | No Preference, 1099, W-2 |
| tearsheets | Tearsheets | TO_MANY |  |  | → Tearsheet |
| timeAndLaborEnabledDate | Time and Labor Enabled Date | SCALAR | Timestamp |  |  |
| timeUnits | Time Units | TO_MANY |  |  | → TimeUnit |
| title | Consulting Job Title | SCALAR | String(100) | yes |  |
| travelRequirements | Travel Requirements | SCALAR | String(50) |  | Remote, Milestones, Up to 25%, Up to 50%, More than 50%, Not Specified |
| type | Priority | SCALAR | Integer | yes | Urgent, Hot, Warm, Cold |
| usersAssigned | Users Assigned | SCALAR | String |  |  |
| webResponses | Web Responses | TO_MANY |  |  | → JobSubmission |
| willRelocate | Will Relocate Boolean | SCALAR | Boolean |  |  |
| willRelocateInt | Will Relocate? | SCALAR | Integer |  | Not Applicable, Yes, No |
| willSponsor | Visa Sponsorship Provided | SCALAR | Boolean |  | Yes, No |
| workersCompRate | Workers Comp Code | TO_ONE |  |  | → WorkersCompensationRate |
| yearsRequired | Minimum Experience (Years) | SCALAR | Integer | yes | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 …(51) |

## JobSubmission — "Submission"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| appointments | Appointments | TO_MANY |  |  | → Appointment |
| billRate | Bill Rate | SCALAR | BigDecimal |  |  |
| branch | Branch ID | TO_ONE |  |  | → Branch |
| candidate | Candidate | TO_ONE |  | yes | → Candidate |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | Date Available | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customDate4 | customDate4 | SCALAR | Timestamp |  |  |
| customDate5 | customDate5 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customFloat4 | customFloat4 | SCALAR | Double |  |  |
| customFloat5 | customFloat5 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customInt4 | customInt4 | SCALAR | Integer |  |  |
| customInt5 | customInt5 | SCALAR | Integer |  |  |
| customText1 | Custom Text1 | SCALAR | String(100) |  |  |
| customText10 | Bill Rate | SCALAR | String(100) |  |  |
| customText11 | Consultant Pay Rate | SCALAR | String(100) |  |  |
| customText12 | Date Available, Notice Needed | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | Custom Text2 | SCALAR | String(100) |  |  |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText21 | customText21 | SCALAR | String(100) |  |  |
| customText22 | customText22 | SCALAR | String(100) |  |  |
| customText23 | customText23 | SCALAR | String(100) |  |  |
| customText24 | customText24 | SCALAR | String(100) |  |  |
| customText25 | customText25 | SCALAR | String(100) |  |  |
| customText3 | Custom Text3 | SCALAR | String(100) |  |  |
| customText4 | Custom Text4 | SCALAR | String(100) |  |  |
| customText5 | Custom Text5 | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| dateWebResponse | Date Web Response | SCALAR | Timestamp |  |  |
| endDate | End Date | SCALAR | Timestamp |  |  |
| history | History | TO_MANY |  |  | → JobSubmissionHistory |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isHidden | Is Hidden | SCALAR | Boolean |  |  |
| jobOrder | Job | TO_ONE |  | yes | → JobOrder |
| jobSubmissionCertificationRequirements | Job Submission Certification Requirements | TO_MANY |  |  | → JobSubmissionCertificationRequirement |
| latestAppointment | Latest Appointment | TO_ONE |  |  | → Appointment |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| owners | Owners | TO_MANY |  |  | → CorporateUser |
| payRate | Pay Rate | SCALAR | BigDecimal |  |  |
| salary | Salary | SCALAR | BigDecimal |  |  |
| screeningCompletedDateTime | Screening Completed Date | SCALAR | Timestamp |  |  |
| screeningDuration | Screening Duration | SCALAR | Double |  |  |
| screeningFeedbackComment | Screening Feedback Comment | SCALAR | String(2147483647) |  |  |
| screeningFeedbackRating | Screening Feedback Rating | SCALAR | Integer |  |  |
| screeningScore | Screening Score | SCALAR | Integer |  |  |
| screeningStatus | Screening Status | SCALAR | String(100) |  |  |
| screeningSummary | Screening Summary | SCALAR | String(2147483647) |  |  |
| sendingUser | Added By | TO_ONE |  | yes | → Person |
| source | Source | SCALAR | String(100) |  | Candidate Search, Job Match, External Web Site, Inbound Call, Other, LinkedIn |
| startDate | Start Date | SCALAR | Timestamp |  |  |
| status | Status | SCALAR | String(30) | yes | Reached Out, Unavailable, Recruiter Screen, Internally Submitted, Sales Rejected, Client Rejected, Candidate, On Hold, Withdrew, Offer Accepted, Offer Out, Offer Rejected …(13) |
| tasks | Task | TO_MANY |  |  | → Task |

## JobSubmissionHistory — "Job Submission History"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| jobSubmission | Job Submission | TO_ONE |  |  | → JobSubmission |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| modifyingUser | Modifying User | TO_ONE |  |  | → Person |
| status | Status | SCALAR | String(30) |  |  |
| transactionID | Transaction ID | SCALAR | String(36) |  |  |

## Placement

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| appointments | Appointments | TO_MANY |  |  | → Appointment |
| approvedChangeRequests | # Changes Approved | SCALAR | Integer |  |  |
| approvedPlacementRateCardChangeRequests | Approved Placement Rate Card Change Requests | SCALAR | Integer |  |  |
| approvingClientContact | Approving Client Contact | TO_ONE |  |  | → ClientContact |
| backupApprovingClientContact | Backup Approving Client Contact | TO_ONE |  |  | → ClientContact |
| benefitGroup | Benefit Group | SCALAR | String(100) |  |  |
| billingClientContact | Manager | TO_ONE |  |  | → ClientContact |
| billingFrequency | Billing Frequency | SCALAR | String(20) |  | Monthly, Weekly, Bi-Weekly, Semi-Monthly |
| bonusPackage | Bonus Package | SCALAR | String(2147483647) |  |  |
| branch | Branch ID | TO_ONE |  |  | → Branch |
| bteSyncStatus | BTE Sync Status | TO_ONE | SimplifiedOptionsLookup |  | Not Synced, Pending, Success, Failed |
| canEnterTime | Can Enter Time | SCALAR | Boolean |  |  |
| candidate | Candidate | TO_ONE |  | yes | → Candidate |
| changeRequests | Change Requests | TO_MANY |  |  | → PlacementChangeRequest |
| clientBillRate | Bill Rate | SCALAR | Double |  |  |
| clientContact | Contact | TO_ONE |  |  | → ClientContact |
| clientCorporation | Company | TO_ONE |  |  | → ClientCorporation |
| clientOvertimeRate | Over-time Bill Rate | SCALAR | Double |  |  |
| clientRating | Client Survey Rating | SCALAR | Integer |  |  |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| commissions | Commissions | TO_MANY |  |  | → PlacementCommission |
| completed | Completed | SCALAR | Integer |  |  |
| correlatedCustomDate1 | correlatedCustomDate1 | SCALAR | Timestamp |  |  |
| correlatedCustomDate2 | correlatedCustomDate2 | SCALAR | Timestamp |  |  |
| correlatedCustomDate3 | correlatedCustomDate3 | SCALAR | Timestamp |  |  |
| correlatedCustomFloat1 | correlatedCustomFloat1 | SCALAR | Double |  |  |
| correlatedCustomFloat2 | correlatedCustomFloat2 | SCALAR | Double |  |  |
| correlatedCustomFloat3 | correlatedCustomFloat3 | SCALAR | Double |  |  |
| correlatedCustomInt1 | correlatedCustomInt1 | SCALAR | Integer |  |  |
| correlatedCustomInt2 | correlatedCustomInt2 | SCALAR | Integer |  |  |
| correlatedCustomInt3 | correlatedCustomInt3 | SCALAR | Integer |  |  |
| correlatedCustomText1 | Timesheet Filter | SCALAR | String(100) |  |  |
| correlatedCustomText10 | correlatedCustomText10 | SCALAR | String(100) |  |  |
| correlatedCustomText2 | correlatedCustomText2 | SCALAR | String(100) |  |  |
| correlatedCustomText3 | correlatedCustomText3 | SCALAR | String(100) |  |  |
| correlatedCustomText4 | correlatedCustomText4 | SCALAR | String(100) |  |  |
| correlatedCustomText5 | correlatedCustomText5 | SCALAR | String(100) |  |  |
| correlatedCustomText6 | correlatedCustomText6 | SCALAR | String(100) |  |  |
| correlatedCustomText7 | correlatedCustomText7 | SCALAR | String(100) |  |  |
| correlatedCustomText8 | correlatedCustomText8 | SCALAR | String(100) |  |  |
| correlatedCustomText9 | correlatedCustomText9 | SCALAR | String(100) |  |  |
| correlatedCustomTextBlock1 | correlatedCustomTextBlock1 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock2 | correlatedCustomTextBlock2 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock3 | correlatedCustomTextBlock3 | SCALAR | String(2147483647) |  |  |
| costCenter | Cost Center | SCALAR | String(100) |  |  |
| credentialSpecialistUserID | Credential Specialist | SCALAR | Integer |  |  |
| customBillRate1 | OT 12Hr | SCALAR | BigDecimal |  |  |
| customBillRate10 | Custom 10 | SCALAR | BigDecimal |  |  |
| customBillRate2 | Specialty | SCALAR | BigDecimal |  |  |
| customBillRate3 | Holiday | SCALAR | BigDecimal |  |  |
| customBillRate4 | Call Back | SCALAR | BigDecimal |  |  |
| customBillRate5 | On Call | SCALAR | BigDecimal |  |  |
| customBillRate6 | Charge | SCALAR | BigDecimal |  |  |
| customBillRate7 | Shut Down | SCALAR | BigDecimal |  |  |
| customBillRate8 | Flat | SCALAR | BigDecimal |  |  |
| customBillRate9 | Long-Term | SCALAR | BigDecimal |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate10 | Custom Date 10 | SCALAR | Timestamp |  |  |
| customDate11 | Custom Date 11 | SCALAR | Timestamp |  |  |
| customDate12 | Custom Date 12 | SCALAR | Timestamp |  |  |
| customDate13 | Custom Date 13 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customDate4 | Custom Date 4 | SCALAR | Timestamp |  |  |
| customDate5 | Custom Date 5 | SCALAR | Timestamp |  |  |
| customDate6 | Custom Date 6 | SCALAR | Timestamp |  |  |
| customDate7 | Custom Date 7 | SCALAR | Timestamp |  |  |
| customDate8 | Custom Date 8 | SCALAR | Timestamp |  |  |
| customDate9 | Custom Date 9 | SCALAR | Timestamp |  |  |
| customEncryptedText1 | Custom Encrypted Text 1 | SCALAR | String(2147483647) |  |  |
| customEncryptedText10 | Custom Encrypted Text 10 | SCALAR | String(2147483647) |  |  |
| customEncryptedText2 | Custom Encrypted Text 2 | SCALAR | String(2147483647) |  |  |
| customEncryptedText3 | Custom Encrypted Text 3 | SCALAR | String(2147483647) |  |  |
| customEncryptedText4 | Custom Encrypted Text 4 | SCALAR | String(2147483647) |  |  |
| customEncryptedText5 | Custom Encrypted Text 5 | SCALAR | String(2147483647) |  |  |
| customEncryptedText6 | Custom Encrypted Text 6 | SCALAR | String(2147483647) |  |  |
| customEncryptedText7 | Custom Encrypted Text 7 | SCALAR | String(2147483647) |  |  |
| customEncryptedText8 | Custom Encrypted Text 8 | SCALAR | String(2147483647) |  |  |
| customEncryptedText9 | Custom Encrypted Text 9 | SCALAR | String(2147483647) |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat10 | Custom Float 10 | SCALAR | Double |  |  |
| customFloat11 | Custom Float 11 | SCALAR | Double |  |  |
| customFloat12 | Custom Float 12 | SCALAR | Double |  |  |
| customFloat13 | Custom Float 13 | SCALAR | Double |  |  |
| customFloat14 | Custom Float 14 | SCALAR | Double |  |  |
| customFloat15 | Custom Float 15 | SCALAR | Double |  |  |
| customFloat16 | Custom Float 16 | SCALAR | Double |  |  |
| customFloat17 | Custom Float 17 | SCALAR | Double |  |  |
| customFloat18 | Custom Float 18 | SCALAR | Double |  |  |
| customFloat19 | Custom Float 19 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat20 | Custom Float 20 | SCALAR | Double |  |  |
| customFloat21 | Custom Float 21 | SCALAR | Double |  |  |
| customFloat22 | Custom Float 22 | SCALAR | Double |  |  |
| customFloat23 | Custom Float 23 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customFloat4 | Custom Float 4 | SCALAR | Double |  |  |
| customFloat5 | Custom Float 5 | SCALAR | Double |  |  |
| customFloat6 | Custom Float 6 | SCALAR | Double |  |  |
| customFloat7 | Custom Float 7 | SCALAR | Double |  |  |
| customFloat8 | Custom Float 8 | SCALAR | Double |  |  |
| customFloat9 | Custom Float 9 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt10 | Custom Int 10 | SCALAR | Integer |  |  |
| customInt11 | Custom Int 11 | SCALAR | Integer |  |  |
| customInt12 | Custom Int 12 | SCALAR | Integer |  |  |
| customInt13 | Custom Int 13 | SCALAR | Integer |  |  |
| customInt14 | Custom Int 14 | SCALAR | Integer |  |  |
| customInt15 | Custom Int 15 | SCALAR | Integer |  |  |
| customInt16 | Custom Int 16 | SCALAR | Integer |  |  |
| customInt17 | Custom Int 17 | SCALAR | Integer |  |  |
| customInt18 | Custom Int 18 | SCALAR | Integer |  |  |
| customInt19 | Custom Int 19 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt20 | Custom Int 20 | SCALAR | Integer |  |  |
| customInt21 | Custom Int 21 | SCALAR | Integer |  |  |
| customInt22 | Custom Int 22 | SCALAR | Integer |  |  |
| customInt23 | Custom Int 23 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customInt4 | Custom Int 4 | SCALAR | Integer |  |  |
| customInt5 | Custom Int 5 | SCALAR | Integer |  |  |
| customInt6 | Custom Int 6 | SCALAR | Integer |  |  |
| customInt7 | Custom Int 7 | SCALAR | Integer |  |  |
| customInt8 | Custom Int 8 | SCALAR | Integer |  |  |
| customInt9 | Custom Int 9 | SCALAR | Integer |  |  |
| customPayRate1 | OT 12Hr | SCALAR | BigDecimal |  |  |
| customPayRate10 | Custom 10 | SCALAR | BigDecimal |  |  |
| customPayRate2 | Specialty | SCALAR | BigDecimal |  |  |
| customPayRate3 | Holiday | SCALAR | BigDecimal |  |  |
| customPayRate4 | Call Back | SCALAR | BigDecimal |  |  |
| customPayRate5 | On Call | SCALAR | BigDecimal |  |  |
| customPayRate6 | Charge | SCALAR | BigDecimal |  |  |
| customPayRate7 | Shut Down | SCALAR | BigDecimal |  |  |
| customPayRate8 | Flat | SCALAR | BigDecimal |  |  |
| customPayRate9 | Long-Term | SCALAR | BigDecimal |  |  |
| customText1 | Consultant Advocate | SCALAR | String(100) |  | optionsType CorporateUserText |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText11 | customText11 | SCALAR | String(100) |  |  |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | Extension Contract | SCALAR | String(100) |  | No, Yes |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText21 | customText21 | SCALAR | String(100) |  |  |
| customText22 | customText22 | SCALAR | String(100) |  |  |
| customText23 | customText23 | SCALAR | String(100) |  |  |
| customText24 | customText24 | SCALAR | String(100) |  |  |
| customText25 | customText25 | SCALAR | String(100) |  |  |
| customText26 | customText26 | SCALAR | String(100) |  |  |
| customText27 | customText27 | SCALAR | String(100) |  |  |
| customText28 | customText28 | SCALAR | String(100) |  |  |
| customText29 | customText29 | SCALAR | String(100) |  |  |
| customText3 | customText3 | SCALAR | String(100) |  |  |
| customText30 | customText30 | SCALAR | String(100) |  |  |
| customText31 | customText31 | SCALAR | String(100) |  |  |
| customText32 | customText32 | SCALAR | String(100) |  |  |
| customText33 | customText33 | SCALAR | String(100) |  |  |
| customText34 | customText34 | SCALAR | String(100) |  |  |
| customText35 | customText35 | SCALAR | String(100) |  |  |
| customText36 | customText36 | SCALAR | String(100) |  |  |
| customText37 | customText37 | SCALAR | String(100) |  |  |
| customText38 | customText38 | SCALAR | String(100) |  |  |
| customText39 | customText39 | SCALAR | String(100) |  |  |
| customText4 | customText4 | SCALAR | String(100) |  |  |
| customText40 | customText40 | SCALAR | String(100) |  |  |
| customText41 | Custom Text 41 | SCALAR | String(100) |  |  |
| customText42 | Custom Text 42 | SCALAR | String(100) |  |  |
| customText43 | Custom Text 43 | SCALAR | String(100) |  |  |
| customText44 | Custom Text 44 | SCALAR | String(100) |  |  |
| customText45 | Custom Text 45 | SCALAR | String(100) |  |  |
| customText46 | Custom Text 46 | SCALAR | String(100) |  |  |
| customText47 | Custom Text 47 | SCALAR | String(100) |  |  |
| customText48 | Custom Text 48 | SCALAR | String(100) |  |  |
| customText49 | Custom Text 49 | SCALAR | String(100) |  |  |
| customText5 | customText5 | SCALAR | String(100) |  |  |
| customText50 | Custom Text 50 | SCALAR | String(100) |  |  |
| customText51 | Custom Text 51 | SCALAR | String(100) |  |  |
| customText52 | Custom Text 52 | SCALAR | String(100) |  |  |
| customText53 | Custom Text 53 | SCALAR | String(100) |  |  |
| customText54 | Custom Text 54 | SCALAR | String(100) |  |  |
| customText55 | Custom Text 55 | SCALAR | String(100) |  |  |
| customText56 | Custom Text 56 | SCALAR | String(100) |  |  |
| customText57 | Custom Text 57 | SCALAR | String(100) |  |  |
| customText58 | Custom Text 58 | SCALAR | String(100) |  |  |
| customText59 | Custom Text 59 | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText60 | Custom Text 60 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock10 | Custom Text Block 10 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| customTextBlock6 | Custom Text Block 6 | SCALAR | String(2147483647) |  |  |
| customTextBlock7 | Custom Text Block 7 | SCALAR | String(2147483647) |  |  |
| customTextBlock8 | Custom Text Block 8 | SCALAR | String(2147483647) |  |  |
| customTextBlock9 | Custom Text Block 9 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp | yes |  |
| dateBegin | Start Date | SCALAR | Timestamp | yes |  |
| dateClientEffective | Effective Date (Client) | SCALAR | Timestamp |  |  |
| dateEffective | Effective Date | SCALAR | Timestamp |  |  |
| dateEnd | Scheduled End | SCALAR | Timestamp | yes |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| daysGuaranteed | Days Guaranteed | SCALAR | Integer |  |  |
| daysProRated | Days Pro-Rated | SCALAR | Integer |  |  |
| draftPlacementRateCardChangeRequests | Draft Placement Rate Card Change Requests | SCALAR | Integer |  |  |
| durationWeeks | Job Duration | SCALAR | Double |  | Indefinite, 1 Day, 2 Days, 3 Days, 4 Days, 5 Days, 1 week, 2 weeks, 3 weeks, 4 weeks, 5 weeks, 6 weeks …(37) |
| employeeType | Employee Type | SCALAR | String(30) |  | W2, 1099 |
| employmentStartDate | Employment Start Date | SCALAR | Timestamp |  |  |
| employmentType | Employment Type | SCALAR | String(200) | yes | Direct Hire, Contract, Contract to Hire, Extension |
| estaffGUID | eStaff GUID | SCALAR | String(36) |  |  |
| estimatedEndDate | Estimated End Date | SCALAR | Date |  |  |
| expiringCredentials | # Expiring Credentials | SCALAR | Integer |  |  |
| expiringRequirements | Expiring Requirements | SCALAR | Integer |  |  |
| fee | Placement Fee (%) | SCALAR | Double |  |  |
| fileAttachments | File Attachments | TO_MANY |  |  | → PlacementFileAttachment |
| flatFee | Placement Fee | SCALAR | Double |  |  |
| hoursOfOperation | Hours of Operation | SCALAR | String(100) |  | 9 to 5, 9 to 4, 9 to 6, 9 to 11, 9 to noon, 8 to 5, 8 to 4, 8 to 6, 8 to 11, 8 to noon, 7 to 3, 7 to 11 …(13) |
| hoursPerDay | Hours Per Day | SCALAR | Double |  |  |
| housingAmenities | Housing Amenities | TO_MANY |  |  | → HousingComplexAmenity |
| housingManagerID | Housing Manager ID | SCALAR | Integer |  | optionsType CorporateUser |
| housingStatus | Housing Status | SCALAR | String(30) |  |  |
| inProgress | In Progress | SCALAR | Integer |  |  |
| incomplete | Incomplete | SCALAR | Integer |  |  |
| incompleteRequirements | # Incomplete Requirements | SCALAR | Integer |  |  |
| invoiceGroupName | Invoice Grouping | SCALAR | String(100) |  |  |
| isMultirate | Rate Entry Type | SCALAR | Boolean |  | Single Rate, Multiple Rate |
| isWorkFromHome | Work From Home | SCALAR | Boolean |  | Yes, No |
| jobLocation | Job Location | TO_ONE |  |  | → Location |
| jobOrder | Job | TO_ONE |  | yes | → JobOrder |
| jobSubmission | Submission | TO_ONE |  |  | → JobSubmission |
| lastApprovedPlacementChangeRequest | Last Approved Placement Change Request | TO_ONE |  |  | → PlacementChangeRequest |
| lastBteSyncDate | Last BTE Sync Date | SCALAR | Timestamp |  |  |
| location | Location | TO_ONE |  |  | → Location |
| markUpPercentage | Mark-up % | SCALAR | Double |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| notes | Notes | TO_MANY |  |  | → Note |
| onboardingDocumentReceivedCount | Onboarding Docs Received | SCALAR | Integer |  |  |
| onboardingDocumentSentCount | Onboarding Docs Sent | SCALAR | Integer |  |  |
| onboardingPercentComplete | % Complete | SCALAR | Integer |  |  |
| onboardingReceivedSent | Onboarding Received Sent | COMPOSITE | OnboardingReceivedSent |  |  |
| onboardingStatus | Onboarding Status | SCALAR | String(100) |  |  |
| optionsPackage | Options Package | SCALAR | String(2147483647) |  |  |
| otExemption | Overtime Exemption | SCALAR | Integer |  | True, False |
| otherHourlyFee | Other Hourly Fee | SCALAR | Double |  |  |
| otherHourlyFeeComments | Other Hourly Fee Comments | SCALAR | String(2147483647) |  |  |
| overtimeMarkUpPercentage | OT Mark-up % | SCALAR | Double |  |  |
| overtimeRate | Over-time Pay Rate | SCALAR | Double |  |  |
| owner | Owner | TO_ONE |  |  | → CorporateUser |
| owners | Owners | TO_MANY |  |  | → CorporateUser |
| payGroup | Pay Group | SCALAR | String(255) |  |  |
| payRate | Pay Rate | SCALAR | BigDecimal |  |  |
| payrollEmployeeType | Payroll Employee Type | TO_ONE | SimplifiedOptionsLookup |  | W2, 1099 |
| payrollSyncStatus | Payroll Sync Status | TO_ONE | SimplifiedOptionsLookup |  | Not Ready to Sync, Ready to Sync, Synced, Sync Failed |
| pendingChangeRequests | # Changes Waiting Approval | SCALAR | Integer |  |  |
| pendingPlacementRateCardChangeRequests | Pending Placement Rate Card Change Requests | SCALAR | Integer |  |  |
| placementCertifications | Requirement | TO_MANY |  |  | → PlacementCertification |
| placementDocumentDeadline | Document Deadline | SCALAR | Date |  |  |
| positionCode | Position Code | SCALAR | String(100) |  |  |
| projectCodeList | Project Code List | SCALAR | String(255) |  |  |
| quitJob | Quit Job | SCALAR | Boolean |  |  |
| readyForReviewPlacementRateCardChangeRequests | Ready for Review Placement Rate Card Change Requests | SCALAR | Integer |  |  |
| recruitingManagerPercentGrossMargin | Recruiting Manager Commission Over-ride % | SCALAR | Double |  |  |
| referralFee | Referral Fee | SCALAR | BigDecimal |  |  |
| referralFeeType | Referral Fee Type | SCALAR | String(20) |  |  |
| rejectedPlacementRateCardChangeRequests | Rejected Placement Rate Card Change Requests | SCALAR | Integer |  |  |
| reportTo | Reporting to | SCALAR | String(100) |  |  |
| reportedMargin | Reported Margin | SCALAR | Double |  |  |
| requestRevisionPlacementRateCardChangeRequests | Request Revision Placement Rate Card Change Requests | SCALAR | Integer |  |  |
| requirementCompleted | Requirement Completed | SCALAR | Double |  |  |
| salary | Salary | SCALAR | BigDecimal |  |  |
| salaryUnit | Pay Type | SCALAR | String(20) |  | Per Hour, Per Day, Per Year |
| salesManagerPercentGrossMargin | Sales Manager Commission Over-ride % | SCALAR | Double |  |  |
| shift | Shift | TO_ONE |  |  | → Shift |
| statementClientContact | Statement Contact | TO_ONE |  |  | → ClientContact |
| status | Status | SCALAR | String(30) | yes | Submitted, Rejected, Actively On Contract, Drop Out, Terminated, Contract Completed, Direct Hire Completed |
| tasks | Tasks | TO_MANY |  |  | → Task |
| taxRate | Tax % | SCALAR | Double |  |  |
| taxState | Tax State | SCALAR | String(50) |  | optionsType NorthAmericaState |
| terminationReason | Termination Reason | SCALAR | String(100) |  |  |
| timeAndExpense | Time and Expense | TO_ONE | AbstractEmbeddedEntity |  | → PlacementTimeAndExpense |
| timeUnits | Time Units | TO_MANY |  |  | → TimeUnit |
| totalRequirements | Total Requirements | SCALAR | Integer |  |  |
| updated | Updated | SCALAR | Integer |  |  |
| userHousingComplexUnits | User Housing Complex Units | TO_MANY |  |  | → UserHousingComplexUnit |
| vendorClientCorporation | Umbrella Company | TO_ONE |  |  | → ClientCorporation |
| workWeekStart | Work Week Begin | SCALAR | Integer |  | 1, 2 |
| workersCompensationRate | Workers Comp Code | TO_ONE |  |  | → WorkersCompensationRate |

## PlacementChangeRequest — "Change Request"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| approvingClientContact | Approving Client Contact | TO_ONE |  |  | → ClientContact |
| approvingUser | Approving User | TO_ONE |  |  | → CorporateUser |
| backupApprovingClientContact | Backup Approving Client Contact | TO_ONE |  |  | → ClientContact |
| benefitGroup | Benefit Group | SCALAR | String(100) |  |  |
| billingClientContact | Manager | TO_ONE |  |  | → ClientContact |
| billingFrequency | Billing Frequency | SCALAR | String(20) |  | Monthly, Weekly, Bi-Weekly, Semi-Monthly |
| bonusPackage | Bonus Package | SCALAR | String(2147483647) |  |  |
| clientBillRate | Bill Rate | SCALAR | Double |  |  |
| clientOvertimeRate | Over-time Bill Rate | SCALAR | Double |  |  |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| correlatedCustomDate1 | correlatedCustomDate1 | SCALAR | Timestamp |  |  |
| correlatedCustomDate2 | correlatedCustomDate2 | SCALAR | Timestamp |  |  |
| correlatedCustomDate3 | correlatedCustomDate3 | SCALAR | Timestamp |  |  |
| correlatedCustomFloat1 | correlatedCustomFloat1 | SCALAR | Double |  |  |
| correlatedCustomFloat2 | correlatedCustomFloat2 | SCALAR | Double |  |  |
| correlatedCustomFloat3 | correlatedCustomFloat3 | SCALAR | Double |  |  |
| correlatedCustomInt1 | correlatedCustomInt1 | SCALAR | Integer |  |  |
| correlatedCustomInt2 | correlatedCustomInt2 | SCALAR | Integer |  |  |
| correlatedCustomInt3 | correlatedCustomInt3 | SCALAR | Integer |  |  |
| correlatedCustomText1 | Timesheet Filter | SCALAR | String(100) |  |  |
| correlatedCustomText10 | correlatedCustomText10 | SCALAR | String(100) |  |  |
| correlatedCustomText2 | correlatedCustomText2 | SCALAR | String(100) |  |  |
| correlatedCustomText3 | correlatedCustomText3 | SCALAR | String(100) |  |  |
| correlatedCustomText4 | correlatedCustomText4 | SCALAR | String(100) |  |  |
| correlatedCustomText5 | correlatedCustomText5 | SCALAR | String(100) |  |  |
| correlatedCustomText6 | correlatedCustomText6 | SCALAR | String(100) |  |  |
| correlatedCustomText7 | correlatedCustomText7 | SCALAR | String(100) |  |  |
| correlatedCustomText8 | correlatedCustomText8 | SCALAR | String(100) |  |  |
| correlatedCustomText9 | correlatedCustomText9 | SCALAR | String(100) |  |  |
| correlatedCustomTextBlock1 | correlatedCustomTextBlock1 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock2 | correlatedCustomTextBlock2 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock3 | correlatedCustomTextBlock3 | SCALAR | String(2147483647) |  |  |
| costCenter | Cost Center | SCALAR | String(100) |  |  |
| customBillRate1 | OT 12Hr | SCALAR | BigDecimal |  |  |
| customBillRate10 | Custom 10 | SCALAR | BigDecimal |  |  |
| customBillRate2 | Specialty | SCALAR | BigDecimal |  |  |
| customBillRate3 | Holiday | SCALAR | BigDecimal |  |  |
| customBillRate4 | Call Back | SCALAR | BigDecimal |  |  |
| customBillRate5 | On Call | SCALAR | BigDecimal |  |  |
| customBillRate6 | Charge | SCALAR | BigDecimal |  |  |
| customBillRate7 | Shut Down | SCALAR | BigDecimal |  |  |
| customBillRate8 | Flat | SCALAR | BigDecimal |  |  |
| customBillRate9 | Long-Term | SCALAR | BigDecimal |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate10 | Custom Date 10 | SCALAR | Timestamp |  |  |
| customDate11 | Custom Date 11 | SCALAR | Timestamp |  |  |
| customDate12 | Custom Date 12 | SCALAR | Timestamp |  |  |
| customDate13 | Custom Date 13 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customDate4 | Custom Date 4 | SCALAR | Timestamp |  |  |
| customDate5 | Custom Date 5 | SCALAR | Timestamp |  |  |
| customDate6 | Custom Date 6 | SCALAR | Timestamp |  |  |
| customDate7 | Custom Date 7 | SCALAR | Timestamp |  |  |
| customDate8 | Custom Date 8 | SCALAR | Timestamp |  |  |
| customDate9 | Custom Date 9 | SCALAR | Timestamp |  |  |
| customEncryptedText1 | Custom Encrypted Text 1 | SCALAR | String(2147483647) |  |  |
| customEncryptedText10 | Custom Encrypted Text 10 | SCALAR | String(2147483647) |  |  |
| customEncryptedText2 | Custom Encrypted Text 2 | SCALAR | String(2147483647) |  |  |
| customEncryptedText3 | Custom Encrypted Text 3 | SCALAR | String(2147483647) |  |  |
| customEncryptedText4 | Custom Encrypted Text 4 | SCALAR | String(2147483647) |  |  |
| customEncryptedText5 | Custom Encrypted Text 5 | SCALAR | String(2147483647) |  |  |
| customEncryptedText6 | Custom Encrypted Text 6 | SCALAR | String(2147483647) |  |  |
| customEncryptedText7 | Custom Encrypted Text 7 | SCALAR | String(2147483647) |  |  |
| customEncryptedText8 | Custom Encrypted Text 8 | SCALAR | String(2147483647) |  |  |
| customEncryptedText9 | Custom Encrypted Text 9 | SCALAR | String(2147483647) |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat10 | Custom Float 10 | SCALAR | Double |  |  |
| customFloat11 | Custom Float 11 | SCALAR | Double |  |  |
| customFloat12 | Custom Float 12 | SCALAR | Double |  |  |
| customFloat13 | Custom Float 13 | SCALAR | Double |  |  |
| customFloat14 | Custom Float 14 | SCALAR | Double |  |  |
| customFloat15 | Custom Float 15 | SCALAR | Double |  |  |
| customFloat16 | Custom Float 16 | SCALAR | Double |  |  |
| customFloat17 | Custom Float 17 | SCALAR | Double |  |  |
| customFloat18 | Custom Float 18 | SCALAR | Double |  |  |
| customFloat19 | Custom Float 19 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat20 | Custom Float 20 | SCALAR | Double |  |  |
| customFloat21 | Custom Float 21 | SCALAR | Double |  |  |
| customFloat22 | Custom Float 22 | SCALAR | Double |  |  |
| customFloat23 | Custom Float 23 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customFloat4 | Custom Float 4 | SCALAR | Double |  |  |
| customFloat5 | Custom Float 5 | SCALAR | Double |  |  |
| customFloat6 | Custom Float 6 | SCALAR | Double |  |  |
| customFloat7 | Custom Float 7 | SCALAR | Double |  |  |
| customFloat8 | Custom Float 8 | SCALAR | Double |  |  |
| customFloat9 | Custom Float 9 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt10 | Custom Int 10 | SCALAR | Integer |  |  |
| customInt11 | Custom Int 11 | SCALAR | Integer |  |  |
| customInt12 | Custom Int 12 | SCALAR | Integer |  |  |
| customInt13 | Custom Int 13 | SCALAR | Integer |  |  |
| customInt14 | Custom Int 14 | SCALAR | Integer |  |  |
| customInt15 | Custom Int 15 | SCALAR | Integer |  |  |
| customInt16 | Custom Int 16 | SCALAR | Integer |  |  |
| customInt17 | Custom Int 17 | SCALAR | Integer |  |  |
| customInt18 | Custom Int 18 | SCALAR | Integer |  |  |
| customInt19 | Custom Int 19 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt20 | Custom Int 20 | SCALAR | Integer |  |  |
| customInt21 | Custom Int 21 | SCALAR | Integer |  |  |
| customInt22 | Custom Int 22 | SCALAR | Integer |  |  |
| customInt23 | Custom Int 23 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customInt4 | Custom Int 4 | SCALAR | Integer |  |  |
| customInt5 | Custom Int 5 | SCALAR | Integer |  |  |
| customInt6 | Custom Int 6 | SCALAR | Integer |  |  |
| customInt7 | Custom Int 7 | SCALAR | Integer |  |  |
| customInt8 | Custom Int 8 | SCALAR | Integer |  |  |
| customInt9 | Custom Int 9 | SCALAR | Integer |  |  |
| customPayRate1 | OT 12Hr | SCALAR | BigDecimal |  |  |
| customPayRate10 | Custom 10 | SCALAR | BigDecimal |  |  |
| customPayRate2 | Specialty | SCALAR | BigDecimal |  |  |
| customPayRate3 | Holiday | SCALAR | BigDecimal |  |  |
| customPayRate4 | Call Back | SCALAR | BigDecimal |  |  |
| customPayRate5 | On Call | SCALAR | BigDecimal |  |  |
| customPayRate6 | Charge | SCALAR | BigDecimal |  |  |
| customPayRate7 | Shut Down | SCALAR | BigDecimal |  |  |
| customPayRate8 | Flat | SCALAR | BigDecimal |  |  |
| customPayRate9 | Long-Term | SCALAR | BigDecimal |  |  |
| customText1 | Consultant Advocate | SCALAR | String(100) |  | optionsType CorporateUserText |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText11 | customText11 | SCALAR | String(100) |  |  |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | Extension Contract | SCALAR | String(100) |  | No, Yes |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText21 | customText21 | SCALAR | String(100) |  |  |
| customText22 | customText22 | SCALAR | String(100) |  |  |
| customText23 | customText23 | SCALAR | String(100) |  |  |
| customText24 | customText24 | SCALAR | String(100) |  |  |
| customText25 | customText25 | SCALAR | String(100) |  |  |
| customText26 | customText26 | SCALAR | String(100) |  |  |
| customText27 | customText27 | SCALAR | String(100) |  |  |
| customText28 | customText28 | SCALAR | String(100) |  |  |
| customText29 | customText29 | SCALAR | String(100) |  |  |
| customText3 | customText3 | SCALAR | String(100) |  |  |
| customText30 | customText30 | SCALAR | String(100) |  |  |
| customText31 | customText31 | SCALAR | String(100) |  |  |
| customText32 | customText32 | SCALAR | String(100) |  |  |
| customText33 | customText33 | SCALAR | String(100) |  |  |
| customText34 | customText34 | SCALAR | String(100) |  |  |
| customText35 | customText35 | SCALAR | String(100) |  |  |
| customText36 | customText36 | SCALAR | String(100) |  |  |
| customText37 | customText37 | SCALAR | String(100) |  |  |
| customText38 | customText38 | SCALAR | String(100) |  |  |
| customText39 | customText39 | SCALAR | String(100) |  |  |
| customText4 | customText4 | SCALAR | String(100) |  |  |
| customText40 | customText40 | SCALAR | String(100) |  |  |
| customText41 | Custom Text 41 | SCALAR | String(100) |  |  |
| customText42 | Custom Text 42 | SCALAR | String(100) |  |  |
| customText43 | Custom Text 43 | SCALAR | String(100) |  |  |
| customText44 | Custom Text 44 | SCALAR | String(100) |  |  |
| customText45 | Custom Text 45 | SCALAR | String(100) |  |  |
| customText46 | Custom Text 46 | SCALAR | String(100) |  |  |
| customText47 | Custom Text 47 | SCALAR | String(100) |  |  |
| customText48 | Custom Text 48 | SCALAR | String(100) |  |  |
| customText49 | Custom Text 49 | SCALAR | String(100) |  |  |
| customText5 | customText5 | SCALAR | String(100) |  |  |
| customText50 | Custom Text 50 | SCALAR | String(100) |  |  |
| customText51 | Custom Text 51 | SCALAR | String(100) |  |  |
| customText52 | Custom Text 52 | SCALAR | String(100) |  |  |
| customText53 | Custom Text 53 | SCALAR | String(100) |  |  |
| customText54 | Custom Text 54 | SCALAR | String(100) |  |  |
| customText55 | Custom Text 55 | SCALAR | String(100) |  |  |
| customText56 | Custom Text 56 | SCALAR | String(100) |  |  |
| customText57 | Custom Text 57 | SCALAR | String(100) |  |  |
| customText58 | Custom Text 58 | SCALAR | String(100) |  |  |
| customText59 | Custom Text 59 | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText60 | Custom Text 60 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock10 | Custom Text Block 10 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| customTextBlock6 | Custom Text Block 6 | SCALAR | String(2147483647) |  |  |
| customTextBlock7 | Custom Text Block 7 | SCALAR | String(2147483647) |  |  |
| customTextBlock8 | Custom Text Block 8 | SCALAR | String(2147483647) |  |  |
| customTextBlock9 | Custom Text Block 9 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateApproved | Date Approved | SCALAR | Timestamp |  |  |
| dateBegin | Start Date | SCALAR | Timestamp | yes |  |
| dateClientEffective | Effective Date (Client) | SCALAR | Timestamp |  |  |
| dateEffective | Effective Date | SCALAR | Timestamp |  |  |
| dateEnd | Scheduled End | SCALAR | Timestamp | yes |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| daysGuaranteed | Days Guaranteed | SCALAR | Integer |  |  |
| daysProRated | Days Pro-Rated | SCALAR | Integer |  |  |
| durationWeeks | Job Duration | SCALAR | Double |  | Indefinite, 1 Day, 2 Days, 3 Days, 4 Days, 5 Days, 1 week, 2 weeks, 3 weeks, 4 weeks, 5 weeks, 6 weeks …(37) |
| editHistory | Edit History | TO_MANY |  |  | → PlacementChangeRequestEditHistory |
| employeeType | Employee Type | SCALAR | String(30) |  | W2, 1099 |
| employmentStartDate | Employment Start Date | SCALAR | Timestamp |  |  |
| employmentType | Employment Type | SCALAR | String(200) | yes | Direct Hire, Contract, Contract to Hire, Extension |
| estimatedEndDate | Estimated End Date | SCALAR | Date |  |  |
| fee | Placement Fee (%) | SCALAR | Double |  |  |
| flatFee | Placement Fee | SCALAR | Double |  |  |
| hoursOfOperation | Hours of Operation | SCALAR | String(100) |  | 9 to 5, 9 to 4, 9 to 6, 9 to 11, 9 to noon, 8 to 5, 8 to 4, 8 to 6, 8 to 11, 8 to noon, 7 to 3, 7 to 11 …(13) |
| hoursPerDay | Hours Per Day | SCALAR | Double |  |  |
| housingAmenities | Housing Amenities | TO_MANY |  |  | → HousingComplexAmenity |
| housingManagerID | Housing Manager ID | SCALAR | Integer |  | optionsType CorporateUser |
| housingStatus | Housing Status | SCALAR | String(30) |  |  |
| isMultirate | Rate Entry Type | SCALAR | Boolean |  | Single Rate, Multiple Rate |
| location | Location | TO_ONE |  |  | → Location |
| markUpPercentage | Mark-up % | SCALAR | Double |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| optionsPackage | Options Package | SCALAR | String(2147483647) |  |  |
| otExemption | Overtime Exemption | SCALAR | Integer |  | True, False |
| otherHourlyFee | Other Hourly Fee | SCALAR | Double |  |  |
| otherHourlyFeeComments | Other Hourly Fee Comments | SCALAR | String(2147483647) |  |  |
| overtimeRate | Over-time Pay Rate | SCALAR | Double |  |  |
| payGroup | Pay Group | SCALAR | String(255) |  |  |
| payRate | Pay Rate | SCALAR | BigDecimal |  |  |
| payrollEmployeeType | Payroll Employee Type | TO_ONE | SimplifiedOptionsLookup |  | W2, 1099 |
| placement | Placement # | TO_ONE |  | yes | → Placement |
| positionCode | Position Code | SCALAR | String(100) |  |  |
| recruitingManagerPercentGrossMargin | Recruiting Manager Commission Over-ride % | SCALAR | Double |  |  |
| referralFee | Referral Fee | SCALAR | BigDecimal |  |  |
| referralFeeType | Referral Fee Type | SCALAR | String(20) |  |  |
| reportTo | Reporting to | SCALAR | String(100) |  |  |
| requestCustomDate1 | requestCustomDate1 | SCALAR | Timestamp |  |  |
| requestCustomDate2 | requestCustomDate2 | SCALAR | Timestamp |  |  |
| requestCustomDate3 | requestCustomDate3 | SCALAR | Timestamp |  |  |
| requestCustomFloat1 | requestCustomFloat1 | SCALAR | Double |  |  |
| requestCustomFloat2 | requestCustomFloat2 | SCALAR | Double |  |  |
| requestCustomFloat3 | requestCustomFloat3 | SCALAR | Double |  |  |
| requestCustomInt1 | requestCustomInt1 | SCALAR | Integer |  |  |
| requestCustomInt2 | requestCustomInt2 | SCALAR | Integer |  |  |
| requestCustomInt3 | requestCustomInt3 | SCALAR | Integer |  |  |
| requestCustomText1 | requestCustomText1 | SCALAR | String(100) |  |  |
| requestCustomText10 | requestCustomText10 | SCALAR | String(100) |  |  |
| requestCustomText11 | requestCustomText11 | SCALAR | String(100) |  |  |
| requestCustomText12 | requestCustomText12 | SCALAR | String(100) |  |  |
| requestCustomText13 | requestCustomText13 | SCALAR | String(100) |  |  |
| requestCustomText14 | requestCustomText14 | SCALAR | String(100) |  |  |
| requestCustomText15 | requestCustomText15 | SCALAR | String(100) |  |  |
| requestCustomText16 | requestCustomText16 | SCALAR | String(100) |  |  |
| requestCustomText17 | requestCustomText17 | SCALAR | String(100) |  |  |
| requestCustomText18 | requestCustomText18 | SCALAR | String(100) |  |  |
| requestCustomText19 | requestCustomText19 | SCALAR | String(100) |  |  |
| requestCustomText2 | requestCustomText2 | SCALAR | String(100) |  |  |
| requestCustomText20 | requestCustomText20 | SCALAR | String(100) |  |  |
| requestCustomText3 | requestCustomText3 | SCALAR | String(100) |  |  |
| requestCustomText4 | requestCustomText4 | SCALAR | String(100) |  |  |
| requestCustomText5 | requestCustomText5 | SCALAR | String(100) |  |  |
| requestCustomText6 | requestCustomText6 | SCALAR | String(100) |  |  |
| requestCustomText7 | requestCustomText7 | SCALAR | String(100) |  |  |
| requestCustomText8 | requestCustomText8 | SCALAR | String(100) |  |  |
| requestCustomText9 | requestCustomText9 | SCALAR | String(100) |  |  |
| requestCustomTextBlock1 | requestCustomTextBlock1 | SCALAR | String(2147483647) |  |  |
| requestCustomTextBlock2 | requestCustomTextBlock2 | SCALAR | String(2147483647) |  |  |
| requestCustomTextBlock3 | requestCustomTextBlock3 | SCALAR | String(2147483647) |  |  |
| requestCustomTextBlock4 | requestCustomTextBlock4 | SCALAR | String(2147483647) |  |  |
| requestCustomTextBlock5 | requestCustomTextBlock5 | SCALAR | String(2147483647) |  |  |
| requestStatus | Request Status | SCALAR | String(100) | yes | Submitted, Approved, Rejected, Withdrawn |
| requestType | Request Type | SCALAR | String(100) | yes | Pay & Billing Change, Pay Change, Billing Change, Status Change, Contract Extension |
| requestingUser | Requested by | TO_ONE |  | yes | → CorporateUser |
| salary | Salary | SCALAR | BigDecimal |  |  |
| salaryUnit | Pay Type | SCALAR | String(20) |  | Per Hour, Per Day, Per Year |
| salesManagerPercentGrossMargin | Sales Manager Commission Over-ride % | SCALAR | Double |  |  |
| statementClientContact | Statement Contact | TO_ONE |  |  | → ClientContact |
| status | Status | SCALAR | String(100) | yes | Submitted, Rejected, Actively On Contract, Drop Out, Terminated, Contract Completed, Direct Hire Completed |
| taxRate | Tax % | SCALAR | Double |  |  |
| taxState | Tax State | SCALAR | String(50) |  | optionsType NorthAmericaState |
| terminationReason | Termination Reason | SCALAR | String(100) |  |  |
| timeAndExpense | Time and Expense | TO_ONE | AbstractEmbeddedEntity |  | → PlacementTimeAndExpenseChangeRequest |
| vendorClientCorporation | Umbrella Company | TO_ONE |  |  | → ClientCorporation |
| workWeekStart | Work Week Begin | SCALAR | Integer |  | 1, 2 |
| workersCompRate | Workers Comp Code | TO_ONE |  |  | → WorkersCompensationRate |

## PlacementCommission — "Placement Commission"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| commissionPercentage | Split | SCALAR | Double | yes |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| editHistory | Edit History | TO_MANY |  |  | → PlacementCommissionEditHistory |
| externalRecipient | External Recipient | SCALAR | String(100) | yes |  |
| flatPayout | Fee Split | SCALAR | Double |  |  |
| grossMarginPercentage | % of Gross Margin | SCALAR | Double | yes |  |
| hourlyPayout | Hourly Commission | SCALAR | Double |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| placement | Placement | TO_ONE |  |  | → Placement |
| role | Role | SCALAR | String(50) |  |  |
| status | Status | SCALAR | String(30) |  |  |
| user | Recipient | TO_ONE |  | yes | → CorporateUser |

## Opportunity — "MSA"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| actualCloseDate | Actual Execution Date | SCALAR | Timestamp |  |  |
| address | Full Address | COMPOSITE | Address |  |  |
| appointments | Appointments | TO_MANY |  |  | → Appointment |
| assignedDate | Assigned Date | SCALAR | Timestamp |  |  |
| assignedUsers | Assigned Team | TO_MANY |  |  | → CorporateUser |
| benefits | Benefits | SCALAR | String(2147483647) |  |  |
| billRateCategoryID | Bill Rate Category | SCALAR | Integer |  | optionsType BillRateCategory |
| bonusPackage | Bonus Package | SCALAR | String(2147483647) |  |  |
| branch | Branch ID | TO_ONE |  |  | → Branch |
| branchCode | Pursuit Source | SCALAR | String(100) | yes | Inbound, Outbound, Referral, Event / conference, Executive network, Reactivation |
| businessSector | Client Sector | TO_ONE |  |  | → BusinessSector |
| businessSectors | Additional Business Sectors | TO_MANY |  |  | → BusinessSector |
| campaignSource | Campaign Source | SCALAR | String(100) |  |  |
| categories | Additional Categories | TO_MANY |  |  | → Category |
| category | Type | TO_ONE |  |  | → Category |
| certifications | Certification Requirements | TO_MANY |  |  | → Certification |
| clientContact | Primary Contact | TO_ONE |  | yes | → ClientContact |
| clientCorporation | Client Company | TO_ONE |  | yes | → ClientCorporation |
| committed | Pursuit Source | SCALAR | Boolean |  |  |
| correlatedCustomDate1 | correlatedCustomDate1 | SCALAR | Timestamp |  |  |
| correlatedCustomFloat1 | correlatedCustomFloat1 | SCALAR | Double |  |  |
| correlatedCustomFloat2 | correlatedCustomFloat2 | SCALAR | Double |  |  |
| correlatedCustomFloat3 | correlatedCustomFloat3 | SCALAR | Double |  |  |
| correlatedCustomInt1 | correlatedCustomInt1 | SCALAR | Integer |  |  |
| correlatedCustomInt2 | correlatedCustomInt2 | SCALAR | Integer |  |  |
| correlatedCustomInt3 | correlatedCustomInt3 | SCALAR | Integer |  |  |
| correlatedCustomText1 | correlatedCustomText1 | SCALAR | String(100) |  |  |
| correlatedCustomText10 | correlatedCustomText10 | SCALAR | String(100) |  |  |
| correlatedCustomText2 | correlatedCustomText2 | SCALAR | String(100) |  |  |
| correlatedCustomText3 | correlatedCustomText3 | SCALAR | String(100) |  |  |
| correlatedCustomText4 | correlatedCustomText4 | SCALAR | String(100) |  |  |
| correlatedCustomText5 | correlatedCustomText5 | SCALAR | String(100) |  |  |
| correlatedCustomText6 | correlatedCustomText6 | SCALAR | String(100) |  |  |
| correlatedCustomText7 | correlatedCustomText7 | SCALAR | String(100) |  |  |
| correlatedCustomText8 | correlatedCustomText8 | SCALAR | String(100) |  |  |
| correlatedCustomText9 | correlatedCustomText9 | SCALAR | String(100) |  |  |
| correlatedCustomTextBlock1 | correlatedCustomTextBlock1 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock2 | correlatedCustomTextBlock2 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock3 | correlatedCustomTextBlock3 | SCALAR | String(2147483647) |  |  |
| costCenter | Client Cost Center | SCALAR | String(30) |  |  |
| customDate1 | MSA Effective Date | SCALAR | Timestamp |  |  |
| customDate2 | MSA Expiration Date | SCALAR | Timestamp |  |  |
| customDate3 | NDA Signed Date | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customInt1 | Term Length (Months) | SCALAR | Integer |  |  |
| customInt2 | Renewal Notice (Days) | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customText1 | Next Action | SCALAR | String(100) |  |  |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText11 | customText11 | SCALAR | String(100) |  |  |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | Auto-Renewal | SCALAR | String(100) |  | Evergreen, Annual, None |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText3 | Exclusivity | SCALAR | String(100) |  | None, Preferred, Exclusive |
| customText4 | Rate Card Attached | SCALAR | String(100) |  | Yes, No |
| customText5 | Client Signing Authority | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | Key Commercial Terms | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | Negotiation Notes | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| dealValue | Deal Value | SCALAR | BigDecimal | yes |  |
| degreeList | Degree Requirements | SCALAR | String(2147483647) |  |  |
| description | MSA Scope / Notes | SCALAR | String(2147483647) |  |  |
| educationDegree | Education Requirements | SCALAR | String(50) |  |  |
| effectiveDate | Effective Date | SCALAR | Timestamp |  |  |
| estimatedDuration | Estimated Duration | SCALAR | Double |  |  |
| estimatedEndDate | Estimated End | SCALAR | Timestamp |  |  |
| estimatedHoursPerWeek | Estimated Hours Per Week | SCALAR | Double |  |  |
| estimatedStartDate | Estimated Start | SCALAR | Timestamp |  |  |
| expectedBillRate | Expected Bill Rate | SCALAR | BigDecimal |  |  |
| expectedCloseDate | Target Execution Date | SCALAR | Timestamp |  |  |
| expectedFee | Expected Perm Fee % | SCALAR | Double |  |  |
| expectedPayRate | Expected Pay Rate | SCALAR | BigDecimal |  |  |
| externalCategoryID | Public Category | SCALAR | Integer |  |  |
| externalID | External ID | SCALAR | String(100) |  |  |
| fileAttachments | File Attachments | TO_MANY |  |  | → OpportunityFileAttachment |
| history | History | TO_MANY |  |  | → OpportunityHistory |
| hoursOfOperation | Hours of Operation | SCALAR | String(30) |  |  |
| ignoreUntilDate | Ignore Until Date | SCALAR | Timestamp |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isOpen | Is Open | SCALAR | Boolean |  |  |
| jobOrders | Job Orders | TO_MANY |  |  | → JobOrder |
| lead | Originating Lead | TO_ONE |  |  | → Lead |
| markUpPercentage | Mark-up % | SCALAR | Double |  |  |
| notes | Notes | TO_MANY |  |  | → Note |
| numOpenings | # of Openings | SCALAR | Integer |  |  |
| onSite | Location Requirements | SCALAR | String(20) |  |  |
| optionsPackage | Options Package | SCALAR | String(2147483647) |  |  |
| owner | MSA Owner (Internal) | TO_ONE |  | yes | → CorporateUser |
| priority | MSA Priority | SCALAR | Integer |  | High, Medium, Low |
| publicDescription | Published Description | SCALAR | String(2147483647) |  |  |
| publishedZip | Published Zip Code | SCALAR | String(18) |  |  |
| reasonClosed | Close Reason | SCALAR | String(255) |  | Executed and Active, Expired, Declined by Client, Withdrawn by Anura, Superseded, Replaced |
| reportTo | Reporting to (other) | SCALAR | String(100) |  |  |
| reportToClientContact | Client Signer | TO_ONE |  |  | → ClientContact |
| responseUser | Published Contact Info | TO_ONE |  |  | → CorporateUser |
| salary | Expected Salary | SCALAR | BigDecimal |  |  |
| salaryUnit | Pay Rate | SCALAR | String(12) |  |  |
| shift | Shift | TO_ONE |  |  | → Shift |
| skillList | Additional Skills / Keywords | SCALAR | String(2147483647) |  |  |
| skills | Skills | TO_MANY |  |  | → Skill |
| source | Pursuit Source | SCALAR | String(100) |  | Inbound;Outbound;Referral;Event / conference;Executive network;Reactivation |
| specialties | Specialties | TO_MANY |  |  | → Specialty |
| status | Status | SCALAR | String(200) | yes | Identified, Qualifying, Negotiating, Legal Review, Executed, Burner, Closed |
| tasks | Tasks | TO_MANY |  |  | → Task |
| taxRate | Tax % | SCALAR | Double |  |  |
| taxStatus | Tax Preference | SCALAR | String(20) |  |  |
| tearsheets | Tearsheets | TO_MANY |  |  | → Tearsheet |
| title | MSA Name | SCALAR | String(100) | yes |  |
| type | MSA Type | SCALAR | String(200) | yes | New, Amendment, Renewal |
| weightedDealValue | Weighted Deal Value | SCALAR | BigDecimal |  |  |
| willRelocate | Will Relocate? | SCALAR | Boolean |  |  |
| winProbabilityPercent | Probability of Win % | SCALAR | Double |  |  |
| workersCompRate | Workers Comp Code | TO_ONE |  |  | → WorkersCompensationRate |
| yearsRequired | Minimum Experience | SCALAR | Integer |  |  |

## Lead

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| address | Address | COMPOSITE | Address |  |  |
| addressSourceLocation | Address Source Location | TO_ONE |  |  | → Location |
| assignedTo | Assigned To | TO_MANY |  |  | → CorporateUser |
| branch | Branch ID | TO_ONE |  |  | → Branch |
| businessSectors | Industries | TO_MANY |  |  | → BusinessSector |
| campaignSource | Campaign Source | SCALAR | String(100) |  |  |
| candidates | Contact # | TO_MANY |  |  | → Candidate |
| categories | Categories | TO_MANY |  |  | → Category |
| category | Category | TO_ONE |  |  | → Category |
| clientContacts | Associated Contact | TO_MANY |  |  | → ClientContact |
| clientCorporation | Existing Company | TO_ONE |  |  | → ClientCorporation |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| companyName | New Company | SCALAR | String(100) |  |  |
| companyURL | Company URL | SCALAR | String(100) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customObject1s | Custom Object1s | TO_MANY |  |  | → PersonCustomObjectInstance1 |
| customText1 | customText1 | SCALAR | String(100) |  |  |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText11 | customText11 | SCALAR | String(100) |  |  |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | customText2 | SCALAR | String(100) |  |  |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText3 | customText3 | SCALAR | String(100) |  |  |
| customText4 | customText4 | SCALAR | String(100) |  |  |
| customText5 | customText5 | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastComment | Last Note | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| dateLastVisit | Last Visit | SCALAR | Timestamp |  |  |
| description | Professional Overview / Resume | SCALAR | String(2147483647) |  |  |
| division | Division | SCALAR | String(40) |  |  |
| email | Email | SCALAR | String(100) |  |  |
| email2 | Email 2 | SCALAR | String(100) |  |  |
| email3 | Email 3 | SCALAR | String(100) |  |  |
| fax | Fax | SCALAR | String(50) |  |  |
| fax2 | Fax 2 | SCALAR | String(50) |  |  |
| fax3 | Fax 3 | SCALAR | String(50) |  |  |
| firstName | First Name | SCALAR | String(50) | yes |  |
| history | History | TO_MANY |  |  | → LeadHistory |
| isAnonymized | Is Anonymized | SCALAR | Boolean |  |  |
| isDayLightSavings | Is Daylight Savings | SCALAR | Boolean |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isLockedOut | Is Locked Out | SCALAR | Boolean |  |  |
| lastEmailReceivedDate | Last Email Received Date | SCALAR | Date |  |  |
| lastName | Last Name | SCALAR | String(50) | yes |  |
| leadID | Lead ID | SCALAR | Integer |  |  |
| leadSource | Lead Source | SCALAR | String(100) |  | Event, Email, Referral, Reference, Social, Website |
| massMailOptOut | Opted Out | SCALAR | Boolean |  |  |
| masterUserID | Master User ID | SCALAR | Integer |  |  |
| middleName | Middle Name | SCALAR | String(50) |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| mobile | Mobile | SCALAR | String(50) |  |  |
| name | Name | SCALAR | String(100) |  |  |
| namePrefix | Prefix | SCALAR | String(20) |  |  |
| nameSuffix | Suffix | SCALAR | String(5) |  |  |
| nickName | nickName | SCALAR | String(50) |  |  |
| notes | Notes | TO_MANY |  |  | → Note |
| numEmployees | Number of Employees | SCALAR | Integer |  |  |
| occupation | Job Title | SCALAR | String(100) |  |  |
| owner | Owner | TO_ONE |  | yes | → CorporateUser |
| pager | Pager | SCALAR | String(50) |  |  |
| password | Password | SCALAR | String(200) |  |  |
| personSubtype | Person Subtype | SCALAR | String(100) |  |  |
| phone | Phone | SCALAR | String(50) |  |  |
| phone2 | Phone 2 | SCALAR | String(50) |  |  |
| phone3 | Phone 3 | SCALAR | String(50) |  |  |
| preferredContact | Preferred Contact Method | SCALAR | String(15) |  |  |
| primarySkills | Primary Skills | TO_MANY |  |  | → Skill |
| priority | Priority | SCALAR | String(100) |  |  |
| referredByPerson | Referred by | TO_ONE |  |  | → Person |
| reportToPerson | Reports to | TO_ONE |  |  | → Person |
| role | Role | SCALAR | String(255) |  |  |
| salary | Salary | SCALAR | BigDecimal |  |  |
| salaryLow | salaryLow | SCALAR | BigDecimal |  |  |
| secondaryAddress | SecondaryAddress | COMPOSITE | SecondaryAddress |  |  |
| secondarySkills | Secondary Skills | TO_MANY |  |  | → Skill |
| skillSet | Additional Skills | SCALAR | String(2147483647) |  |  |
| smsOptIn | Opted In - SMS Messages | SCALAR | Boolean |  |  |
| source | Conversion Source | SCALAR | String(200) |  |  |
| specialties | Specialties | TO_MANY |  |  | → Specialty |
| status | Status | SCALAR | String(100) | yes | New Lead, Qualifying, Unqualified, No Interest, Non-Responsive, Converted |
| tearsheets | Tearsheets | TO_MANY |  |  | → Tearsheet |
| timeZoneOffsetEST | Time Zone Offset EST | SCALAR | Integer |  |  |
| type | Type | SCALAR | String(30) |  | Direct Buyer, HR, Non-Buyer |
| userDateAdded | User Date Added | SCALAR | Timestamp |  |  |
| userType | User Type | TO_ONE |  |  | → UserType |
| username | Username | SCALAR | String(100) |  |  |
| willRelocate | Willing to Relocate | SCALAR | Boolean |  |  |

## Note

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| action | Action | SCALAR | String(30) | yes | Prescreen, Reference, Outbound Call, Inbound Call, Left Message, Text Conversation, Email, Appointment, Client Visit, Other, LinkedIn Note, LinkedIn InMail |
| bhTimeStamp | Bh Time Stamp | SCALAR | byte[] |  |  |
| candidateCertifications | Candidate Certifications | TO_MANY |  |  | → CandidateCertification |
| candidates | Candidates | TO_MANY |  |  | → Candidate |
| clientContacts | Client Contacts | TO_MANY |  |  | → ClientContact |
| commentingPerson | Author | TO_ONE |  |  | → Person |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| corporateUsers | Corporate Users | TO_MANY |  |  | → CorporateUser |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| entities | Entities | TO_MANY |  |  | → NoteEntity |
| externalID | External ID | SCALAR | String(100) |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| jobOrder | Job Order | TO_ONE |  |  | → JobOrder |
| jobOrders | Job Orders | TO_MANY |  |  | → JobOrder |
| leads | Leads | TO_MANY |  |  | → Lead |
| linkedInID | Linked In ID | SCALAR | String(200) |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| minutesSpent | Time Spent (min) | SCALAR | Integer |  |  |
| opportunities | Opportunities | TO_MANY |  |  | → Opportunity |
| people | People | TO_MANY |  |  | → Person |
| personReference | About | TO_ONE |  |  | → Person |
| placementCertifications | Placement Certifications | TO_MANY |  |  | → PlacementCertification |
| placements | Placements | TO_MANY |  |  | → Placement |
| primaryDepartmentName | Primary Department | SCALAR | String |  |  |
| truestDateAdded | Truest Date Added | SCALAR | Timestamp |  |  |

## NoteEntity — "Note Entity"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| note | Note | TO_ONE |  |  | → Note |
| targetEntityID | Target Entity ID | SCALAR | Integer |  |  |
| targetEntityName | Target Entity Name | SCALAR | String(50) |  |  |

## Task

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| assignees | Assignees | TO_MANY |  |  | → CorporateUser |
| candidate | Candidate | TO_ONE |  |  | → Candidate |
| childTaskOwners | Assigned To | TO_MANY |  |  | → CorporateUser |
| childTasks | Assignments | TO_MANY |  |  | → Task |
| clientContact | Contact | TO_ONE |  |  | → ClientContact |
| clientContactReferences | Client Contact References | TO_MANY |  |  | → ClientContact |
| communicationMethod | Communication Method | SCALAR | String(30) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateBegin | Due Date And Time | SCALAR | Timestamp | yes |  |
| dateCompleted | Date Completed | SCALAR | Timestamp |  |  |
| dateEnd | Date End | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| description | Description | SCALAR | String(2147483647) |  |  |
| editHistory | Edit History | TO_MANY |  |  | → TaskEditHistory |
| isCompleted | Is Completed | SCALAR | Boolean |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isPrivate | Visibility | SCALAR | Boolean | yes | Public, Private |
| isSystemTask | Is System Task | SCALAR | Boolean |  |  |
| isTask | Is Task | SCALAR | Integer |  |  |
| jobOrder | Job | TO_ONE |  |  | → JobOrder |
| jobSubmission | Submission | TO_ONE |  |  | → JobSubmission |
| lead | Lead | TO_ONE |  |  | → Lead |
| location | Location | SCALAR | String(100) |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| notificationMinutes | Reminder | SCALAR | Integer | yes | Never, 5 Min, 10 Min, 15 Min, 30 Min, 1 Hour, 2 Hours, 3 Hours, 4 Hours, 5 Hours, 6 Hours, 7 Hours …(25) |
| opportunity | MSA | TO_ONE |  |  | → Opportunity |
| owner | Owner | TO_ONE |  | yes | → CorporateUser |
| parentTask | Parent Task | TO_ONE |  |  | → Task |
| placement | Placement | TO_ONE |  |  | → Placement |
| priority | Priority | SCALAR | Integer | yes | Low, Normal, High |
| recurrenceDayBits | Recurrence Day Bits | SCALAR | Integer |  |  |
| recurrenceFrequency | Recurrence Frequency | SCALAR | Integer |  |  |
| recurrenceMax | Recurrence Max | SCALAR | Integer |  |  |
| recurrenceMonthBits | Recurrence Month Bits | SCALAR | Integer |  |  |
| recurrenceStyle | Recurrence Style | SCALAR | String(10) |  |  |
| recurrenceType | Recurrence Type | SCALAR | String(1) |  |  |
| secondaryOwners | Secondary Owners | TO_MANY |  |  | → CorporateUser |
| subject | Subject | SCALAR | String(100) | yes |  |
| taskUUID | Task UUID | SCALAR | String(300) |  |  |
| timeZoneID | Time Zone ID | SCALAR | String(50) |  |  |
| type | Type | SCALAR | String(30) | yes | Call, Send Email, Follow-Up Call, Conference Call, Meeting, Send Contract, Send Redlines, Review Account, Billing Review, Renewal Outreach, Personal, Other |

## Appointment

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| appointmentUUID | Appointment UUID | SCALAR | String(300) |  |  |
| candidateReference | Candidate | TO_ONE |  |  | → Candidate |
| childAppointments | Child Appointments | TO_MANY |  |  | → Appointment |
| clientContactReference | Contact | TO_ONE |  |  | → ClientContact |
| communicationMethod | Communication Method | SCALAR | String(30) |  | Phone, Onsite Appointment, Offsite Appointment |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateBegin | Start Date | SCALAR | Timestamp | yes |  |
| dateEnd | End Date | SCALAR | Timestamp | yes |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| description | Description | SCALAR | String(2147483647) |  |  |
| editHistory | Edit History | TO_MANY |  |  | → AppointmentEditHistory |
| guests | Attendees | TO_MANY |  |  | → Person |
| isAllDay | Is All Day | SCALAR | Boolean |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isPrivate | Visibility | SCALAR | Boolean | yes | Public, Private |
| jobOrder | Job | TO_ONE |  |  | → JobOrder |
| jobSubmission | Job Submission | TO_ONE |  |  | → JobSubmission |
| lead | Lead | TO_ONE |  |  | → Lead |
| location | Location | SCALAR | String(100) |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| notificationMinutes | Reminder | SCALAR | Integer | yes | Never, 5 Min, 10 Min, 15 Min, 30 Min, 1 Hour, 2 Hours, 3 Hours, 4 Hours, 5 Hours, 6 Hours, 7 Hours …(25) |
| opportunity | MSA | TO_ONE |  |  | → Opportunity |
| owner | Owner | TO_ONE |  | yes | → Person |
| parentAppointment | Parent Appointment | TO_ONE |  |  | → Appointment |
| placement | Placement | TO_ONE |  |  | → Placement |
| recurrenceDayBits | Recurrence Day Bits | SCALAR | Integer |  |  |
| recurrenceFrequency | Recurrence Frequency | SCALAR | Integer |  |  |
| recurrenceMax | Recurrence Max | SCALAR | Integer |  |  |
| recurrenceMonthBits | Recurrence Month Bits | SCALAR | Integer |  |  |
| recurrenceStyle | Recurrence Style | SCALAR | String(10) |  |  |
| recurrenceType | Recurrence Type | SCALAR | String(1) |  |  |
| showTimeAs | Show Time As | SCALAR | String(15) |  |  |
| subject | Subject | SCALAR | String(100) | yes |  |
| timeZoneID | Time Zone ID | SCALAR | String(50) |  |  |
| type | Type | SCALAR | String(30) | yes | Meeting, Interview, Second Interview, Third Interview, Final Interview, Candidate Screening, Client Visit, Lunch, Dinner, Other |

## AppointmentAttendee — "Appointment Attendee"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| acceptanceStatus | Acceptance Status | SCALAR | Integer |  |  |
| appointment | Appointment | TO_ONE |  |  | → Appointment |
| attendee | Attendee | TO_ONE |  |  | → Person |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |

## Sendout — "Client Submission"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| candidate | Candidate | TO_ONE |  |  | → Candidate |
| clientContact | Contact | TO_ONE |  |  | → ClientContact |
| clientCorporation | Company | TO_ONE |  |  | → ClientCorporation |
| dateAdded | Date Sent | SCALAR | Timestamp |  |  |
| email | Email | SCALAR | String(100) |  |  |
| isRead | Num Times Read | SCALAR | Boolean |  |  |
| jobOrder | Job | TO_ONE |  |  | → JobOrder |
| jobSubmission | Job Submission | TO_ONE |  |  | → JobSubmission |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| numTimesRead | Num Times Read | SCALAR | Integer |  |  |
| user | Sender | TO_ONE |  |  | → CorporateUser |

## Tearsheet

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| candidateCount | Candidate Count | SCALAR | Integer |  |  |
| candidates | Candidates | TO_MANY |  |  | → Candidate |
| clientContactCount | Client Contact Count | SCALAR | Integer |  |  |
| clientContacts | Client Contacts | TO_MANY |  |  | → ClientContact |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| description | Description | SCALAR | String(2147483647) |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isPrivate | Is Private | SCALAR | Boolean |  |  |
| isUserTearsheet | Type | SCALAR | Boolean |  |  |
| jobOrderCount | Job Order Count | SCALAR | Integer |  |  |
| jobOrders | Job Orders | TO_MANY |  |  | → JobOrder |
| leadCount | Lead Count | SCALAR | Integer |  |  |
| leads | Leads | TO_MANY |  |  | → Lead |
| name | Name | SCALAR | String(100) |  |  |
| opportunities | Opportunities | TO_MANY |  |  | → Opportunity |
| opportunityCount | Opportunity Count | SCALAR | Integer |  |  |
| owner | Owner | TO_ONE |  |  | → CorporateUser |
| recipients | Recipients | TO_MANY |  |  | → TearsheetRecipient |
| userCount | User Count | SCALAR | Integer |  |  |
| users | Users | TO_MANY |  |  | → CorporateUser |

## TearsheetMember — "Tearsheet Member"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| person | Person | TO_ONE |  |  | → Person |
| tearsheet | Tearsheet | TO_ONE |  |  | → Tearsheet |

## CorporateUser — "Corporate User"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| address | Address | COMPOSITE | Address |  |  |
| addressSourceLocation | Address Source Location | TO_ONE |  |  | → Location |
| branch | Branch | TO_ONE |  |  | → Branch |
| branches | Branches | TO_MANY |  |  | → Branch |
| companyName | Company Name | SCALAR | String(100) |  |  |
| customDate1 | Custom Date1 | SCALAR | Timestamp |  |  |
| customDate2 | Custom Date2 | SCALAR | Timestamp |  |  |
| customDate3 | Custom Date3 | SCALAR | Timestamp |  |  |
| customFloat1 | Custom Float1 | SCALAR | Double |  |  |
| customFloat2 | Custom Float2 | SCALAR | Double |  |  |
| customFloat3 | Custom Float3 | SCALAR | Double |  |  |
| customInt1 | Custom Int1 | SCALAR | Integer |  |  |
| customInt2 | Custom Int2 | SCALAR | Integer |  |  |
| customInt3 | Custom Int3 | SCALAR | Integer |  |  |
| customText1 | Custom Text1 | SCALAR | String(100) |  |  |
| customText10 | Custom Text10 | SCALAR | String(100) |  |  |
| customText11 | Custom Text11 | SCALAR | String(100) |  |  |
| customText12 | Custom Text12 | SCALAR | String(100) |  |  |
| customText13 | Custom Text13 | SCALAR | String(100) |  |  |
| customText14 | Custom Text14 | SCALAR | String(100) |  |  |
| customText15 | Custom Text15 | SCALAR | String(100) |  |  |
| customText16 | Custom Text16 | SCALAR | String(100) |  |  |
| customText17 | Custom Text17 | SCALAR | String(100) |  |  |
| customText18 | Custom Text18 | SCALAR | String(100) |  |  |
| customText19 | Custom Text19 | SCALAR | String(100) |  |  |
| customText2 | Custom Text2 | SCALAR | String(100) |  |  |
| customText20 | Custom Text20 | SCALAR | String(100) |  |  |
| customText3 | Custom Text3 | SCALAR | String(100) |  |  |
| customText4 | Custom Text4 | SCALAR | String(100) |  |  |
| customText5 | Custom Text5 | SCALAR | String(100) |  |  |
| customText6 | Custom Text6 | SCALAR | String(100) |  |  |
| customText7 | Custom Text7 | SCALAR | String(100) |  |  |
| customText8 | Custom Text8 | SCALAR | String(100) |  |  |
| customText9 | Custom Text9 | SCALAR | String(100) |  |  |
| dateLastComment | Date Last Comment | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| delegations | Delegations | TO_MANY |  |  | → CorporateUser |
| departmentIdList | Department Id List | SCALAR | String(255) |  |  |
| departments | Departments | TO_MANY |  |  | → CorporationDepartment |
| email | Email | SCALAR | String(100) |  |  |
| email2 | Email2 | SCALAR | String(100) |  |  |
| email3 | Email3 | SCALAR | String(100) |  |  |
| emailNotify | Email Notify | SCALAR | Boolean |  |  |
| emailSignature | Email Signature | SCALAR | String(2147483647) |  |  |
| enabled | Enabled | SCALAR | Boolean |  |  |
| externalEmail | External Email | SCALAR | String(60) |  |  |
| fax | Fax | SCALAR | String(50) |  |  |
| fax2 | Fax2 | SCALAR | String(50) |  |  |
| fax3 | Fax3 | SCALAR | String(50) |  |  |
| firstName | First Name | SCALAR | String(50) |  |  |
| inboundEmailEnabled | Inbound Email Enabled | SCALAR | Boolean |  |  |
| isAnonymized | Is Anonymized | SCALAR | Boolean |  |  |
| isDayLightSavings | Is Day Light Savings | SCALAR | Boolean |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isHidden | Is Hidden | SCALAR | Integer |  |  |
| isLockedOut | Is Locked Out | SCALAR | Boolean |  |  |
| isOutboundFaxEnabled | Is Outbound Fax Enabled | SCALAR | Boolean |  |  |
| isPasswordCaseSensitive | Is Password Case Sensitive | SCALAR | Boolean |  |  |
| jobAssignments | Job Assignments | TO_MANY |  |  | → JobOrder |
| lastName | Last Name | SCALAR | String(50) |  |  |
| loginRestrictions | Login Restrictions | SCALAR | LoginRestrictions |  |  |
| massMailOptOut | Mass Mail Opt Out | SCALAR | Boolean |  |  |
| masterUserID | Master User ID | SCALAR | Integer |  |  |
| middleName | Middle Name | SCALAR | String(50) |  |  |
| mobile | Mobile | SCALAR | String(50) |  |  |
| name | Name | SCALAR | String(100) |  |  |
| namePrefix | Name Prefix | SCALAR | String(20) |  |  |
| nameSuffix | Name Suffix | SCALAR | String(5) |  |  |
| nickName | Nick Name | SCALAR | String(50) |  |  |
| occupation | Occupation | SCALAR | String(100) |  |  |
| pager | Pager | SCALAR | String(50) |  |  |
| personSubtype | Person Subtype | SCALAR | String(100) |  |  |
| phone | Phone | SCALAR | String(50) |  |  |
| phone2 | Phone2 | SCALAR | String(50) |  |  |
| phone3 | Phone3 | SCALAR | String(50) |  |  |
| primaryDepartment | Primary Department | TO_ONE |  |  | → CorporationDepartment |
| reportToPerson | Report To Person | TO_ONE |  |  | → Person |
| salesforceUserID | Salesforce User ID | SCALAR | String |  |  |
| smsOptIn | Sms Opt In | SCALAR | Boolean |  |  |
| status | Status | SCALAR | String(100) |  |  |
| taskAssignments | Task Assignments | TO_MANY |  |  | → Task |
| timeZoneOffsetEST | Time Zone Offset EST | SCALAR | Integer |  |  |
| userDateAdded | User Date Added | SCALAR | Timestamp |  |  |
| userType | User Type | TO_ONE |  |  | → UserType |
| username | Username | SCALAR | String(100) |  |  |

## Department

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| description | Description | SCALAR | String(255) |  |  |
| enabled | Enabled | SCALAR | Boolean |  |  |
| name | Name | SCALAR | String(100) |  |  |

## CandidateEducation — "Education"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| candidate | Candidate | TO_ONE |  |  | → Candidate |
| certification | Certification | SCALAR | String(100) |  | CCM, CFA, Chartered Accountant, CMA, CAN, CNE, CPA, Lotus Notes Designer, Lotus Notes System Administrator, MCE, MacPC Windows NT Server, MacPC Windows NT Workstation …(22) |
| city | City | SCALAR | String(40) |  |  |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customDate4 | customDate4 | SCALAR | Timestamp |  |  |
| customDate5 | customDate5 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customFloat4 | customFloat4 | SCALAR | Double |  |  |
| customFloat5 | customFloat5 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customInt4 | customInt4 | SCALAR | Integer |  |  |
| customInt5 | customInt5 | SCALAR | Integer |  |  |
| customText1 | customText1 | SCALAR | String(500) |  |  |
| customText2 | customText2 | SCALAR | String(500) |  |  |
| customText3 | customText3 | SCALAR | String(500) |  |  |
| customText4 | customText4 | SCALAR | String(500) |  |  |
| customText5 | customText5 | SCALAR | String(500) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(255) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(255) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(255) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| degree | Degree | SCALAR | String(100) |  | Associate, BA, BBA, BFA, BS, MA, MBA, MS, MD, Paralegal Certificate, Phd |
| endDate | End Date | SCALAR | Timestamp |  |  |
| expirationDate | Expiration Date | SCALAR | Timestamp |  |  |
| gpa | GPA | SCALAR | Double |  |  |
| graduationDate | Graduation Date | SCALAR | Timestamp |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| major | Major | SCALAR | String(100) |  | Accounting, Finance, Marketing, Business Admin, Liberal Arts, Economics, Math, Computer Science, English, Political Science, Law, Human Resources …(17) |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| school | School | SCALAR | String(100) |  |  |
| startDate | Start Date | SCALAR | Timestamp |  |  |
| state | State | SCALAR | String(50) |  |  |

## CandidateWorkHistory — "Work History"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| bonus | Bonus | SCALAR | Double |  |  |
| candidate | Candidate | TO_ONE |  |  | → Candidate |
| clientCorporation | Client Corporation | TO_ONE |  |  | → ClientCorporation |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| commission | Commission | SCALAR | Double |  |  |
| companyName | Company Name | SCALAR | String(100) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customDate4 | customDate4 | SCALAR | Timestamp |  |  |
| customDate5 | customDate5 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customFloat4 | customFloat4 | SCALAR | Double |  |  |
| customFloat5 | customFloat5 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customInt4 | customInt4 | SCALAR | Integer |  |  |
| customInt5 | customInt5 | SCALAR | Integer |  |  |
| customText1 | customText1 | SCALAR | String(500) |  |  |
| customText2 | customText2 | SCALAR | String(500) |  |  |
| customText3 | customText3 | SCALAR | String(500) |  |  |
| customText4 | customText4 | SCALAR | String(500) |  |  |
| customText5 | customText5 | SCALAR | String(500) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| endDate | End Date | SCALAR | Timestamp |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isLastJob | Is Last Job | SCALAR | Boolean |  |  |
| jobOrder | Job Posting | TO_ONE |  |  | → JobOrder |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| placement | Placement | TO_ONE |  |  | → Placement |
| salary1 | Salary | SCALAR | BigDecimal |  |  |
| salary2 | Salary High | SCALAR | BigDecimal |  |  |
| salaryType | Salary Type | SCALAR | String(20) |  |  |
| startDate | Start Date | SCALAR | Timestamp |  |  |
| terminationReason | Termination Reason | SCALAR | String(100) |  |  |
| title | Job Title | SCALAR | String(100) |  |  |

## CandidateReference — "Reference"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| candidate | Candidate | TO_ONE |  |  | → Candidate |
| candidateTitle | Candidate Job Title | SCALAR | String(50) |  |  |
| clientCorporation | Client Corporation | TO_ONE |  |  | → ClientCorporation |
| companyName | Company | SCALAR | String(50) |  |  |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customDate4 | customDate4 | SCALAR | Timestamp |  |  |
| customDate5 | customDate5 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customFloat4 | customFloat4 | SCALAR | Double |  |  |
| customFloat5 | customFloat5 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customInt4 | customInt4 | SCALAR | Integer |  |  |
| customInt5 | customInt5 | SCALAR | Integer |  |  |
| customMigrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| customText1 | customText1 | SCALAR | String(500) |  |  |
| customText2 | customText2 | SCALAR | String(500) |  |  |
| customText3 | customText3 | SCALAR | String(500) |  |  |
| customText4 | customText4 | SCALAR | String(500) |  |  |
| customText5 | customText5 | SCALAR | String(500) |  |  |
| customTextBlock1 | Reference Details | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| employmentEnd | Employment End | SCALAR | Timestamp |  |  |
| employmentStart | Employment Start | SCALAR | Timestamp |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| jobOrder | Job Posting | TO_ONE |  |  | → JobOrder |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| referenceClientContact | Reference | TO_ONE |  |  | → ClientContact |
| referenceEmail | Reference Email | SCALAR | String(50) |  |  |
| referenceFirstName | Reference First Name | SCALAR | String(50) |  |  |
| referenceLastName | Reference Last Name | SCALAR | String(50) |  |  |
| referencePhone | Reference Phone | SCALAR | String(20) |  |  |
| referenceTitle | Reference Job Title | SCALAR | String(50) |  |  |
| responses | Responses | TO_MANY |  |  | → CandidateReferenceResponse |
| status | Status | SCALAR | String(20) |  | Pending, In Progress, Completed, Declined, Canceled |
| yearsKnown | Years Known | SCALAR | Integer |  |  |

## CandidateCertification — "Candidate Certification"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| boardCertification | Board Certification | SCALAR | String(100) |  | NA, Board Certified, Board Elligible |
| candidate | Candidate | TO_ONE |  |  | → Candidate |
| certification | Requirement Type | TO_ONE |  | yes | → Certification |
| certificationFileAttachments | Certification File Attachments | TO_MANY |  |  | → CertificationFileAttachment |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| compact | Compact | SCALAR | Integer |  | Not Applicable, Yes, No |
| copyOnFile | On File | SCALAR | Integer |  | Not Applicable, Yes, No |
| customDate1 | CustomDate1 | SCALAR | Timestamp |  |  |
| customDate10 | CustomDate10 | SCALAR | Timestamp |  |  |
| customDate2 | CustomDate2 | SCALAR | Timestamp |  |  |
| customDate3 | CustomDate3 | SCALAR | Timestamp |  |  |
| customDate4 | CustomDate4 | SCALAR | Timestamp |  |  |
| customDate5 | CustomDate5 | SCALAR | Timestamp |  |  |
| customDate6 | CustomDate6 | SCALAR | Timestamp |  |  |
| customDate7 | CustomDate7 | SCALAR | Timestamp |  |  |
| customDate8 | CustomDate8 | SCALAR | Timestamp |  |  |
| customDate9 | CustomDate9 | SCALAR | Timestamp |  |  |
| customText1 | CustomText1 | SCALAR | String(100) |  |  |
| customText10 | CustomText10 | SCALAR | String(100) |  |  |
| customText2 | CustomText2 | SCALAR | String(100) |  |  |
| customText3 | CustomText3 | SCALAR | String(100) |  |  |
| customText4 | CustomText4 | SCALAR | String(100) |  |  |
| customText5 | CustomText5 | SCALAR | String(100) |  |  |
| customText6 | CustomText6 | SCALAR | String(100) |  |  |
| customText7 | CustomText7 | SCALAR | String(100) |  |  |
| customText8 | CustomText8 | SCALAR | String(100) |  |  |
| customText9 | CustomText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | CustomTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock10 | CustomBlockText10 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | CustomBlockText2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | CustomBlockText3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | CustomBlockText4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | CustomBlockText5 | SCALAR | String(2147483647) |  |  |
| customTextBlock6 | CustomBlockText6 | SCALAR | String(2147483647) |  |  |
| customTextBlock7 | CustomBlockText7 | SCALAR | String(2147483647) |  |  |
| customTextBlock8 | CustomBlockText8 | SCALAR | String(2147483647) |  |  |
| customTextBlock9 | CustomBlockText9 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp | yes |  |
| dateCertified | Date Certified | SCALAR | Timestamp |  |  |
| dateExpiration | Expiration Date | SCALAR | Timestamp | yes |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| displayStatus | Display Status | SCALAR | String(30) |  |  |
| expirationReminderDate | Expiration Reminder Date | SCALAR | Timestamp |  |  |
| fileAttachments | File Attachments | TO_MANY |  |  | → CandidateFileAttachment |
| isComplete | Is Complete | SCALAR | Boolean |  |  |
| isDeleted | isDeleted | SCALAR | Boolean |  |  |
| issuedBy | Issuing Authority | SCALAR | String(100) |  | NA, American Heart Association |
| licenseNumber | License Number | SCALAR | String(100) |  |  |
| licenseType | License Type | SCALAR | String(30) |  | Not Applicable, Permanent, Temporary |
| location | Locations | SCALAR | String(100) |  | optionsType NorthAmericaState |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| modifyingUser | Modifying User | TO_ONE |  |  | → CorporateUser |
| name | Credential | SCALAR | String(100) | yes |  |
| notes | Notes | TO_MANY |  |  | → Note |
| results | Results | SCALAR | String(255) |  |  |
| status | Status | SCALAR | String(30) | yes | Current, Expired, Unknown |

## Certification — "Credential"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| categories | Categories | TO_MANY |  |  | → Category |
| category | CategoryID | TO_ONE |  |  | → Category |
| certificationGroups | Certification Groups | TO_MANY |  |  | → CertificationGroup |
| code | Code | SCALAR | String(100) |  |  |
| countryID | Country | TO_ONE |  |  | → Country |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customText1 | customText1 | SCALAR | String(100) |  |  |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText2 | customText2 | SCALAR | String(100) |  |  |
| customText3 | customText3 | SCALAR | String(100) |  |  |
| customText4 | customText4 | SCALAR | String(100) |  |  |
| customText5 | customText5 | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | customTextBlock4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | customTextBlock5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp | yes |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp | yes |  |
| defaultExpirationReminderDays | Default Expiration Reminder Days | SCALAR | Integer |  |  |
| description | Description | SCALAR | String(2147483647) |  |  |
| equivalents | Equivalent Certifications | TO_MANY |  |  | → Certification |
| expirationDateOptional | Expiration Date - Optional | SCALAR | Boolean |  | Yes, No |
| fileType | File Type | SCALAR | String(100) |  |  |
| hasLicenseNumber | Has License Number | SCALAR | Boolean |  | Yes, No |
| isAbstract | Is Abstract | SCALAR | Boolean |  | Yes, No |
| isStateRequired | State Required | SCALAR | Boolean |  | Yes, No |
| isStateSpecific | State Specific | SCALAR | Boolean |  | Yes, No |
| isTransferable | Transferable | SCALAR | Boolean |  | Yes, No |
| isTwoSided | Two Sided | SCALAR | Boolean |  | Yes, No |
| licenseNumberRequired | License Number Required | SCALAR | Boolean |  | Yes, No |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| name | Name | SCALAR | String(100) |  |  |
| numSupplementalsRequired | # of Supplementals Required | SCALAR | Integer |  |  |
| requiresFileAttachment | Requires File Attachment | SCALAR | Boolean |  | Yes, No |
| skills | Skills | TO_MANY |  |  | → Skill |
| specialties | Specialties | TO_MANY |  |  | → Specialty |
| specialty | SpecialtyID | TO_ONE |  |  | → Specialty |
| state | State | SCALAR | String(100) |  | optionsType NorthAmericaState |
| supplementals | Supplemental Certifications | TO_MANY |  |  | → Certification |
| type | Type | SCALAR | String(100) |  |  |

## Skill

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| categories | Categories | TO_MANY |  |  | → Category |
| enabled | Enabled | SCALAR | Boolean |  |  |
| name | Name | SCALAR | String(100) |  |  |

## Category

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| description | Description | SCALAR | String(255) |  |  |
| enabled | Enabled | SCALAR | Boolean |  |  |
| externalID | External ID | SCALAR | Integer |  |  |
| name | Name | SCALAR | String(100) |  |  |
| occupation | Occupation | SCALAR | String(50) |  |  |
| skills | Skills | TO_MANY |  |  | → Skill |
| specialties | Specialties | TO_MANY |  |  | → Specialty |
| type | Type | SCALAR | String(20) |  |  |

## Specialty

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| enabled | Enabled | SCALAR | Boolean |  |  |
| name | Name | SCALAR | String(100) |  |  |
| parentCategory | Parent Category | TO_ONE |  |  | → Category |

## BusinessSector — "Business Sector"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| name | Name | SCALAR | String(100) |  |  |
| nestLevel | Nest Level | SCALAR | Integer |  |  |
| parentBusinessSectorID | Parent Business Sector ID | SCALAR | Integer |  |  |

## Country

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| code | Code | SCALAR | String(4) |  |  |
| isoCode | Iso Code | SCALAR | String(20) |  |  |
| name | Name | SCALAR | String(64) |  |  |
| states | States | TO_MANY |  |  | → State |

## State

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| code | Code | SCALAR | String(50) |  |  |
| country | Country | TO_ONE |  |  | → Country |
| importTaxes | Import Taxes | SCALAR | Boolean |  |  |
| isoCode | Iso Code | SCALAR | String(20) |  |  |
| name | Name | SCALAR | String(255) |  |  |

## ClientCorporationCustomObjectInstance1 — "Client Corporation Custom Object Instance1"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| clientCorporation | Client Corporation | TO_ONE |  |  | → ClientCorporation |
| date1 | Date1 | SCALAR | Timestamp |  |  |
| date10 | Date10 | SCALAR | Timestamp |  |  |
| date2 | Date2 | SCALAR | Timestamp |  |  |
| date3 | Date3 | SCALAR | Timestamp |  |  |
| date4 | Date4 | SCALAR | Timestamp |  |  |
| date5 | Date5 | SCALAR | Timestamp |  |  |
| date6 | Date6 | SCALAR | Timestamp |  |  |
| date7 | Date7 | SCALAR | Timestamp |  |  |
| date8 | Date8 | SCALAR | Timestamp |  |  |
| date9 | Date9 | SCALAR | Timestamp |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| float1 | Float1 | SCALAR | Double |  |  |
| float10 | Float10 | SCALAR | Double |  |  |
| float2 | Float2 | SCALAR | Double |  |  |
| float3 | Float3 | SCALAR | Double |  |  |
| float4 | Float4 | SCALAR | Double |  |  |
| float5 | Float5 | SCALAR | Double |  |  |
| float6 | Float6 | SCALAR | Double |  |  |
| float7 | Float7 | SCALAR | Double |  |  |
| float8 | Float8 | SCALAR | Double |  |  |
| float9 | Float9 | SCALAR | Double |  |  |
| int1 | Int1 | SCALAR | Integer |  |  |
| int10 | Int10 | SCALAR | Integer |  |  |
| int2 | Int2 | SCALAR | Integer |  |  |
| int3 | Int3 | SCALAR | Integer |  |  |
| int4 | Int4 | SCALAR | Integer |  |  |
| int5 | Int5 | SCALAR | Integer |  |  |
| int6 | Int6 | SCALAR | Integer |  |  |
| int7 | Int7 | SCALAR | Integer |  |  |
| int8 | Int8 | SCALAR | Integer |  |  |
| int9 | Int9 | SCALAR | Integer |  |  |
| text1 | Text1 | SCALAR | String(100) |  |  |
| text10 | Text10 | SCALAR | String(100) |  |  |
| text11 | Text11 | SCALAR | String(100) |  |  |
| text12 | Text12 | SCALAR | String(100) |  |  |
| text13 | Text13 | SCALAR | String(100) |  |  |
| text14 | Text14 | SCALAR | String(100) |  |  |
| text15 | Text15 | SCALAR | String(100) |  |  |
| text16 | Text16 | SCALAR | String(100) |  |  |
| text17 | Text17 | SCALAR | String(100) |  |  |
| text18 | Text18 | SCALAR | String(100) |  |  |
| text19 | Text19 | SCALAR | String(100) |  |  |
| text2 | Text2 | SCALAR | String(100) |  |  |
| text20 | Text20 | SCALAR | String(100) |  |  |
| text3 | Text3 | SCALAR | String(100) |  |  |
| text4 | Text4 | SCALAR | String(100) |  |  |
| text5 | Text5 | SCALAR | String(100) |  |  |
| text6 | Text6 | SCALAR | String(100) |  |  |
| text7 | Text7 | SCALAR | String(100) |  |  |
| text8 | Text8 | SCALAR | String(100) |  |  |
| text9 | Text9 | SCALAR | String(100) |  |  |
| textBlock1 | Text Block1 | SCALAR | String(2147483647) |  |  |
| textBlock2 | Text Block2 | SCALAR | String(2147483647) |  |  |
| textBlock3 | Text Block3 | SCALAR | String(2147483647) |  |  |
| textBlock4 | Text Block4 | SCALAR | String(2147483647) |  |  |
| textBlock5 | Text Block5 | SCALAR | String(2147483647) |  |  |

## JobOrderCustomObjectInstance1 — "Job Order Custom Object Instance1"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| date1 | Date1 | SCALAR | Timestamp |  |  |
| date10 | Date10 | SCALAR | Timestamp |  |  |
| date2 | Date2 | SCALAR | Timestamp |  |  |
| date3 | Date3 | SCALAR | Timestamp |  |  |
| date4 | Date4 | SCALAR | Timestamp |  |  |
| date5 | Date5 | SCALAR | Timestamp |  |  |
| date6 | Date6 | SCALAR | Timestamp |  |  |
| date7 | Date7 | SCALAR | Timestamp |  |  |
| date8 | Date8 | SCALAR | Timestamp |  |  |
| date9 | Date9 | SCALAR | Timestamp |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| float1 | Float1 | SCALAR | Double |  |  |
| float10 | Float10 | SCALAR | Double |  |  |
| float2 | Float2 | SCALAR | Double |  |  |
| float3 | Float3 | SCALAR | Double |  |  |
| float4 | Float4 | SCALAR | Double |  |  |
| float5 | Float5 | SCALAR | Double |  |  |
| float6 | Float6 | SCALAR | Double |  |  |
| float7 | Float7 | SCALAR | Double |  |  |
| float8 | Float8 | SCALAR | Double |  |  |
| float9 | Float9 | SCALAR | Double |  |  |
| int1 | Int1 | SCALAR | Integer |  |  |
| int10 | Int10 | SCALAR | Integer |  |  |
| int2 | Int2 | SCALAR | Integer |  |  |
| int3 | Int3 | SCALAR | Integer |  |  |
| int4 | Int4 | SCALAR | Integer |  |  |
| int5 | Int5 | SCALAR | Integer |  |  |
| int6 | Int6 | SCALAR | Integer |  |  |
| int7 | Int7 | SCALAR | Integer |  |  |
| int8 | Int8 | SCALAR | Integer |  |  |
| int9 | Int9 | SCALAR | Integer |  |  |
| jobOrder | Job Order | TO_ONE |  |  | → JobOrder |
| text1 | Text1 | SCALAR | String(100) |  |  |
| text10 | Text10 | SCALAR | String(100) |  |  |
| text11 | Text11 | SCALAR | String(100) |  |  |
| text12 | Text12 | SCALAR | String(100) |  |  |
| text13 | Text13 | SCALAR | String(100) |  |  |
| text14 | Text14 | SCALAR | String(100) |  |  |
| text15 | Text15 | SCALAR | String(100) |  |  |
| text16 | Text16 | SCALAR | String(100) |  |  |
| text17 | Text17 | SCALAR | String(100) |  |  |
| text18 | Text18 | SCALAR | String(100) |  |  |
| text19 | Text19 | SCALAR | String(100) |  |  |
| text2 | Text2 | SCALAR | String(100) |  |  |
| text20 | Text20 | SCALAR | String(100) |  |  |
| text3 | Text3 | SCALAR | String(100) |  |  |
| text4 | Text4 | SCALAR | String(100) |  |  |
| text5 | Text5 | SCALAR | String(100) |  |  |
| text6 | Text6 | SCALAR | String(100) |  |  |
| text7 | Text7 | SCALAR | String(100) |  |  |
| text8 | Text8 | SCALAR | String(100) |  |  |
| text9 | Text9 | SCALAR | String(100) |  |  |
| textBlock1 | Text Block1 | SCALAR | String(2147483647) |  |  |
| textBlock2 | Text Block2 | SCALAR | String(2147483647) |  |  |
| textBlock3 | Text Block3 | SCALAR | String(2147483647) |  |  |
| textBlock4 | Text Block4 | SCALAR | String(2147483647) |  |  |
| textBlock5 | Text Block5 | SCALAR | String(2147483647) |  |  |

## PlacementCustomObjectInstance1 — "Placement Custom Object Instance1"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| date1 | Date1 | SCALAR | Timestamp |  |  |
| date10 | Date10 | SCALAR | Timestamp |  |  |
| date2 | Date2 | SCALAR | Timestamp |  |  |
| date3 | Date3 | SCALAR | Timestamp |  |  |
| date4 | Date4 | SCALAR | Timestamp |  |  |
| date5 | Date5 | SCALAR | Timestamp |  |  |
| date6 | Date6 | SCALAR | Timestamp |  |  |
| date7 | Date7 | SCALAR | Timestamp |  |  |
| date8 | Date8 | SCALAR | Timestamp |  |  |
| date9 | Date9 | SCALAR | Timestamp |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| float1 | Float1 | SCALAR | Double |  |  |
| float10 | Float10 | SCALAR | Double |  |  |
| float2 | Float2 | SCALAR | Double |  |  |
| float3 | Float3 | SCALAR | Double |  |  |
| float4 | Float4 | SCALAR | Double |  |  |
| float5 | Float5 | SCALAR | Double |  |  |
| float6 | Float6 | SCALAR | Double |  |  |
| float7 | Float7 | SCALAR | Double |  |  |
| float8 | Float8 | SCALAR | Double |  |  |
| float9 | Float9 | SCALAR | Double |  |  |
| int1 | Int1 | SCALAR | Integer |  |  |
| int10 | Int10 | SCALAR | Integer |  |  |
| int2 | Int2 | SCALAR | Integer |  |  |
| int3 | Int3 | SCALAR | Integer |  |  |
| int4 | Int4 | SCALAR | Integer |  |  |
| int5 | Int5 | SCALAR | Integer |  |  |
| int6 | Int6 | SCALAR | Integer |  |  |
| int7 | Int7 | SCALAR | Integer |  |  |
| int8 | Int8 | SCALAR | Integer |  |  |
| int9 | Int9 | SCALAR | Integer |  |  |
| placement | Placement | TO_ONE |  |  | → Placement |
| text1 | Text1 | SCALAR | String(100) |  |  |
| text10 | Text10 | SCALAR | String(100) |  |  |
| text11 | Text11 | SCALAR | String(100) |  |  |
| text12 | Text12 | SCALAR | String(100) |  |  |
| text13 | Text13 | SCALAR | String(100) |  |  |
| text14 | Text14 | SCALAR | String(100) |  |  |
| text15 | Text15 | SCALAR | String(100) |  |  |
| text16 | Text16 | SCALAR | String(100) |  |  |
| text17 | Text17 | SCALAR | String(100) |  |  |
| text18 | Text18 | SCALAR | String(100) |  |  |
| text19 | Text19 | SCALAR | String(100) |  |  |
| text2 | Text2 | SCALAR | String(100) |  |  |
| text20 | Text20 | SCALAR | String(100) |  |  |
| text3 | Text3 | SCALAR | String(100) |  |  |
| text4 | Text4 | SCALAR | String(100) |  |  |
| text5 | Text5 | SCALAR | String(100) |  |  |
| text6 | Text6 | SCALAR | String(100) |  |  |
| text7 | Text7 | SCALAR | String(100) |  |  |
| text8 | Text8 | SCALAR | String(100) |  |  |
| text9 | Text9 | SCALAR | String(100) |  |  |
| textBlock1 | Text Block1 | SCALAR | String(2147483647) |  |  |
| textBlock2 | Text Block2 | SCALAR | String(2147483647) |  |  |
| textBlock3 | Text Block3 | SCALAR | String(2147483647) |  |  |
| textBlock4 | Text Block4 | SCALAR | String(2147483647) |  |  |
| textBlock5 | Text Block5 | SCALAR | String(2147483647) |  |  |

## WorkersCompensationRate — "Workers Compensation Rate"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| compensation | Compensation | TO_ONE |  |  | → WorkersCompensation |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| endDate | End Date | SCALAR | Timestamp |  |  |
| rate | Rate | SCALAR | Double |  |  |
| startDate | Start Date | SCALAR | Timestamp |  |  |

## HousingComplex — "Housing Complex"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| address | Address | COMPOSITE | Address |  |  |
| amenities | Amenities | TO_MANY |  |  | → HousingComplexAmenity |
| billingContactID | Billing Contact | SCALAR | Integer |  | optionsType Client |
| comments | Comments | SCALAR | String(2147483647) |  |  |
| complexManagerID | Complex Manager | SCALAR | Integer |  | optionsType Client |
| complexOwnerID | Complex Owner | SCALAR | Integer |  | optionsType Client |
| contactName | Primary Contact | SCALAR | String(100) |  |  |
| customContactID1 | customContactID1 | SCALAR | Integer |  | optionsType Client |
| customContactID2 | customContactID2 | SCALAR | Integer |  | optionsType Client |
| customContactID3 | customContactID3 | SCALAR | Integer |  | optionsType Client |
| customDate1 | Custom Date 1 | SCALAR | Timestamp |  |  |
| customDate2 | Custom Date 2 | SCALAR | Timestamp |  |  |
| customDate3 | Custom Date 3 | SCALAR | Timestamp |  |  |
| customFloat1 | Custom Float 1 | SCALAR | Double |  |  |
| customFloat2 | Custom Float 2 | SCALAR | Double |  |  |
| customFloat3 | Custom Float 3 | SCALAR | Double |  |  |
| customInt1 | Custom Int 1 | SCALAR | Integer |  |  |
| customInt2 | Custom Int 2 | SCALAR | Integer |  |  |
| customInt3 | Custom Int 3 | SCALAR | Integer |  |  |
| customText1 | Custom Text 1 | SCALAR | String(100) |  |  |
| customText10 | Custom Text 10 | SCALAR | String(100) |  |  |
| customText11 | Custom Text 11 | SCALAR | String(100) |  |  |
| customText12 | Custom Text 12 | SCALAR | String(100) |  |  |
| customText13 | Custom Text 13 | SCALAR | String(100) |  |  |
| customText14 | Custom Text 14 | SCALAR | String(100) |  |  |
| customText15 | Custom Text 15 | SCALAR | String(100) |  |  |
| customText16 | Custom Text 16 | SCALAR | String(100) |  |  |
| customText17 | Custom Text 17 | SCALAR | String(100) |  |  |
| customText18 | Custom Text 18 | SCALAR | String(100) |  |  |
| customText19 | Custom Text 19 | SCALAR | String(100) |  |  |
| customText2 | Custom Text 2 | SCALAR | String(100) |  |  |
| customText20 | Custom Text 20 | SCALAR | String(100) |  |  |
| customText3 | Custom Test 3 | SCALAR | String(100) |  |  |
| customText4 | Custom Text 4 | SCALAR | String(100) |  |  |
| customText5 | Custom Text 5 | SCALAR | String(100) |  |  |
| customText6 | Custom Text 6 | SCALAR | String(100) |  |  |
| customText7 | Custom Text 7 | SCALAR | String(100) |  |  |
| customText8 | Custom Text 8 | SCALAR | String(100) |  |  |
| customText9 | Custom Text 9 | SCALAR | String(100) |  |  |
| customTextBlock1 | Custom Text Block 1 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | Custom Text Block 2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | Custom Text Block 3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | Custom Text Block 4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | Custom Text Block 5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| fax | Fax | SCALAR | String(20) |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| migrateGUID | Migrated GUID | SCALAR | String(36) |  |  |
| name | Name | SCALAR | String(100) | yes |  |
| owner | Owner | TO_ONE |  | yes | → CorporateUser |
| phone | Phone | SCALAR | String(20) |  |  |
| units | Housing Complex Units | TO_MANY |  |  | → HousingComplexUnit |
| whitelistClientCorporations | Whitelisted Client Corporations | TO_MANY |  |  | → ClientCorporation |
| zipCodeGis | Zip Code GIS | TO_ONE |  |  | → ZipCodeGis |

## JobBoardPost — "Job Board Post"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| address | Address | COMPOSITE | Address |  |  |
| appointments | Appointments | TO_MANY |  |  | → Appointment |
| approvedPlacements | Approved Placements | TO_MANY |  |  | → Placement |
| assignedUsers | Assigned Users | TO_MANY |  |  | → CorporateUser |
| benefits | Benefits | SCALAR | String(2147483647) |  |  |
| bhTimestamp | Bh Timestamp | SCALAR | byte[] |  |  |
| billRateCategoryID | Bill Rate Category ID | SCALAR | Integer |  |  |
| bonusPackage | Bonus Package | SCALAR | String(2147483647) |  |  |
| branch | Branch | TO_ONE |  |  | → Branch |
| branchCode | Branch Code | SCALAR | String(100) |  |  |
| businessSectors | Business Sectors | TO_MANY |  |  | → BusinessSector |
| categories | Categories | TO_MANY |  |  | → Category |
| certificationGroups | Certification Groups | TO_MANY |  |  | → CertificationGroup |
| certificationList | Certification List | SCALAR | String(255) |  |  |
| certifications | Certifications | TO_MANY |  |  | → Certification |
| clientBillRate | Client Bill Rate | SCALAR | BigDecimal |  |  |
| clientContact | Client Contact | TO_ONE |  |  | → ClientContact |
| clientCorporation | Client Corporation | TO_ONE |  |  | → ClientCorporation |
| companyDescription | Company Description | SCALAR | String(2147483647) |  |  |
| correlatedCustomDate1 | Correlated Custom Date1 | SCALAR | Timestamp |  |  |
| correlatedCustomDate2 | Correlated Custom Date2 | SCALAR | Timestamp |  |  |
| correlatedCustomDate3 | Correlated Custom Date3 | SCALAR | Timestamp |  |  |
| correlatedCustomFloat1 | Correlated Custom Float1 | SCALAR | Double |  |  |
| correlatedCustomFloat2 | Correlated Custom Float2 | SCALAR | Double |  |  |
| correlatedCustomFloat3 | Correlated Custom Float3 | SCALAR | Double |  |  |
| correlatedCustomInt1 | Correlated Custom Int1 | SCALAR | Integer |  |  |
| correlatedCustomInt2 | Correlated Custom Int2 | SCALAR | Integer |  |  |
| correlatedCustomInt3 | Correlated Custom Int3 | SCALAR | Integer |  |  |
| correlatedCustomText1 | Correlated Custom Text1 | SCALAR | String(100) |  |  |
| correlatedCustomText10 | Correlated Custom Text10 | SCALAR | String(100) |  |  |
| correlatedCustomText2 | Correlated Custom Text2 | SCALAR | String(100) |  |  |
| correlatedCustomText3 | Correlated Custom Text3 | SCALAR | String(100) |  |  |
| correlatedCustomText4 | Correlated Custom Text4 | SCALAR | String(100) |  |  |
| correlatedCustomText5 | Correlated Custom Text5 | SCALAR | String(100) |  |  |
| correlatedCustomText6 | Correlated Custom Text6 | SCALAR | String(100) |  |  |
| correlatedCustomText7 | Correlated Custom Text7 | SCALAR | String(100) |  |  |
| correlatedCustomText8 | Correlated Custom Text8 | SCALAR | String(100) |  |  |
| correlatedCustomText9 | Correlated Custom Text9 | SCALAR | String(100) |  |  |
| correlatedCustomTextBlock1 | Correlated Custom Text Block1 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock2 | Correlated Custom Text Block2 | SCALAR | String(2147483647) |  |  |
| correlatedCustomTextBlock3 | Correlated Custom Text Block3 | SCALAR | String(2147483647) |  |  |
| costCenter | Cost Center | SCALAR | String(30) |  |  |
| customDate1 | Custom Date1 | SCALAR | Timestamp |  |  |
| customDate2 | Custom Date2 | SCALAR | Timestamp |  |  |
| customDate3 | Custom Date3 | SCALAR | Timestamp |  |  |
| customFloat1 | Custom Float1 | SCALAR | Double |  |  |
| customFloat2 | Custom Float2 | SCALAR | Double |  |  |
| customFloat3 | Custom Float3 | SCALAR | Double |  |  |
| customInt1 | Custom Int1 | SCALAR | Integer |  |  |
| customInt2 | Custom Int2 | SCALAR | Integer |  |  |
| customInt3 | Custom Int3 | SCALAR | Integer |  |  |
| customInt4 | Custom Int4 | SCALAR | Integer |  |  |
| customInt5 | Custom Int5 | SCALAR | Integer |  |  |
| customInt6 | Custom Int6 | SCALAR | Integer |  |  |
| customInt7 | Custom Int7 | SCALAR | Integer |  |  |
| customInt8 | Custom Int8 | SCALAR | Integer |  |  |
| customText1 | Custom Text1 | SCALAR | String(100) |  |  |
| customText10 | Custom Text10 | SCALAR | String(100) |  |  |
| customText11 | Custom Text11 | SCALAR | String(100) |  |  |
| customText12 | Custom Text12 | SCALAR | String(100) |  |  |
| customText13 | Custom Text13 | SCALAR | String(100) |  |  |
| customText14 | Custom Text14 | SCALAR | String(100) |  |  |
| customText15 | Custom Text15 | SCALAR | String(100) |  |  |
| customText16 | Custom Text16 | SCALAR | String(100) |  |  |
| customText17 | Custom Text17 | SCALAR | String(100) |  |  |
| customText18 | Custom Text18 | SCALAR | String(100) |  |  |
| customText19 | Custom Text19 | SCALAR | String(100) |  |  |
| customText2 | Custom Text2 | SCALAR | String(100) |  |  |
| customText20 | Custom Text20 | SCALAR | String(100) |  |  |
| customText21 | Custom Text21 | SCALAR | String(100) |  |  |
| customText22 | Custom Text22 | SCALAR | String(100) |  |  |
| customText23 | Custom Text23 | SCALAR | String(100) |  |  |
| customText24 | Custom Text24 | SCALAR | String(100) |  |  |
| customText25 | Custom Text25 | SCALAR | String(100) |  |  |
| customText26 | Custom Text26 | SCALAR | String(100) |  |  |
| customText27 | Custom Text27 | SCALAR | String(100) |  |  |
| customText28 | Custom Text28 | SCALAR | String(100) |  |  |
| customText29 | Custom Text29 | SCALAR | String(100) |  |  |
| customText3 | Custom Text3 | SCALAR | String(100) |  |  |
| customText30 | Custom Text30 | SCALAR | String(100) |  |  |
| customText31 | Custom Text31 | SCALAR | String(100) |  |  |
| customText32 | Custom Text32 | SCALAR | String(100) |  |  |
| customText33 | Custom Text33 | SCALAR | String(100) |  |  |
| customText34 | Custom Text34 | SCALAR | String(100) |  |  |
| customText35 | Custom Text35 | SCALAR | String(100) |  |  |
| customText36 | Custom Text36 | SCALAR | String(100) |  |  |
| customText37 | Custom Text37 | SCALAR | String(100) |  |  |
| customText38 | Custom Text38 | SCALAR | String(100) |  |  |
| customText39 | Custom Text39 | SCALAR | String(100) |  |  |
| customText4 | Custom Text4 | SCALAR | String(100) |  |  |
| customText40 | Custom Text40 | SCALAR | String(100) |  |  |
| customText5 | Custom Text5 | SCALAR | String(100) |  |  |
| customText6 | Custom Text6 | SCALAR | String(100) |  |  |
| customText7 | Custom Text7 | SCALAR | String(100) |  |  |
| customText8 | Custom Text8 | SCALAR | String(100) |  |  |
| customText9 | Custom Text9 | SCALAR | String(100) |  |  |
| customTextBlock1 | Custom Text Block1 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | Custom Text Block2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | Custom Text Block3 | SCALAR | String(2147483647) |  |  |
| customTextBlock4 | Custom Text Block4 | SCALAR | String(2147483647) |  |  |
| customTextBlock5 | Custom Text Block5 | SCALAR | String(2147483647) |  |  |
| dateAdded | Date Added | SCALAR | Timestamp |  |  |
| dateClientInterview | Date Client Interview | SCALAR | Timestamp |  |  |
| dateClosed | Date Closed | SCALAR | Timestamp |  |  |
| dateEnd | Date End | SCALAR | Timestamp |  |  |
| dateLastExported | Date Last Exported | SCALAR | Timestamp |  |  |
| dateLastModified | Date Last Modified | SCALAR | Timestamp |  |  |
| dateLastPublished | Date Last Published | SCALAR | Timestamp |  |  |
| degreeList | Degree List | SCALAR | String(2147483647) |  |  |
| description | Description | SCALAR | String(2147483647) |  |  |
| durationWeeks | Duration Weeks | SCALAR | Double |  |  |
| educationDegree | Education Degree | SCALAR | String(50) |  |  |
| employmentType | Employment Type | SCALAR | String(200) |  |  |
| estimatedEndDate | Estimated End Date | SCALAR | Date |  |  |
| externalCategoryID | External Category ID | SCALAR | Integer |  |  |
| externalID | External ID | SCALAR | String(100) |  |  |
| feeArrangement | Fee Arrangement | SCALAR | Double |  |  |
| fileAttachments | File Attachments | TO_MANY |  |  | → JobOrderFileAttachment |
| hoursOfOperation | Hours Of Operation | SCALAR | String(30) |  |  |
| hoursPerWeek | Hours Per Week | SCALAR | Double |  |  |
| interviews | Interviews | TO_MANY |  |  | → Appointment |
| isClientContact | Is Client Contact | SCALAR | Boolean |  |  |
| isClientEditable | Is Client Editable | SCALAR | Boolean |  |  |
| isDeleted | Is Deleted | SCALAR | Boolean |  |  |
| isExtendable | Is Extendable | SCALAR | Boolean |  |  |
| isInterviewRequired | Is Interview Required | SCALAR | Boolean |  |  |
| isJobcastPublished | Is Jobcast Published | SCALAR | Boolean |  |  |
| isOpen | Is Open | SCALAR | Boolean |  |  |
| isPublic | Is Public | SCALAR | Integer |  |  |
| isWorkFromHome | Is Work From Home | SCALAR | Boolean |  |  |
| jobBoardList | Job Board List | SCALAR | String(2147483647) |  |  |
| jobOrderScreenerQuestions | Job Order Screener Questions | TO_MANY |  |  | → JobOrderScreenerQuestion |
| jobOrderUUID | Job Order UUID | SCALAR | String(35) |  |  |
| jobPostingURL | Job Posting URL | SCALAR | String(100) |  |  |
| location | Location | TO_ONE |  |  | → Location |
| markUpPercentage | Mark Up Percentage | SCALAR | Double |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| notes | Notes | TO_MANY |  |  | → Note |
| numOpenings | Num Openings | SCALAR | Integer |  |  |
| onSite | On Site | SCALAR | String(20) |  |  |
| opportunity | Opportunity | TO_ONE |  |  | → Opportunity |
| optionsPackage | Options Package | SCALAR | String(2147483647) |  |  |
| owner | Owner | TO_ONE |  |  | → CorporateUser |
| parentJobOrder | Parent Job Order | TO_ONE |  |  | → JobOrder |
| payRate | Pay Rate | SCALAR | BigDecimal |  |  |
| placements | Placements | TO_MANY |  |  | → Placement |
| publicDescription | Public Description | SCALAR | String(2147483647) |  |  |
| publishedCategory | Published Category | TO_ONE |  |  | → Category |
| publishedZip | Published Zip | SCALAR | String(18) |  |  |
| reasonClosed | Reason Closed | SCALAR | String(2147483647) |  |  |
| reportTo | Report To | SCALAR | String(100) |  |  |
| reportToClientContact | Report To Client Contact | TO_ONE |  |  | → ClientContact |
| responseUser | Response User | TO_ONE |  |  | → CorporateUser |
| salary | Salary | SCALAR | BigDecimal |  |  |
| salaryRange | Salary Range | SCALAR | String(30) |  |  |
| salaryUnit | Salary Unit | SCALAR | String(12) |  |  |
| screenerQuestionsStatus | Screener Questions Status | SCALAR | Integer |  |  |
| sendouts | Sendouts | TO_MANY |  |  | → Sendout |
| shift | Shift | TO_ONE |  |  | → Shift |
| shifts | Shifts | TO_MANY |  |  | → Shift |
| skillList | Skill List | SCALAR | String(2147483647) |  |  |
| skills | Skills | TO_MANY |  |  | → Skill |
| source | Source | SCALAR | String(100) |  |  |
| specialties | Specialties | TO_MANY |  |  | → Specialty |
| startDate | Start Date | SCALAR | Timestamp |  |  |
| status | Status | SCALAR | String(200) |  |  |
| submissions | Submissions | TO_MANY |  |  | → JobSubmission |
| tasks | Tasks | TO_MANY |  |  | → Task |
| taxRate | Tax Rate | SCALAR | Double |  |  |
| taxStatus | Tax Status | SCALAR | String(20) |  |  |
| tearsheetRecipients | Tearsheet Recipients | TO_MANY |  |  | → TearsheetRecipient |
| tearsheets | Tearsheets | TO_MANY |  |  | → Tearsheet |
| timeAndLaborEnabledDate | Time And Labor Enabled Date | SCALAR | Timestamp |  |  |
| timeUnits | Time Units | TO_MANY |  |  | → TimeUnit |
| title | Title | SCALAR | String(100) |  |  |
| travelRequirements | Travel Requirements | SCALAR | String(50) |  |  |
| type | Type | SCALAR | Integer |  |  |
| usersAssigned | Users Assigned | SCALAR | String |  |  |
| webResponses | Web Responses | TO_MANY |  |  | → JobSubmission |
| willRelocate | Will Relocate | SCALAR | Boolean |  |  |
| willRelocateInt | Will Relocate Int | SCALAR | Integer |  |  |
| willSponsor | Will Sponsor | SCALAR | Boolean |  |  |
| workersCompRate | Workers Comp Rate | TO_ONE |  |  | → WorkersCompensationRate |
| yearsRequired | Years Required | SCALAR | Integer |  |  |

## CandidateSource — "Candidate Source"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| accountNumber | Account Number | SCALAR | String(100) |  |  |
| address | Address | COMPOSITE | AddressWithoutCountry |  |  |
| candidate | Candidate | TO_ONE |  |  | → Candidate |
| fax | Fax | SCALAR | String(20) |  |  |
| fee | Fee | SCALAR | BigDecimal |  |  |
| feeType | Fee Type | SCALAR | String(20) |  |  |
| migrateGUID | Migrate GUID | SCALAR | String(36) |  |  |
| name | Name | SCALAR | String(100) |  |  |
| phone | Phone | SCALAR | String(20) |  |  |
| type | Type | SCALAR | String(50) |  |  |

## TimeUnit — "Time Unit"

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| name | Name | SCALAR | String(100) |  |  |
| timeMarker | Time Marker | SCALAR | Integer |  |  |
| weekDay | Week Day | SCALAR | Integer |  |  |

## Location

| Field | Label | Type | Data | Required | Options / Links to |
|---|---|---|---|---|---|
| id | ID | ID | Integer |  |  |
| address | Address | COMPOSITE | AddressWithStateID |  |  |
| candidate | candidateUserID | TO_ONE |  |  | → Candidate |
| clientContacts | Contacts | TO_MANY |  |  | → ClientContact |
| clientCorporation | clientCorporationID | TO_ONE |  |  | → ClientCorporation |
| customDate1 | customDate1 | SCALAR | Timestamp |  |  |
| customDate2 | customDate2 | SCALAR | Timestamp |  |  |
| customDate3 | customDate3 | SCALAR | Timestamp |  |  |
| customFloat1 | customFloat1 | SCALAR | Double |  |  |
| customFloat2 | customFloat2 | SCALAR | Double |  |  |
| customFloat3 | customFloat3 | SCALAR | Double |  |  |
| customInt1 | customInt1 | SCALAR | Integer |  |  |
| customInt2 | customInt2 | SCALAR | Integer |  |  |
| customInt3 | customInt3 | SCALAR | Integer |  |  |
| customText1 | customText1 | SCALAR | String(100) |  |  |
| customText10 | customText10 | SCALAR | String(100) |  |  |
| customText11 | customText11 | SCALAR | String(100) |  |  |
| customText12 | customText12 | SCALAR | String(100) |  |  |
| customText13 | customText13 | SCALAR | String(100) |  |  |
| customText14 | customText14 | SCALAR | String(100) |  |  |
| customText15 | customText15 | SCALAR | String(100) |  |  |
| customText16 | customText16 | SCALAR | String(100) |  |  |
| customText17 | customText17 | SCALAR | String(100) |  |  |
| customText18 | customText18 | SCALAR | String(100) |  |  |
| customText19 | customText19 | SCALAR | String(100) |  |  |
| customText2 | customText2 | SCALAR | String(100) |  |  |
| customText20 | customText20 | SCALAR | String(100) |  |  |
| customText3 | customText3 | SCALAR | String(100) |  |  |
| customText4 | customText4 | SCALAR | String(100) |  |  |
| customText5 | customText5 | SCALAR | String(100) |  |  |
| customText6 | customText6 | SCALAR | String(100) |  |  |
| customText7 | customText7 | SCALAR | String(100) |  |  |
| customText8 | customText8 | SCALAR | String(100) |  |  |
| customText9 | customText9 | SCALAR | String(100) |  |  |
| customTextBlock1 | customTextBlock1 | SCALAR | String(2147483647) |  |  |
| customTextBlock2 | customTextBlock2 | SCALAR | String(2147483647) |  |  |
| customTextBlock3 | customTextBlock3 | SCALAR | String(2147483647) |  |  |
| dateAdded | dateAdded | SCALAR | Timestamp |  |  |
| dateLastModified | dateLastModified | SCALAR | Timestamp |  |  |
| description | Description | SCALAR | String(255) |  |  |
| effectiveDate | Effective Date | SCALAR | Date | yes |  |
| effectiveEndDate | effectiveEndDate | SCALAR | Date |  |  |
| externalID | Location Code | SCALAR | String(100) |  |  |
| isBillTo | Bill To | SCALAR | Boolean |  | Yes, No |
| isDeleted | isDeleted | SCALAR | Boolean |  |  |
| isSoldTo | Sold To | SCALAR | Boolean |  | Yes, No |
| isWorkSite | Worksite | SCALAR | Boolean |  | Yes, No |
| owner | userID | TO_ONE |  |  | → CorporateUser |
| status | Status | SCALAR | String(100) | yes | Active, Inactive |
| title | Title | SCALAR | String(100) | yes |  |
| versionID | LocationVersionID | SCALAR | Integer |  |  |
| versions | Versions | TO_MANY |  |  | → LocationVersion |

