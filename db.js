/**
 * Bullhorn Dashboard — Database & Sync Engine
 * Postgres cache layer that syncs from Bullhorn REST API.
 *
 * - Auto-creates tables on startup
 * - Full sync on first run, incremental every 5 minutes
 * - Every record stores raw_json JSONB for FULL fidelity of all Bullhorn fields
 * - Structured columns cover the most-queried fields for fast indexed queries
 * - Graceful fallback: if DATABASE_URL is not set, db is disabled
 */

const { Pool } = require("pg");

/* ═══ CONNECTION ═══ */
var pool = null;
var dbReady = false;
var lastSyncStatus = { time: null, success: true, message: "No sync yet" };

function isEnabled() {
  return !!process.env.DATABASE_URL;
}

function init() {
  if (!isEnabled()) {
    console.log("[DB] DATABASE_URL not set — running without cache layer");
    return;
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", function (err) {
    console.error("[DB] Pool error:", err.message);
  });
  console.log("[DB] Postgres pool initialized");
}

async function query(text, params) {
  if (!pool) throw new Error("Database not initialized");
  return pool.query(text, params);
}

async function getOne(text, params) {
  var res = await query(text, params);
  return res.rows[0] || null;
}

async function getAll(text, params) {
  var res = await query(text, params);
  return res.rows;
}

/* ═══ SCHEMA ═══ */
async function createTables() {
  if (!pool) return;

  // Candidates — comprehensive structured columns + raw_json for everything else
  await query(`
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      name TEXT,
      email TEXT,
      email2 TEXT,
      phone TEXT,
      phone2 TEXT,
      mobile TEXT,
      status TEXT,
      source TEXT,
      occupation TEXT,
      company_name TEXT,
      education_degree TEXT,
      salary NUMERIC,
      salary_low NUMERIC,
      day_rate NUMERIC,
      day_rate_low NUMERIC,
      hourly_rate NUMERIC,
      hourly_rate_low NUMERIC,
      employment_preference TEXT,
      custom_text1 TEXT,
      custom_text2 TEXT,
      custom_text3 TEXT,
      custom_text4 TEXT,
      custom_text5 TEXT,
      custom_text6 TEXT,
      custom_text7 TEXT,
      custom_text8 TEXT,
      custom_text9 TEXT,
      custom_text10 TEXT,
      custom_text_block1 TEXT,
      custom_text_block2 TEXT,
      custom_text_block3 TEXT,
      custom_int1 INTEGER,
      custom_int2 INTEGER,
      custom_int3 INTEGER,
      custom_float1 NUMERIC,
      custom_float2 NUMERIC,
      custom_float3 NUMERIC,
      custom_date1 BIGINT,
      custom_date2 BIGINT,
      custom_date3 BIGINT,
      description TEXT,
      date_available BIGINT,
      date_added BIGINT,
      date_last_modified BIGINT,
      date_last_comment BIGINT,
      date_of_birth BIGINT,
      address_city TEXT,
      address_state TEXT,
      address_zip TEXT,
      address_country TEXT,
      address_address1 TEXT,
      address_address2 TEXT,
      owner_id INTEGER,
      owner_name TEXT,
      skill_list TEXT,
      category_id INTEGER,
      federal_additional_withholdings_amount NUMERIC,
      experience INTEGER,
      will_relocate BOOLEAN,
      ethnicity TEXT,
      gender TEXT,
      veteran TEXT,
      disability TEXT,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Jobs — comprehensive
  await query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      title TEXT,
      type INTEGER,
      status TEXT,
      employment_type TEXT,
      client_id INTEGER,
      client_name TEXT,
      num_openings INTEGER,
      salary NUMERIC,
      salary_unit TEXT,
      pay_rate NUMERIC,
      client_bill_rate NUMERIC,
      fee_arrangement NUMERIC,
      on_site TEXT,
      years_required INTEGER,
      start_date BIGINT,
      date_end BIGINT,
      date_added BIGINT,
      date_last_modified BIGINT,
      date_closed BIGINT,
      description TEXT,
      public_description TEXT,
      address_city TEXT,
      address_state TEXT,
      address_zip TEXT,
      address_country TEXT,
      owner_id INTEGER,
      owner_name TEXT,
      custom_text1 TEXT,
      custom_text2 TEXT,
      custom_text3 TEXT,
      custom_text4 TEXT,
      custom_text5 TEXT,
      custom_text6 TEXT,
      custom_text7 TEXT,
      custom_text_block1 TEXT,
      custom_text_block2 TEXT,
      custom_int1 INTEGER,
      custom_int2 INTEGER,
      custom_int3 INTEGER,
      custom_float1 NUMERIC,
      custom_float2 NUMERIC,
      custom_date1 BIGINT,
      custom_date2 BIGINT,
      skill_list TEXT,
      duration_weeks NUMERIC,
      is_open BOOLEAN,
      is_deleted BOOLEAN,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Placements — comprehensive
  await query(`
    CREATE TABLE IF NOT EXISTS placements (
      id INTEGER PRIMARY KEY,
      candidate_id INTEGER,
      candidate_name TEXT,
      job_id INTEGER,
      job_title TEXT,
      client_id INTEGER,
      client_name TEXT,
      status TEXT,
      employment_type TEXT,
      date_begin BIGINT,
      date_end BIGINT,
      date_added BIGINT,
      date_last_modified BIGINT,
      pay_rate NUMERIC,
      client_bill_rate NUMERIC,
      salary NUMERIC,
      salary_unit TEXT,
      fee NUMERIC,
      overtime_rate NUMERIC,
      client_overtime_rate NUMERIC,
      double_time_rate NUMERIC,
      hours_per_day NUMERIC,
      days_per_week NUMERIC,
      housing_manager_id INTEGER,
      housing_manager_name TEXT,
      referring_user_id INTEGER,
      referring_user_name TEXT,
      custom_text1 TEXT,
      custom_text2 TEXT,
      custom_text3 TEXT,
      custom_text4 TEXT,
      custom_text5 TEXT,
      custom_float1 NUMERIC,
      custom_float2 NUMERIC,
      custom_float3 NUMERIC,
      custom_int1 INTEGER,
      custom_int2 INTEGER,
      custom_date1 BIGINT,
      custom_text_block1 TEXT,
      correlation_id TEXT,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Clients — comprehensive
  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY,
      name TEXT,
      status TEXT,
      company_url TEXT,
      phone TEXT,
      fax_phone TEXT,
      industry_list TEXT,
      num_employees INTEGER,
      revenue TEXT,
      notes TEXT,
      address_city TEXT,
      address_state TEXT,
      address_zip TEXT,
      address_country TEXT,
      address_address1 TEXT,
      billing_city TEXT,
      billing_state TEXT,
      billing_zip TEXT,
      billing_phone TEXT,
      billing_contact TEXT,
      custom_text1 TEXT,
      custom_text2 TEXT,
      custom_text3 TEXT,
      custom_text4 TEXT,
      custom_text5 TEXT,
      custom_int1 INTEGER,
      custom_int2 INTEGER,
      custom_float1 NUMERIC,
      custom_date1 BIGINT,
      custom_text_block1 TEXT,
      owner_id INTEGER,
      owner_name TEXT,
      owner_email TEXT,
      date_added BIGINT,
      date_last_modified BIGINT,
      date_founded TEXT,
      facebook_profile_name TEXT,
      linkedin_profile_name TEXT,
      twitter_handle TEXT,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Submissions (JobSubmission)
  await query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY,
      candidate_id INTEGER,
      candidate_name TEXT,
      job_id INTEGER,
      job_title TEXT,
      client_id INTEGER,
      client_name TEXT,
      status TEXT,
      source TEXT,
      date_added BIGINT,
      date_last_modified BIGINT,
      date_web_response BIGINT,
      sending_user_id INTEGER,
      sending_user TEXT,
      pay_rate NUMERIC,
      client_bill_rate NUMERIC,
      salary NUMERIC,
      comments TEXT,
      custom_text1 TEXT,
      custom_text2 TEXT,
      custom_text3 TEXT,
      custom_text4 TEXT,
      custom_text5 TEXT,
      custom_int1 INTEGER,
      custom_int2 INTEGER,
      custom_float1 NUMERIC,
      custom_date1 BIGINT,
      custom_text_block1 TEXT,
      is_deleted BOOLEAN,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Notes
  await query(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      person_id INTEGER,
      client_id INTEGER,
      job_order_id INTEGER,
      placement_id INTEGER,
      action TEXT,
      comments_text TEXT,
      date_added BIGINT,
      date_last_modified BIGINT,
      commenting_person_id INTEGER,
      commenting_person_name TEXT,
      is_deleted BOOLEAN,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Opportunities (sales pipeline)
  await query(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY,
      title TEXT,
      type TEXT,
      status TEXT,
      client_id INTEGER,
      client_name TEXT,
      owner_id INTEGER,
      owner_name TEXT,
      estimated_start BIGINT,
      estimated_end BIGINT,
      estimated_hours NUMERIC,
      estimated_bill_rate NUMERIC,
      estimated_pay_rate NUMERIC,
      estimated_revenue NUMERIC,
      salary NUMERIC,
      num_openings INTEGER,
      win_probability NUMERIC,
      weighted_deal_value NUMERIC,
      deal_value NUMERIC,
      commission NUMERIC,
      date_added BIGINT,
      date_last_modified BIGINT,
      description TEXT,
      lead TEXT,
      source TEXT,
      reason_closed TEXT,
      custom_text1 TEXT,
      custom_text2 TEXT,
      custom_text3 TEXT,
      custom_text4 TEXT,
      custom_text5 TEXT,
      custom_text6 TEXT,
      custom_text7 TEXT,
      custom_text8 TEXT,
      custom_text9 TEXT,
      custom_text10 TEXT,
      custom_text_block1 TEXT,
      custom_text_block2 TEXT,
      custom_int1 INTEGER,
      custom_int2 INTEGER,
      custom_int3 INTEGER,
      custom_float1 NUMERIC,
      custom_float2 NUMERIC,
      custom_float3 NUMERIC,
      custom_date1 BIGINT,
      custom_date2 BIGINT,
      custom_date3 BIGINT,
      is_deleted BOOLEAN,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Client Contacts (people at client companies)
  await query(`
    CREATE TABLE IF NOT EXISTS client_contacts (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      name TEXT,
      email TEXT,
      email2 TEXT,
      phone TEXT,
      phone2 TEXT,
      mobile TEXT,
      type TEXT,
      status TEXT,
      occupation TEXT,
      division TEXT,
      client_id INTEGER,
      client_name TEXT,
      owner_id INTEGER,
      owner_name TEXT,
      address_city TEXT,
      address_state TEXT,
      address_zip TEXT,
      date_added BIGINT,
      date_last_modified BIGINT,
      date_last_comment BIGINT,
      description TEXT,
      custom_text1 TEXT,
      custom_text2 TEXT,
      custom_text3 TEXT,
      custom_text4 TEXT,
      custom_text5 TEXT,
      custom_int1 INTEGER,
      custom_int2 INTEGER,
      custom_float1 NUMERIC,
      custom_date1 BIGINT,
      custom_text_block1 TEXT,
      is_deleted BOOLEAN,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Corporate Users (internal team)
  await query(`
    CREATE TABLE IF NOT EXISTS corporate_users (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      name TEXT,
      email TEXT,
      email2 TEXT,
      phone TEXT,
      mobile TEXT,
      username TEXT,
      occupation TEXT,
      status TEXT,
      is_locked BOOLEAN,
      is_deleted BOOLEAN,
      date_last_modified BIGINT,
      primary_department_id INTEGER,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Sendouts (interview records)
  await query(`
    CREATE TABLE IF NOT EXISTS sendouts (
      id INTEGER PRIMARY KEY,
      candidate_id INTEGER,
      candidate_name TEXT,
      job_id INTEGER,
      job_title TEXT,
      client_id INTEGER,
      client_name TEXT,
      client_contact_id INTEGER,
      client_contact_name TEXT,
      status TEXT,
      date_added BIGINT,
      date_last_modified BIGINT,
      sending_user_id INTEGER,
      sending_user_name TEXT,
      is_read BOOLEAN,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Appointments / Activities
  await query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY,
      subject TEXT,
      type TEXT,
      description TEXT,
      candidate_id INTEGER,
      client_contact_id INTEGER,
      job_id INTEGER,
      placement_id INTEGER,
      owner_id INTEGER,
      owner_name TEXT,
      date_begin BIGINT,
      date_end BIGINT,
      date_added BIGINT,
      date_last_modified BIGINT,
      is_deleted BOOLEAN,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Tasks
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      subject TEXT,
      type TEXT,
      description TEXT,
      status TEXT,
      candidate_id INTEGER,
      client_contact_id INTEGER,
      job_id INTEGER,
      placement_id INTEGER,
      owner_id INTEGER,
      owner_name TEXT,
      date_begin BIGINT,
      date_end BIGINT,
      date_added BIGINT,
      date_last_modified BIGINT,
      date_completed BIGINT,
      is_deleted BOOLEAN,
      is_completed BOOLEAN,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Leads
  await query(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      status TEXT,
      source TEXT,
      type TEXT,
      client_id INTEGER,
      client_name TEXT,
      owner_id INTEGER,
      owner_name TEXT,
      description TEXT,
      date_added BIGINT,
      date_last_modified BIGINT,
      is_deleted BOOLEAN,
      custom_text1 TEXT,
      custom_text2 TEXT,
      custom_text3 TEXT,
      custom_int1 INTEGER,
      custom_float1 NUMERIC,
      custom_date1 BIGINT,
      raw_json JSONB,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Epic Go-Live Tracker — manually tracked + enriched hospital implementations
  await query(`
    CREATE TABLE IF NOT EXISTS epic_golives (
      id SERIAL PRIMARY KEY,
      hospital_name TEXT NOT NULL,
      health_system TEXT,
      city TEXT,
      state TEXT,
      phase TEXT DEFAULT 'Planning',
      go_live_date TEXT,
      modules TEXT,
      source TEXT,
      source_url TEXT,
      notes TEXT,
      contact_name TEXT,
      contact_title TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      opportunity_status TEXT DEFAULT 'Not Started',
      owner_name TEXT,
      estimated_value NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Market Intelligence — aggregated news, LinkedIn clips, RSS articles
  await query(`
    CREATE TABLE IF NOT EXISTS market_intel (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      url TEXT,
      source TEXT NOT NULL,
      source_type TEXT DEFAULT 'rss',
      content TEXT,
      published_at TIMESTAMPTZ,
      scraped_at TIMESTAMPTZ DEFAULT NOW(),
      tags TEXT,
      relevance_score NUMERIC DEFAULT 0,
      hospital_name TEXT,
      health_system TEXT,
      state TEXT,
      epic_modules TEXT,
      go_live_date TEXT,
      is_read BOOLEAN DEFAULT false,
      is_starred BOOLEAN DEFAULT false,
      is_actionable BOOLEAN DEFAULT false,
      linked_golive_id INTEGER,
      notes TEXT,
      ai_extracted JSONB
    )
  `);

  // Sync tracking tables
  await query(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      sync_type TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      records_synced INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error_message TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sync_state (
      entity_type TEXT PRIMARY KEY,
      last_full_sync TIMESTAMPTZ,
      last_incremental_sync TIMESTAMPTZ,
      last_sync_record_count INTEGER DEFAULT 0,
      total_records INTEGER DEFAULT 0
    )
  `);

  // Indexes for common queries
  await query(`CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_candidates_modified ON candidates(date_last_modified)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_candidates_custom1 ON candidates(custom_text1)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_candidates_custom6 ON candidates(custom_text6)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_candidates_owner ON candidates(owner_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_candidates_available ON candidates(date_available)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_owner ON jobs(owner_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_placements_status ON placements(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_placements_date_end ON placements(date_end)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_placements_candidate ON placements(candidate_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_placements_client ON placements(client_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_submissions_job ON submissions(job_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_submissions_candidate ON submissions(candidate_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notes_person ON notes(person_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notes_client ON notes(client_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notes_action ON notes(action)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notes_job ON notes(job_order_id)`);

  // New entity indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_opportunities_client ON opportunities(client_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON opportunities(owner_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON client_contacts(client_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_client_contacts_owner ON client_contacts(owner_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_client_contacts_name ON client_contacts(last_name, first_name)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_corporate_users_name ON corporate_users(last_name, first_name)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sendouts_candidate ON sendouts(candidate_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sendouts_job ON sendouts(job_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_appointments_owner ON appointments(owner_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date_begin)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id)`);

  // Market intel indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_intel_source ON market_intel(source)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_intel_source_type ON market_intel(source_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_intel_published ON market_intel(published_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_intel_starred ON market_intel(is_starred)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_intel_actionable ON market_intel(is_actionable)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_intel_url ON market_intel(url)`);

  // Epic go-live indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_golives_state ON epic_golives(state)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_golives_phase ON epic_golives(phase)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_golives_opp_status ON epic_golives(opportunity_status)`);

  // GIN index on raw_json for flexible JSONB queries against any field
  await query(`CREATE INDEX IF NOT EXISTS idx_candidates_raw ON candidates USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_raw ON jobs USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_placements_raw ON placements USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_clients_raw ON clients USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_submissions_raw ON submissions USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notes_raw ON notes USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_opportunities_raw ON opportunities USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_client_contacts_raw ON client_contacts USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_corporate_users_raw ON corporate_users USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sendouts_raw ON sendouts USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_appointments_raw ON appointments USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_raw ON tasks USING GIN (raw_json)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_leads_raw ON leads USING GIN (raw_json)`);

  dbReady = true;
  console.log("[DB] Tables and indexes ready");
}

/* ═══ SYNC ENGINE ═══ */

// bhFetchAll and bhFetch are injected from server.js
var _bhFetchAll = null;
var _bhFetch = null;

function setBullhornFetchers(fetchAll, fetch) {
  _bhFetchAll = fetchAll;
  _bhFetch = fetch;
}

/*
 * FIELD LISTS — comprehensive per Bullhorn entity.
 * We request ALL known fields so raw_json captures everything.
 * Nested TO-ONE entities (owner, candidate, jobOrder, etc.) are included
 * with their most important sub-fields.
 */
var CANDIDATE_FIELDS = [
  "id","firstName","lastName","name","middleName","nickName","email","email2",
  "phone","phone2","phone3","mobile","pager","fax",
  "status","source","occupation","companyName","educationDegree",
  "salary","salaryLow","dayRate","dayRateLow","hourlyRate","hourlyRateLow",
  "employmentPreference","willRelocate","ethnicity","gender","veteran","disability",
  "customText1","customText2","customText3","customText4","customText5",
  "customText6","customText7","customText8","customText9","customText10",
  "customText11","customText12","customText13","customText14","customText15",
  "customText16","customText17","customText18","customText19","customText20",
  "customTextBlock1","customTextBlock2","customTextBlock3","customTextBlock4","customTextBlock5",
  "customInt1","customInt2","customInt3","customInt4","customInt5",
  "customFloat1","customFloat2","customFloat3",
  "customDate1","customDate2","customDate3",
  "description","dateAvailable","dateAdded","dateLastModified","dateLastComment","dateOfBirth",
  "address","owner",
  "experience",
  "comments","externalID","isDeleted","massMailOptOut","smsOptIn",
  "linkedPerson","referredByPerson"
].join(",");

var JOB_FIELDS = [
  "id","title","type","status","employmentType",
  "clientCorporation","numOpenings",
  "salary","salaryUnit","payRate","clientBillRate","feeArrangement",
  "onSite","yearsRequired","startDate","dateEnd","dateClosed",
  "dateAdded","dateLastModified",
  "description","publicDescription",
  "address","owner",
  "customText1","customText2","customText3","customText4","customText5",
  "customText6","customText7","customText8","customText9","customText10",
  "customTextBlock1","customTextBlock2","customTextBlock3",
  "customInt1","customInt2","customInt3","customInt4","customInt5",
  "customFloat1","customFloat2","customFloat3",
  "customDate1","customDate2","customDate3",
  "durationWeeks","isOpen","isDeleted",
  "submissions","sendouts","placements","webResponses",
  "source","externalID","reasonClosed","markUpPercentage",
  "taxRate","travelRequirements","bonusPackage","benefits",
  "degreeList","certificationList","educationDegree",
  "publishedZip","hoursPerWeek"
].join(",");

var PLACEMENT_FIELDS = [
  "id","candidate","jobOrder","status","employmentType",
  "dateBegin","dateEnd","dateAdded","dateLastModified",
  "payRate","clientBillRate","salary","salaryUnit",
  "fee","overtimeRate","clientOvertimeRate",
  "hoursPerDay","daysPerWeek","daysGuaranteed",
  "housingManager","referringUser",
  "customText1","customText2","customText3","customText4","customText5",
  "customText6","customText7","customText8","customText9","customText10",
  "customTextBlock1","customTextBlock2","customTextBlock3",
  "customFloat1","customFloat2","customFloat3",
  "customInt1","customInt2","customInt3",
  "customDate1","customDate2","customDate3",
  "correlationId","taxRate","markUpPercentage",
  "dateEffective","dateLastPaycheck",
  "terminationReason","bonusPackage","comments",
  "costCenter","invoiceGroupName","recruitingManagerPercentGrossMargin",
  "statementClientContact","billingClientContact","approvedChangeRequests",
  "externalID"
].join(",");

var CLIENT_FIELDS = [
  "id","name","status","companyURL","phone",
  "industryList","numEmployees","revenue","notes",
  "address","billingAddress","billingPhone","billingContact",
  "owner",
  "customText1","customText2","customText3","customText4","customText5",
  "customText6","customText7","customText8","customText9","customText10",
  "customTextBlock1","customTextBlock2","customTextBlock3",
  "customInt1","customInt2","customInt3",
  "customFloat1","customFloat2","customFloat3",
  "customDate1","customDate2","customDate3",
  "dateAdded","dateLastModified","dateFounded",
  "facebookProfileName","linkedinProfileName","twitterHandle",
  "externalID","annualRevenue","numOffices","businessSectorList",
  "department","invoiceFormat","paymentTerms","taxRate"
].join(",");

var SUBMISSION_FIELDS = [
  "id","candidate","jobOrder","status","source",
  "dateAdded","dateLastModified","dateWebResponse",
  "sendingUser","owners",
  "payRate","salary",
  "comments","isDeleted",
  "customText1","customText2","customText3","customText4","customText5",
  "customText6","customText7","customText8","customText9","customText10",
  "customTextBlock1","customTextBlock2",
  "customInt1","customInt2","customInt3",
  "customFloat1","customFloat2","customFloat3",
  "customDate1","customDate2",
  "externalID","milesRadius"
].join(",");

var NOTE_FIELDS = [
  "id","personReference","clientCorporation","jobOrder","placement",
  "action","comments","dateAdded","dateLastModified",
  "commentingPerson","isDeleted",
  "externalID","minutesSpent"
].join(",");

var OPPORTUNITY_FIELDS = [
  "id","title","type","status","clientCorporation","owner",
  "estimatedStartDate","estimatedEndDate","estimatedHoursPerWeek",
  "salary",
  "numOpenings","winProbabilityPercent","weightedDealValue","dealValue","commission",
  "dateAdded","dateLastModified","description","lead","source","reasonClosed",
  "customText1","customText2","customText3","customText4","customText5",
  "customText6","customText7","customText8","customText9","customText10",
  "customTextBlock1","customTextBlock2",
  "customInt1","customInt2","customInt3",
  "customFloat1","customFloat2","customFloat3",
  "customDate1","customDate2","customDate3",
  "isDeleted","externalID","jobOrders","candidates"
].join(",");

var CLIENT_CONTACT_FIELDS = [
  "id","firstName","lastName","name","email","email2","email3",
  "phone","phone2","phone3","mobile","fax",
  "type","status","occupation","division",
  "clientCorporation","owner",
  "address","dateAdded","dateLastModified","dateLastComment",
  "description","externalID","isDeleted",
  "customText1","customText2","customText3","customText4","customText5",
  "customText6","customText7","customText8","customText9","customText10",
  "customTextBlock1","customTextBlock2","customTextBlock3",
  "customInt1","customInt2","customInt3",
  "customFloat1","customFloat2","customFloat3",
  "customDate1","customDate2","customDate3"
].join(",");

var CORPORATE_USER_FIELDS = [
  "id","firstName","lastName","name","email","email2",
  "phone","mobile","username","occupation","status",
  "isDeleted","dateLastModified",
  "primaryDepartment","externalID"
].join(",");

var SENDOUT_FIELDS = [
  "id","candidate","jobOrder","clientCorporation","clientContact",
  "dateAdded","dateLastModified",
  "sendingUser","isRead"
].join(",");

var APPOINTMENT_FIELDS = [
  "id","subject","type","description",
  "candidateReference","clientContactReference","jobOrder","placement",
  "owner","dateBegin","dateEnd","dateAdded","dateLastModified",
  "isDeleted","communicationMethod","location"
].join(",");

var TASK_FIELDS = [
  "id","subject","type","description",
  "candidateReference","clientContactReference","jobOrder","placement",
  "owner","dateBegin","dateEnd","dateAdded","dateLastModified",
  "dateCompleted","isDeleted","isCompleted"
].join(",");

var LEAD_FIELDS = [
  "id","firstName","lastName","name","email","phone",
  "status","source","type","clientCorporation","owner",
  "description","dateAdded","dateLastModified","isDeleted",
  "customText1","customText2","customText3",
  "customInt1","customFloat1","customDate1",
  "address"
].join(",");


/* ─── Helper: safe nested field extraction ─── */
function safeStr(v) { return v ? String(v) : ""; }
function safeNum(v) { return v != null && v !== "" ? Number(v) : null; }
function safeBool(v) { return v === true || v === "true" ? true : (v === false || v === "false" ? false : null); }
function safeCert(v) {
  if (!v) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
function ownerName(o) {
  if (!o) return "";
  return ((o.firstName || "") + " " + (o.lastName || "")).trim();
}


/* ─── Entity sync configurations ─── */
var SYNC_ENTITIES = {
  candidates: {
    endpoint: "search/Candidate",
    queryField: "query",
    baseQuery: "isDeleted:0",
    fields: CANDIDATE_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var addr = r.address || {};
      return {
        id: r.id,
        first_name: safeStr(r.firstName),
        last_name: safeStr(r.lastName),
        name: safeStr(r.name || ((r.firstName || "") + " " + (r.lastName || "")).trim()),
        email: safeStr(r.email),
        email2: safeStr(r.email2),
        phone: safeStr(r.phone),
        phone2: safeStr(r.phone2),
        mobile: safeStr(r.mobile),
        status: safeStr(r.status),
        source: safeStr(r.source),
        occupation: safeStr(r.occupation),
        company_name: safeStr(r.companyName),
        education_degree: safeStr(r.educationDegree),
        salary: safeNum(r.salary),
        salary_low: safeNum(r.salaryLow),
        day_rate: safeNum(r.dayRate),
        day_rate_low: safeNum(r.dayRateLow),
        hourly_rate: safeNum(r.hourlyRate),
        hourly_rate_low: safeNum(r.hourlyRateLow),
        employment_preference: safeStr(r.employmentPreference),
        custom_text1: safeCert(r.customText1),
        custom_text2: safeCert(r.customText2),
        custom_text3: safeCert(r.customText3),
        custom_text4: safeCert(r.customText4),
        custom_text5: safeCert(r.customText5),
        custom_text6: safeStr(r.customText6),
        custom_text7: safeStr(r.customText7),
        custom_text8: safeStr(r.customText8),
        custom_text9: safeStr(r.customText9),
        custom_text10: safeStr(r.customText10),
        custom_text_block1: safeStr(r.customTextBlock1),
        custom_text_block2: safeStr(r.customTextBlock2),
        custom_text_block3: safeStr(r.customTextBlock3),
        custom_int1: safeNum(r.customInt1),
        custom_int2: safeNum(r.customInt2),
        custom_int3: safeNum(r.customInt3),
        custom_float1: safeNum(r.customFloat1),
        custom_float2: safeNum(r.customFloat2),
        custom_float3: safeNum(r.customFloat3),
        custom_date1: safeNum(r.customDate1),
        custom_date2: safeNum(r.customDate2),
        custom_date3: safeNum(r.customDate3),
        description: safeStr(r.description),
        date_available: safeNum(r.dateAvailable),
        date_added: safeNum(r.dateAdded),
        date_last_modified: safeNum(r.dateLastModified),
        date_last_comment: safeNum(r.dateLastComment),
        date_of_birth: safeNum(r.dateOfBirth),
        address_city: safeStr(addr.city),
        address_state: safeStr(addr.state),
        address_zip: safeStr(addr.zip),
        address_country: safeStr(addr.countryName || addr.countryID),
        address_address1: safeStr(addr.address1),
        address_address2: safeStr(addr.address2),
        owner_id: r.owner ? r.owner.id : null,
        owner_name: ownerName(r.owner),
        skill_list: safeStr(r.skillList),
        category_id: r.category ? (r.category.id || null) : null,
        federal_additional_withholdings_amount: safeNum(r.federalAdditionalWithholdingsAmount),
        experience: safeNum(r.experience),
        will_relocate: safeBool(r.willRelocate),
        ethnicity: safeStr(r.ethnicity),
        gender: safeStr(r.gender),
        veteran: safeStr(r.veteran),
        disability: safeStr(r.disability),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO candidates (id,first_name,last_name,name,email,email2,phone,phone2,mobile,status,source,occupation,company_name,education_degree,salary,salary_low,day_rate,day_rate_low,hourly_rate,hourly_rate_low,employment_preference,custom_text1,custom_text2,custom_text3,custom_text4,custom_text5,custom_text6,custom_text7,custom_text8,custom_text9,custom_text10,custom_text_block1,custom_text_block2,custom_text_block3,custom_int1,custom_int2,custom_int3,custom_float1,custom_float2,custom_float3,custom_date1,custom_date2,custom_date3,description,date_available,date_added,date_last_modified,date_last_comment,date_of_birth,address_city,address_state,address_zip,address_country,address_address1,address_address2,owner_id,owner_name,skill_list,category_id,federal_additional_withholdings_amount,experience,will_relocate,ethnicity,gender,veteran,disability,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        first_name=$2,last_name=$3,name=$4,email=$5,email2=$6,phone=$7,phone2=$8,mobile=$9,status=$10,source=$11,occupation=$12,company_name=$13,education_degree=$14,salary=$15,salary_low=$16,day_rate=$17,day_rate_low=$18,hourly_rate=$19,hourly_rate_low=$20,employment_preference=$21,custom_text1=$22,custom_text2=$23,custom_text3=$24,custom_text4=$25,custom_text5=$26,custom_text6=$27,custom_text7=$28,custom_text8=$29,custom_text9=$30,custom_text10=$31,custom_text_block1=$32,custom_text_block2=$33,custom_text_block3=$34,custom_int1=$35,custom_int2=$36,custom_int3=$37,custom_float1=$38,custom_float2=$39,custom_float3=$40,custom_date1=$41,custom_date2=$42,custom_date3=$43,description=$44,date_available=$45,date_added=$46,date_last_modified=$47,date_last_comment=$48,date_of_birth=$49,address_city=$50,address_state=$51,address_zip=$52,address_country=$53,address_address1=$54,address_address2=$55,owner_id=$56,owner_name=$57,skill_list=$58,category_id=$59,federal_additional_withholdings_amount=$60,experience=$61,will_relocate=$62,ethnicity=$63,gender=$64,veteran=$65,disability=$66,raw_json=$67::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.first_name,t.last_name,t.name,t.email,t.email2,t.phone,t.phone2,t.mobile,t.status,t.source,t.occupation,t.company_name,t.education_degree,t.salary,t.salary_low,t.day_rate,t.day_rate_low,t.hourly_rate,t.hourly_rate_low,t.employment_preference,t.custom_text1,t.custom_text2,t.custom_text3,t.custom_text4,t.custom_text5,t.custom_text6,t.custom_text7,t.custom_text8,t.custom_text9,t.custom_text10,t.custom_text_block1,t.custom_text_block2,t.custom_text_block3,t.custom_int1,t.custom_int2,t.custom_int3,t.custom_float1,t.custom_float2,t.custom_float3,t.custom_date1,t.custom_date2,t.custom_date3,t.description,t.date_available,t.date_added,t.date_last_modified,t.date_last_comment,t.date_of_birth,t.address_city,t.address_state,t.address_zip,t.address_country,t.address_address1,t.address_address2,t.owner_id,t.owner_name,t.skill_list,t.category_id,t.federal_additional_withholdings_amount,t.experience,t.will_relocate,t.ethnicity,t.gender,t.veteran,t.disability,t.raw_json];
    },
  },

  jobs: {
    endpoint: "search/JobOrder",
    queryField: "query",
    baseQuery: "isDeleted:0",
    fields: JOB_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var addr = r.address || {};
      var cc = r.clientCorporation || {};
      return {
        id: r.id,
        title: safeStr(r.title),
        type: safeNum(r.type),
        status: safeStr(r.status),
        employment_type: safeStr(r.employmentType),
        client_id: cc.id || null,
        client_name: safeStr(cc.name),
        num_openings: safeNum(r.numOpenings),
        salary: safeNum(r.salary),
        salary_unit: safeStr(r.salaryUnit),
        pay_rate: safeNum(r.payRate),
        client_bill_rate: safeNum(r.clientBillRate),
        fee_arrangement: safeNum(r.feeArrangement),
        on_site: safeStr(r.onSite),
        years_required: safeNum(r.yearsRequired),
        start_date: safeNum(r.startDate),
        date_end: safeNum(r.dateEnd),
        date_added: safeNum(r.dateAdded),
        date_last_modified: safeNum(r.dateLastModified),
        date_closed: safeNum(r.dateClosed),
        description: safeStr(r.description),
        public_description: safeStr(r.publicDescription),
        address_city: safeStr(addr.city),
        address_state: safeStr(addr.state),
        address_zip: safeStr(addr.zip),
        address_country: safeStr(addr.countryName || addr.countryID),
        owner_id: r.owner ? r.owner.id : null,
        owner_name: ownerName(r.owner),
        custom_text1: safeStr(r.customText1),
        custom_text2: safeStr(r.customText2),
        custom_text3: safeStr(r.customText3),
        custom_text4: safeStr(r.customText4),
        custom_text5: safeStr(r.customText5),
        custom_text6: safeStr(r.customText6),
        custom_text7: safeStr(r.customText7),
        custom_text_block1: safeStr(r.customTextBlock1),
        custom_text_block2: safeStr(r.customTextBlock2),
        custom_int1: safeNum(r.customInt1),
        custom_int2: safeNum(r.customInt2),
        custom_int3: safeNum(r.customInt3),
        custom_float1: safeNum(r.customFloat1),
        custom_float2: safeNum(r.customFloat2),
        custom_date1: safeNum(r.customDate1),
        custom_date2: safeNum(r.customDate2),
        skill_list: safeStr(r.skillList),
        duration_weeks: safeNum(r.durationWeeks),
        is_open: safeBool(r.isOpen),
        is_deleted: safeBool(r.isDeleted),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO jobs (id,title,type,status,employment_type,client_id,client_name,num_openings,salary,salary_unit,pay_rate,client_bill_rate,fee_arrangement,on_site,years_required,start_date,date_end,date_added,date_last_modified,date_closed,description,public_description,address_city,address_state,address_zip,address_country,owner_id,owner_name,custom_text1,custom_text2,custom_text3,custom_text4,custom_text5,custom_text6,custom_text7,custom_text_block1,custom_text_block2,custom_int1,custom_int2,custom_int3,custom_float1,custom_float2,custom_date1,custom_date2,skill_list,duration_weeks,is_open,is_deleted,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        title=$2,type=$3,status=$4,employment_type=$5,client_id=$6,client_name=$7,num_openings=$8,salary=$9,salary_unit=$10,pay_rate=$11,client_bill_rate=$12,fee_arrangement=$13,on_site=$14,years_required=$15,start_date=$16,date_end=$17,date_added=$18,date_last_modified=$19,date_closed=$20,description=$21,public_description=$22,address_city=$23,address_state=$24,address_zip=$25,address_country=$26,owner_id=$27,owner_name=$28,custom_text1=$29,custom_text2=$30,custom_text3=$31,custom_text4=$32,custom_text5=$33,custom_text6=$34,custom_text7=$35,custom_text_block1=$36,custom_text_block2=$37,custom_int1=$38,custom_int2=$39,custom_int3=$40,custom_float1=$41,custom_float2=$42,custom_date1=$43,custom_date2=$44,skill_list=$45,duration_weeks=$46,is_open=$47,is_deleted=$48,raw_json=$49::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.title,t.type,t.status,t.employment_type,t.client_id,t.client_name,t.num_openings,t.salary,t.salary_unit,t.pay_rate,t.client_bill_rate,t.fee_arrangement,t.on_site,t.years_required,t.start_date,t.date_end,t.date_added,t.date_last_modified,t.date_closed,t.description,t.public_description,t.address_city,t.address_state,t.address_zip,t.address_country,t.owner_id,t.owner_name,t.custom_text1,t.custom_text2,t.custom_text3,t.custom_text4,t.custom_text5,t.custom_text6,t.custom_text7,t.custom_text_block1,t.custom_text_block2,t.custom_int1,t.custom_int2,t.custom_int3,t.custom_float1,t.custom_float2,t.custom_date1,t.custom_date2,t.skill_list,t.duration_weeks,t.is_open,t.is_deleted,t.raw_json];
    },
  },

  placements: {
    endpoint: "query/Placement",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: PLACEMENT_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var cand = r.candidate || {};
      var jo = r.jobOrder || {};
      var cc = jo.clientCorporation || {};
      var hm = r.housingManager || {};
      var ru = r.referringUser || {};
      return {
        id: r.id,
        candidate_id: cand.id || null,
        candidate_name: ((cand.firstName || "") + " " + (cand.lastName || "")).trim(),
        job_id: jo.id || null,
        job_title: safeStr(jo.title),
        client_id: cc.id || null,
        client_name: safeStr(cc.name),
        status: safeStr(r.status),
        employment_type: safeStr(r.employmentType),
        date_begin: safeNum(r.dateBegin),
        date_end: safeNum(r.dateEnd),
        date_added: safeNum(r.dateAdded),
        date_last_modified: safeNum(r.dateLastModified),
        pay_rate: safeNum(r.payRate),
        client_bill_rate: safeNum(r.clientBillRate),
        salary: safeNum(r.salary),
        salary_unit: safeStr(r.salaryUnit),
        fee: safeNum(r.fee),
        overtime_rate: safeNum(r.overtimeRate),
        client_overtime_rate: safeNum(r.clientOvertimeRate),
        double_time_rate: safeNum(r.doubleTimeRate),
        hours_per_day: safeNum(r.hoursPerDay),
        days_per_week: safeNum(r.daysPerWeek),
        housing_manager_id: hm.id || null,
        housing_manager_name: ownerName(hm),
        referring_user_id: ru.id || null,
        referring_user_name: ownerName(ru),
        custom_text1: safeStr(r.customText1),
        custom_text2: safeStr(r.customText2),
        custom_text3: safeStr(r.customText3),
        custom_text4: safeStr(r.customText4),
        custom_text5: safeStr(r.customText5),
        custom_float1: safeNum(r.customFloat1),
        custom_float2: safeNum(r.customFloat2),
        custom_float3: safeNum(r.customFloat3),
        custom_int1: safeNum(r.customInt1),
        custom_int2: safeNum(r.customInt2),
        custom_date1: safeNum(r.customDate1),
        custom_text_block1: safeStr(r.customTextBlock1),
        correlation_id: safeStr(r.correlationId),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO placements (id,candidate_id,candidate_name,job_id,job_title,client_id,client_name,status,employment_type,date_begin,date_end,date_added,date_last_modified,pay_rate,client_bill_rate,salary,salary_unit,fee,overtime_rate,client_overtime_rate,double_time_rate,hours_per_day,days_per_week,housing_manager_id,housing_manager_name,referring_user_id,referring_user_name,custom_text1,custom_text2,custom_text3,custom_text4,custom_text5,custom_float1,custom_float2,custom_float3,custom_int1,custom_int2,custom_date1,custom_text_block1,correlation_id,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        candidate_id=$2,candidate_name=$3,job_id=$4,job_title=$5,client_id=$6,client_name=$7,status=$8,employment_type=$9,date_begin=$10,date_end=$11,date_added=$12,date_last_modified=$13,pay_rate=$14,client_bill_rate=$15,salary=$16,salary_unit=$17,fee=$18,overtime_rate=$19,client_overtime_rate=$20,double_time_rate=$21,hours_per_day=$22,days_per_week=$23,housing_manager_id=$24,housing_manager_name=$25,referring_user_id=$26,referring_user_name=$27,custom_text1=$28,custom_text2=$29,custom_text3=$30,custom_text4=$31,custom_text5=$32,custom_float1=$33,custom_float2=$34,custom_float3=$35,custom_int1=$36,custom_int2=$37,custom_date1=$38,custom_text_block1=$39,correlation_id=$40,raw_json=$41::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.candidate_id,t.candidate_name,t.job_id,t.job_title,t.client_id,t.client_name,t.status,t.employment_type,t.date_begin,t.date_end,t.date_added,t.date_last_modified,t.pay_rate,t.client_bill_rate,t.salary,t.salary_unit,t.fee,t.overtime_rate,t.client_overtime_rate,t.double_time_rate,t.hours_per_day,t.days_per_week,t.housing_manager_id,t.housing_manager_name,t.referring_user_id,t.referring_user_name,t.custom_text1,t.custom_text2,t.custom_text3,t.custom_text4,t.custom_text5,t.custom_float1,t.custom_float2,t.custom_float3,t.custom_int1,t.custom_int2,t.custom_date1,t.custom_text_block1,t.correlation_id,t.raw_json];
    },
  },

  clients: {
    endpoint: "query/ClientCorporation",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: CLIENT_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var addr = r.address || {};
      var ba = r.billingAddress || {};
      return {
        id: r.id,
        name: safeStr(r.name),
        status: safeStr(r.status),
        company_url: safeStr(r.companyURL),
        phone: safeStr(r.phone),
        fax_phone: safeStr(r.faxPhone),
        industry_list: safeStr(r.industryList),
        num_employees: safeNum(r.numEmployees),
        revenue: safeStr(r.revenue),
        notes: safeStr(r.notes),
        address_city: safeStr(addr.city),
        address_state: safeStr(addr.state),
        address_zip: safeStr(addr.zip),
        address_country: safeStr(addr.countryName || addr.countryID),
        address_address1: safeStr(addr.address1),
        billing_city: safeStr(ba.city),
        billing_state: safeStr(ba.state),
        billing_zip: safeStr(ba.zip),
        billing_phone: safeStr(r.billingPhone),
        billing_contact: safeStr(r.billingContact),
        custom_text1: safeStr(r.customText1),
        custom_text2: safeStr(r.customText2),
        custom_text3: safeStr(r.customText3),
        custom_text4: safeStr(r.customText4),
        custom_text5: safeStr(r.customText5),
        custom_int1: safeNum(r.customInt1),
        custom_int2: safeNum(r.customInt2),
        custom_float1: safeNum(r.customFloat1),
        custom_date1: safeNum(r.customDate1),
        custom_text_block1: safeStr(r.customTextBlock1),
        owner_id: r.owner ? r.owner.id : null,
        owner_name: ownerName(r.owner),
        owner_email: r.owner ? safeStr(r.owner.email) : "",
        date_added: safeNum(r.dateAdded),
        date_last_modified: safeNum(r.dateLastModified),
        date_founded: safeStr(r.dateFounded),
        facebook_profile_name: safeStr(r.facebookProfileName),
        linkedin_profile_name: safeStr(r.linkedinProfileName),
        twitter_handle: safeStr(r.twitterHandle),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO clients (id,name,status,company_url,phone,fax_phone,industry_list,num_employees,revenue,notes,address_city,address_state,address_zip,address_country,address_address1,billing_city,billing_state,billing_zip,billing_phone,billing_contact,custom_text1,custom_text2,custom_text3,custom_text4,custom_text5,custom_int1,custom_int2,custom_float1,custom_date1,custom_text_block1,owner_id,owner_name,owner_email,date_added,date_last_modified,date_founded,facebook_profile_name,linkedin_profile_name,twitter_handle,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        name=$2,status=$3,company_url=$4,phone=$5,fax_phone=$6,industry_list=$7,num_employees=$8,revenue=$9,notes=$10,address_city=$11,address_state=$12,address_zip=$13,address_country=$14,address_address1=$15,billing_city=$16,billing_state=$17,billing_zip=$18,billing_phone=$19,billing_contact=$20,custom_text1=$21,custom_text2=$22,custom_text3=$23,custom_text4=$24,custom_text5=$25,custom_int1=$26,custom_int2=$27,custom_float1=$28,custom_date1=$29,custom_text_block1=$30,owner_id=$31,owner_name=$32,owner_email=$33,date_added=$34,date_last_modified=$35,date_founded=$36,facebook_profile_name=$37,linkedin_profile_name=$38,twitter_handle=$39,raw_json=$40::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.name,t.status,t.company_url,t.phone,t.fax_phone,t.industry_list,t.num_employees,t.revenue,t.notes,t.address_city,t.address_state,t.address_zip,t.address_country,t.address_address1,t.billing_city,t.billing_state,t.billing_zip,t.billing_phone,t.billing_contact,t.custom_text1,t.custom_text2,t.custom_text3,t.custom_text4,t.custom_text5,t.custom_int1,t.custom_int2,t.custom_float1,t.custom_date1,t.custom_text_block1,t.owner_id,t.owner_name,t.owner_email,t.date_added,t.date_last_modified,t.date_founded,t.facebook_profile_name,t.linkedin_profile_name,t.twitter_handle,t.raw_json];
    },
  },

  submissions: {
    endpoint: "query/JobSubmission",
    queryField: "where",
    baseQuery: "isDeleted=false",
    fields: SUBMISSION_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var cand = r.candidate || {};
      var jo = r.jobOrder || {};
      var cc = jo.clientCorporation || {};
      var su = r.sendingUser || {};
      return {
        id: r.id,
        candidate_id: cand.id || null,
        candidate_name: ((cand.firstName || "") + " " + (cand.lastName || "")).trim(),
        job_id: jo.id || null,
        job_title: safeStr(jo.title),
        client_id: cc.id || null,
        client_name: safeStr(cc.name),
        status: safeStr(r.status),
        source: safeStr(r.source),
        date_added: safeNum(r.dateAdded),
        date_last_modified: safeNum(r.dateLastModified),
        date_web_response: safeNum(r.dateWebResponse),
        sending_user_id: su.id || null,
        sending_user: ownerName(su),
        pay_rate: safeNum(r.payRate),
        client_bill_rate: safeNum(r.clientBillRate),
        salary: safeNum(r.salary),
        comments: safeStr(r.comments),
        custom_text1: safeStr(r.customText1),
        custom_text2: safeStr(r.customText2),
        custom_text3: safeStr(r.customText3),
        custom_text4: safeStr(r.customText4),
        custom_text5: safeStr(r.customText5),
        custom_int1: safeNum(r.customInt1),
        custom_int2: safeNum(r.customInt2),
        custom_float1: safeNum(r.customFloat1),
        custom_date1: safeNum(r.customDate1),
        custom_text_block1: safeStr(r.customTextBlock1),
        is_deleted: safeBool(r.isDeleted),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO submissions (id,candidate_id,candidate_name,job_id,job_title,client_id,client_name,status,source,date_added,date_last_modified,date_web_response,sending_user_id,sending_user,pay_rate,client_bill_rate,salary,comments,custom_text1,custom_text2,custom_text3,custom_text4,custom_text5,custom_int1,custom_int2,custom_float1,custom_date1,custom_text_block1,is_deleted,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        candidate_id=$2,candidate_name=$3,job_id=$4,job_title=$5,client_id=$6,client_name=$7,status=$8,source=$9,date_added=$10,date_last_modified=$11,date_web_response=$12,sending_user_id=$13,sending_user=$14,pay_rate=$15,client_bill_rate=$16,salary=$17,comments=$18,custom_text1=$19,custom_text2=$20,custom_text3=$21,custom_text4=$22,custom_text5=$23,custom_int1=$24,custom_int2=$25,custom_float1=$26,custom_date1=$27,custom_text_block1=$28,is_deleted=$29,raw_json=$30::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.candidate_id,t.candidate_name,t.job_id,t.job_title,t.client_id,t.client_name,t.status,t.source,t.date_added,t.date_last_modified,t.date_web_response,t.sending_user_id,t.sending_user,t.pay_rate,t.client_bill_rate,t.salary,t.comments,t.custom_text1,t.custom_text2,t.custom_text3,t.custom_text4,t.custom_text5,t.custom_int1,t.custom_int2,t.custom_float1,t.custom_date1,t.custom_text_block1,t.is_deleted,t.raw_json];
    },
  },

  notes: {
    endpoint: "search/Note",
    queryField: "query",
    baseQuery: "isDeleted:0",
    fields: NOTE_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var pr = r.personReference || {};
      var cc = r.clientCorporation || {};
      var jo = r.jobOrder || {};
      var pl = r.placement || {};
      var cp = r.commentingPerson || {};
      return {
        id: r.id,
        person_id: pr.id || null,
        client_id: cc.id || null,
        job_order_id: jo.id || null,
        placement_id: pl.id || null,
        action: safeStr(r.action),
        comments_text: safeStr(r.comments),
        date_added: safeNum(r.dateAdded),
        date_last_modified: safeNum(r.dateLastModified),
        commenting_person_id: cp.id || null,
        commenting_person_name: ownerName(cp),
        is_deleted: safeBool(r.isDeleted),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO notes (id,person_id,client_id,job_order_id,placement_id,action,comments_text,date_added,date_last_modified,commenting_person_id,commenting_person_name,is_deleted,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        person_id=$2,client_id=$3,job_order_id=$4,placement_id=$5,action=$6,comments_text=$7,date_added=$8,date_last_modified=$9,commenting_person_id=$10,commenting_person_name=$11,is_deleted=$12,raw_json=$13::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.person_id,t.client_id,t.job_order_id,t.placement_id,t.action,t.comments_text,t.date_added,t.date_last_modified,t.commenting_person_id,t.commenting_person_name,t.is_deleted,t.raw_json];
    },
  },

  opportunities: {
    endpoint: "query/Opportunity",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: OPPORTUNITY_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var cc = r.clientCorporation || {};
      return {
        id: r.id, title: safeStr(r.title), type: safeStr(r.type), status: safeStr(r.status),
        client_id: cc.id || null, client_name: safeStr(cc.name),
        owner_id: r.owner ? r.owner.id : null, owner_name: ownerName(r.owner),
        estimated_start: safeNum(r.estimatedStartDate), estimated_end: safeNum(r.estimatedEndDate),
        estimated_hours: safeNum(r.estimatedHoursPerWeek),
        estimated_bill_rate: safeNum(r.estimatedBillRate), estimated_pay_rate: safeNum(r.estimatedPayRate),
        estimated_revenue: null, salary: safeNum(r.salary),
        num_openings: safeNum(r.numOpenings), win_probability: safeNum(r.winProbabilityPercent),
        weighted_deal_value: safeNum(r.weightedDealValue), deal_value: safeNum(r.dealValue),
        commission: safeNum(r.commission),
        date_added: safeNum(r.dateAdded), date_last_modified: safeNum(r.dateLastModified),
        description: safeStr(r.description), lead: safeStr(r.lead), source: safeStr(r.source),
        reason_closed: safeStr(r.reasonClosed),
        custom_text1: safeStr(r.customText1), custom_text2: safeStr(r.customText2),
        custom_text3: safeStr(r.customText3), custom_text4: safeStr(r.customText4),
        custom_text5: safeStr(r.customText5), custom_text6: safeStr(r.customText6),
        custom_text7: safeStr(r.customText7), custom_text8: safeStr(r.customText8),
        custom_text9: safeStr(r.customText9), custom_text10: safeStr(r.customText10),
        custom_text_block1: safeStr(r.customTextBlock1), custom_text_block2: safeStr(r.customTextBlock2),
        custom_int1: safeNum(r.customInt1), custom_int2: safeNum(r.customInt2), custom_int3: safeNum(r.customInt3),
        custom_float1: safeNum(r.customFloat1), custom_float2: safeNum(r.customFloat2), custom_float3: safeNum(r.customFloat3),
        custom_date1: safeNum(r.customDate1), custom_date2: safeNum(r.customDate2), custom_date3: safeNum(r.customDate3),
        is_deleted: safeBool(r.isDeleted),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO opportunities (id,title,type,status,client_id,client_name,owner_id,owner_name,estimated_start,estimated_end,estimated_hours,estimated_bill_rate,estimated_pay_rate,estimated_revenue,salary,num_openings,win_probability,weighted_deal_value,deal_value,commission,date_added,date_last_modified,description,lead,source,reason_closed,custom_text1,custom_text2,custom_text3,custom_text4,custom_text5,custom_text6,custom_text7,custom_text8,custom_text9,custom_text10,custom_text_block1,custom_text_block2,custom_int1,custom_int2,custom_int3,custom_float1,custom_float2,custom_float3,custom_date1,custom_date2,custom_date3,is_deleted,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        title=$2,type=$3,status=$4,client_id=$5,client_name=$6,owner_id=$7,owner_name=$8,estimated_start=$9,estimated_end=$10,estimated_hours=$11,estimated_bill_rate=$12,estimated_pay_rate=$13,estimated_revenue=$14,salary=$15,num_openings=$16,win_probability=$17,weighted_deal_value=$18,deal_value=$19,commission=$20,date_added=$21,date_last_modified=$22,description=$23,lead=$24,source=$25,reason_closed=$26,custom_text1=$27,custom_text2=$28,custom_text3=$29,custom_text4=$30,custom_text5=$31,custom_text6=$32,custom_text7=$33,custom_text8=$34,custom_text9=$35,custom_text10=$36,custom_text_block1=$37,custom_text_block2=$38,custom_int1=$39,custom_int2=$40,custom_int3=$41,custom_float1=$42,custom_float2=$43,custom_float3=$44,custom_date1=$45,custom_date2=$46,custom_date3=$47,is_deleted=$48,raw_json=$49::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.title,t.type,t.status,t.client_id,t.client_name,t.owner_id,t.owner_name,t.estimated_start,t.estimated_end,t.estimated_hours,t.estimated_bill_rate,t.estimated_pay_rate,t.estimated_revenue,t.salary,t.num_openings,t.win_probability,t.weighted_deal_value,t.deal_value,t.commission,t.date_added,t.date_last_modified,t.description,t.lead,t.source,t.reason_closed,t.custom_text1,t.custom_text2,t.custom_text3,t.custom_text4,t.custom_text5,t.custom_text6,t.custom_text7,t.custom_text8,t.custom_text9,t.custom_text10,t.custom_text_block1,t.custom_text_block2,t.custom_int1,t.custom_int2,t.custom_int3,t.custom_float1,t.custom_float2,t.custom_float3,t.custom_date1,t.custom_date2,t.custom_date3,t.is_deleted,t.raw_json];
    },
  },

  client_contacts: {
    endpoint: "query/ClientContact",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: CLIENT_CONTACT_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var cc = r.clientCorporation || {};
      var addr = r.address || {};
      return {
        id: r.id, first_name: safeStr(r.firstName), last_name: safeStr(r.lastName),
        name: safeStr(r.name || ((r.firstName || "") + " " + (r.lastName || "")).trim()),
        email: safeStr(r.email), email2: safeStr(r.email2),
        phone: safeStr(r.phone), phone2: safeStr(r.phone2), mobile: safeStr(r.mobile),
        type: safeStr(r.type), status: safeStr(r.status),
        occupation: safeStr(r.occupation), division: safeStr(r.division),
        client_id: cc.id || null, client_name: safeStr(cc.name),
        owner_id: r.owner ? r.owner.id : null, owner_name: ownerName(r.owner),
        address_city: safeStr(addr.city), address_state: safeStr(addr.state), address_zip: safeStr(addr.zip),
        date_added: safeNum(r.dateAdded), date_last_modified: safeNum(r.dateLastModified),
        date_last_comment: safeNum(r.dateLastComment), description: safeStr(r.description),
        custom_text1: safeStr(r.customText1), custom_text2: safeStr(r.customText2),
        custom_text3: safeStr(r.customText3), custom_text4: safeStr(r.customText4),
        custom_text5: safeStr(r.customText5),
        custom_int1: safeNum(r.customInt1), custom_int2: safeNum(r.customInt2),
        custom_float1: safeNum(r.customFloat1), custom_date1: safeNum(r.customDate1),
        custom_text_block1: safeStr(r.customTextBlock1),
        is_deleted: safeBool(r.isDeleted),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO client_contacts (id,first_name,last_name,name,email,email2,phone,phone2,mobile,type,status,occupation,division,client_id,client_name,owner_id,owner_name,address_city,address_state,address_zip,date_added,date_last_modified,date_last_comment,description,custom_text1,custom_text2,custom_text3,custom_text4,custom_text5,custom_int1,custom_int2,custom_float1,custom_date1,custom_text_block1,is_deleted,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        first_name=$2,last_name=$3,name=$4,email=$5,email2=$6,phone=$7,phone2=$8,mobile=$9,type=$10,status=$11,occupation=$12,division=$13,client_id=$14,client_name=$15,owner_id=$16,owner_name=$17,address_city=$18,address_state=$19,address_zip=$20,date_added=$21,date_last_modified=$22,date_last_comment=$23,description=$24,custom_text1=$25,custom_text2=$26,custom_text3=$27,custom_text4=$28,custom_text5=$29,custom_int1=$30,custom_int2=$31,custom_float1=$32,custom_date1=$33,custom_text_block1=$34,is_deleted=$35,raw_json=$36::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.first_name,t.last_name,t.name,t.email,t.email2,t.phone,t.phone2,t.mobile,t.type,t.status,t.occupation,t.division,t.client_id,t.client_name,t.owner_id,t.owner_name,t.address_city,t.address_state,t.address_zip,t.date_added,t.date_last_modified,t.date_last_comment,t.description,t.custom_text1,t.custom_text2,t.custom_text3,t.custom_text4,t.custom_text5,t.custom_int1,t.custom_int2,t.custom_float1,t.custom_date1,t.custom_text_block1,t.is_deleted,t.raw_json];
    },
  },

  corporate_users: {
    endpoint: "query/CorporateUser",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: CORPORATE_USER_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      return {
        id: r.id, first_name: safeStr(r.firstName), last_name: safeStr(r.lastName),
        name: safeStr(r.name || ((r.firstName || "") + " " + (r.lastName || "")).trim()),
        email: safeStr(r.email), email2: safeStr(r.email2),
        phone: safeStr(r.phone), mobile: safeStr(r.mobile),
        username: safeStr(r.username), occupation: safeStr(r.occupation),
        status: safeStr(r.status),
        is_locked: safeBool(r.isLocked), is_deleted: safeBool(r.isDeleted),
        date_last_modified: safeNum(r.dateLastModified),
        primary_department_id: r.primaryDepartment ? r.primaryDepartment.id : null,
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO corporate_users (id,first_name,last_name,name,email,email2,phone,mobile,username,occupation,status,is_locked,is_deleted,date_last_modified,primary_department_id,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        first_name=$2,last_name=$3,name=$4,email=$5,email2=$6,phone=$7,mobile=$8,username=$9,occupation=$10,status=$11,is_locked=$12,is_deleted=$13,date_last_modified=$14,primary_department_id=$15,raw_json=$16::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.first_name,t.last_name,t.name,t.email,t.email2,t.phone,t.mobile,t.username,t.occupation,t.status,t.is_locked,t.is_deleted,t.date_last_modified,t.primary_department_id,t.raw_json];
    },
  },

  sendouts: {
    endpoint: "query/Sendout",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: SENDOUT_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var cand = r.candidate || {};
      var jo = r.jobOrder || {};
      var cc = r.clientCorporation || {};
      var contact = r.clientContact || {};
      var su = r.sendingUser || {};
      return {
        id: r.id,
        candidate_id: cand.id || null, candidate_name: ((cand.firstName || "") + " " + (cand.lastName || "")).trim(),
        job_id: jo.id || null, job_title: safeStr(jo.title),
        client_id: cc.id || null, client_name: safeStr(cc.name),
        client_contact_id: contact.id || null, client_contact_name: ownerName(contact),
        status: safeStr(r.status),
        date_added: safeNum(r.dateAdded), date_last_modified: safeNum(r.dateLastModified),
        sending_user_id: su.id || null, sending_user_name: ownerName(su),
        is_read: safeBool(r.isRead),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO sendouts (id,candidate_id,candidate_name,job_id,job_title,client_id,client_name,client_contact_id,client_contact_name,status,date_added,date_last_modified,sending_user_id,sending_user_name,is_read,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        candidate_id=$2,candidate_name=$3,job_id=$4,job_title=$5,client_id=$6,client_name=$7,client_contact_id=$8,client_contact_name=$9,status=$10,date_added=$11,date_last_modified=$12,sending_user_id=$13,sending_user_name=$14,is_read=$15,raw_json=$16::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.candidate_id,t.candidate_name,t.job_id,t.job_title,t.client_id,t.client_name,t.client_contact_id,t.client_contact_name,t.status,t.date_added,t.date_last_modified,t.sending_user_id,t.sending_user_name,t.is_read,t.raw_json];
    },
  },

  appointments: {
    endpoint: "query/Appointment",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: APPOINTMENT_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var cand = r.candidateReference || {};
      var contact = r.clientContactReference || {};
      var jo = r.jobOrder || {};
      var pl = r.placement || {};
      return {
        id: r.id, subject: safeStr(r.subject), type: safeStr(r.type), description: safeStr(r.description),
        candidate_id: cand.id || null, client_contact_id: contact.id || null,
        job_id: jo.id || null, placement_id: pl.id || null,
        owner_id: r.owner ? r.owner.id : null, owner_name: ownerName(r.owner),
        date_begin: safeNum(r.dateBegin), date_end: safeNum(r.dateEnd),
        date_added: safeNum(r.dateAdded), date_last_modified: safeNum(r.dateLastModified),
        is_deleted: safeBool(r.isDeleted),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO appointments (id,subject,type,description,candidate_id,client_contact_id,job_id,placement_id,owner_id,owner_name,date_begin,date_end,date_added,date_last_modified,is_deleted,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        subject=$2,type=$3,description=$4,candidate_id=$5,client_contact_id=$6,job_id=$7,placement_id=$8,owner_id=$9,owner_name=$10,date_begin=$11,date_end=$12,date_added=$13,date_last_modified=$14,is_deleted=$15,raw_json=$16::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.subject,t.type,t.description,t.candidate_id,t.client_contact_id,t.job_id,t.placement_id,t.owner_id,t.owner_name,t.date_begin,t.date_end,t.date_added,t.date_last_modified,t.is_deleted,t.raw_json];
    },
  },

  tasks: {
    endpoint: "query/Task",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: TASK_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var cand = r.candidateReference || {};
      var contact = r.clientContactReference || {};
      var jo = r.jobOrder || {};
      var pl = r.placement || {};
      return {
        id: r.id, subject: safeStr(r.subject), type: safeStr(r.type), description: safeStr(r.description),
        status: safeStr(r.status),
        candidate_id: cand.id || null, client_contact_id: contact.id || null,
        job_id: jo.id || null, placement_id: pl.id || null,
        owner_id: r.owner ? r.owner.id : null, owner_name: ownerName(r.owner),
        date_begin: safeNum(r.dateBegin), date_end: safeNum(r.dateEnd),
        date_added: safeNum(r.dateAdded), date_last_modified: safeNum(r.dateLastModified),
        date_completed: safeNum(r.dateCompleted),
        is_deleted: safeBool(r.isDeleted), is_completed: safeBool(r.isCompleted),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO tasks (id,subject,type,description,status,candidate_id,client_contact_id,job_id,placement_id,owner_id,owner_name,date_begin,date_end,date_added,date_last_modified,date_completed,is_deleted,is_completed,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        subject=$2,type=$3,description=$4,status=$5,candidate_id=$6,client_contact_id=$7,job_id=$8,placement_id=$9,owner_id=$10,owner_name=$11,date_begin=$12,date_end=$13,date_added=$14,date_last_modified=$15,date_completed=$16,is_deleted=$17,is_completed=$18,raw_json=$19::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.subject,t.type,t.description,t.status,t.candidate_id,t.client_contact_id,t.job_id,t.placement_id,t.owner_id,t.owner_name,t.date_begin,t.date_end,t.date_added,t.date_last_modified,t.date_completed,t.is_deleted,t.is_completed,t.raw_json];
    },
  },

  leads: {
    endpoint: "query/Lead",
    queryField: "where",
    baseQuery: "id IS NOT NULL",
    fields: LEAD_FIELDS,
    sortField: "-dateLastModified",
    transform: function (r) {
      var cc = r.clientCorporation || {};
      return {
        id: r.id, first_name: safeStr(r.firstName), last_name: safeStr(r.lastName),
        name: safeStr(r.name || ((r.firstName || "") + " " + (r.lastName || "")).trim()),
        email: safeStr(r.email), phone: safeStr(r.phone),
        status: safeStr(r.status), source: safeStr(r.source), type: safeStr(r.type),
        client_id: cc.id || null, client_name: safeStr(cc.name),
        owner_id: r.owner ? r.owner.id : null, owner_name: ownerName(r.owner),
        description: safeStr(r.description),
        date_added: safeNum(r.dateAdded), date_last_modified: safeNum(r.dateLastModified),
        is_deleted: safeBool(r.isDeleted),
        custom_text1: safeStr(r.customText1), custom_text2: safeStr(r.customText2), custom_text3: safeStr(r.customText3),
        custom_int1: safeNum(r.customInt1), custom_float1: safeNum(r.customFloat1), custom_date1: safeNum(r.customDate1),
        raw_json: JSON.stringify(r),
      };
    },
    upsertSql: `
      INSERT INTO leads (id,first_name,last_name,name,email,phone,status,source,type,client_id,client_name,owner_id,owner_name,description,date_added,date_last_modified,is_deleted,custom_text1,custom_text2,custom_text3,custom_int1,custom_float1,custom_date1,raw_json,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET
        first_name=$2,last_name=$3,name=$4,email=$5,phone=$6,status=$7,source=$8,type=$9,client_id=$10,client_name=$11,owner_id=$12,owner_name=$13,description=$14,date_added=$15,date_last_modified=$16,is_deleted=$17,custom_text1=$18,custom_text2=$19,custom_text3=$20,custom_int1=$21,custom_float1=$22,custom_date1=$23,raw_json=$24::jsonb,synced_at=NOW()
    `,
    paramsFn: function (t) {
      return [t.id,t.first_name,t.last_name,t.name,t.email,t.phone,t.status,t.source,t.type,t.client_id,t.client_name,t.owner_id,t.owner_name,t.description,t.date_added,t.date_last_modified,t.is_deleted,t.custom_text1,t.custom_text2,t.custom_text3,t.custom_int1,t.custom_float1,t.custom_date1,t.raw_json];
    },
  },
};

/**
 * Sync a single entity type from Bullhorn → Postgres
 * @param {string} entityType - key in SYNC_ENTITIES
 * @param {string} syncType - "full" or "incremental"
 */
async function syncEntity(entityType, syncType) {
  if (!dbReady || !_bhFetchAll) return;
  var config = SYNC_ENTITIES[entityType];
  if (!config) throw new Error("Unknown entity: " + entityType);

  var logId = await startSyncLog(entityType, syncType);

  try {
    // Build query — for incremental, only fetch recently modified records
    var queryOrWhere = config.baseQuery;
    if (syncType === "incremental") {
      var state = await getOne("SELECT * FROM sync_state WHERE entity_type=$1", [entityType]);
      if (state && state.last_incremental_sync) {
        var sinceMs = new Date(state.last_incremental_sync).getTime() - 60000; // 1 min overlap for safety
        if (config.queryField === "query") {
          // search/ endpoint uses Lucene syntax
          queryOrWhere += " AND dateLastModified:[" + sinceMs + " TO *]";
        } else {
          // query/ endpoint uses SQL-like syntax
          queryOrWhere += " AND dateLastModified >= " + sinceMs;
        }
      }
    }

    var params = {
      fields: config.fields,
      count: 500,
    };
    params[config.queryField] = queryOrWhere;
    if (config.queryField === "query") {
      params.sort = config.sortField;
    } else {
      params.orderBy = config.sortField;
    }

    var result = await _bhFetchAll(config.endpoint, params);
    var records = result.data || [];

    // Upsert into Postgres in batches
    var synced = 0;
    for (var i = 0; i < records.length; i++) {
      try {
        var transformed = config.transform(records[i]);
        await query(config.upsertSql, config.paramsFn(transformed));
        synced++;
      } catch (recErr) {
        console.error("[Sync] Error upserting " + entityType + " #" + records[i].id + ":", recErr.message);
      }
    }

    // Update sync state
    var totalRes = await getOne("SELECT COUNT(*) as count FROM " + entityType);
    var total = totalRes ? parseInt(totalRes.count) : 0;
    await query(`
      INSERT INTO sync_state (entity_type, last_full_sync, last_incremental_sync, last_sync_record_count, total_records)
      VALUES ($1, $2, NOW(), $3, $4)
      ON CONFLICT (entity_type) DO UPDATE SET
        last_full_sync = CASE WHEN $5='full' THEN NOW() ELSE sync_state.last_full_sync END,
        last_incremental_sync = NOW(),
        last_sync_record_count = $3,
        total_records = $4
    `, [entityType, syncType === "full" ? new Date() : null, synced, total, syncType]);

    await completeSyncLog(logId, synced, "completed");
    console.log("[Sync] " + syncType + " " + entityType + ": " + synced + " records synced (" + total + " total)");
    return { synced: synced, total: total };
  } catch (err) {
    await completeSyncLog(logId, 0, "failed", err.message);
    console.error("[Sync] " + syncType + " " + entityType + " FAILED:", err.message);
    throw err;
  }
}

async function startSyncLog(entityType, syncType) {
  var res = await query(
    "INSERT INTO sync_log (entity_type, sync_type, started_at) VALUES ($1, $2, NOW()) RETURNING id",
    [entityType, syncType]
  );
  return res.rows[0].id;
}

async function completeSyncLog(logId, count, status, errorMsg) {
  await query(
    "UPDATE sync_log SET completed_at=NOW(), records_synced=$1, status=$2, error_message=$3 WHERE id=$4",
    [count, status, errorMsg || null, logId]
  );
}

/**
 * Run a full sync of all entities
 */
async function fullSync() {
  if (!dbReady) return;
  console.log("[Sync] Starting full sync...");
  var start = Date.now();
  var entities = Object.keys(SYNC_ENTITIES);
  for (var i = 0; i < entities.length; i++) {
    try {
      await syncEntity(entities[i], "full");
    } catch (err) {
      console.error("[Sync] Full sync of " + entities[i] + " failed:", err.message);
      // Continue with other entities
    }
  }
  var elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("[Sync] Full sync complete in " + elapsed + "s");
  lastSyncStatus = { time: new Date(), success: true, message: "Full sync completed in " + elapsed + "s" };
}

/**
 * Run an incremental sync of all entities
 */
async function incrementalSync() {
  if (!dbReady) return;
  var start = Date.now();
  var entities = Object.keys(SYNC_ENTITIES);
  var totalSynced = 0;
  var anyFailed = false;

  for (var i = 0; i < entities.length; i++) {
    try {
      var result = await syncEntity(entities[i], "incremental");
      totalSynced += result.synced;
    } catch (err) {
      anyFailed = true;
      console.error("[Sync] Incremental sync of " + entities[i] + " failed:", err.message);
    }
  }

  var elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (totalSynced > 0) {
    console.log("[Sync] Incremental: " + totalSynced + " records updated in " + elapsed + "s");
  }
  lastSyncStatus = {
    time: new Date(),
    success: !anyFailed,
    message: anyFailed
      ? "Sync completed with errors — " + totalSynced + " records updated"
      : totalSynced > 0
        ? totalSynced + " records updated"
        : "No changes detected",
  };
}

/**
 * Start the sync loop — full sync on first run, then incremental every interval
 */
var syncInterval = null;
async function startSyncLoop(intervalMs) {
  if (!dbReady) return;
  intervalMs = intervalMs || 5 * 60 * 1000; // default 5 minutes

  // Check if we need a full sync (no sync state exists)
  var stateCount = await getOne("SELECT COUNT(*) as count FROM sync_state");
  var needsFull = !stateCount || parseInt(stateCount.count) === 0;

  if (needsFull) {
    console.log("[Sync] No previous sync found — running full sync");
    await fullSync();
  } else {
    console.log("[Sync] Previous sync found — running incremental");
    await incrementalSync();
  }

  // Schedule incremental syncs
  syncInterval = setInterval(async function () {
    try {
      await incrementalSync();
    } catch (err) {
      console.error("[Sync] Scheduled sync error:", err.message);
      lastSyncStatus = { time: new Date(), success: false, message: "Sync failed: " + err.message };
    }
  }, intervalMs);

  console.log("[Sync] Sync loop started — incremental every " + (intervalMs / 1000) + "s");
}

function stopSyncLoop() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/* ═══ STATUS ═══ */
function getSyncStatus() {
  return {
    enabled: isEnabled() && dbReady,
    lastSync: lastSyncStatus,
  };
}

async function getSyncDetails() {
  if (!dbReady) return { enabled: false };
  var states = await getAll("SELECT * FROM sync_state ORDER BY entity_type");
  var recentLogs = await getAll(
    "SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 20"
  );
  return {
    enabled: true,
    lastSync: lastSyncStatus,
    entities: states,
    recentLogs: recentLogs,
  };
}

/* ═══ QUERY FUNCTIONS ═══ */
/* These return data in the same shape the frontend expects,
   so endpoints can swap seamlessly between Postgres and Bullhorn. */

var PRIORITY_LABELS = { 0: "", 1: "Urgent", 2: "Hot", 3: "Warm", 4: "Cold" };
var PRIORITY_MAP = { "Urgent": 1, "Hot": 2, "Warm": 3, "Cold": 4 };

function fmtDate(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US");
}
function fmtMoney(v) {
  if (!v && v !== 0) return "—";
  return "$" + Number(v).toLocaleString();
}

/**
 * Search candidates with filters — returns { data, total } matching /api/candidates shape
 */
async function dbSearchCandidates(filters) {
  if (!dbReady) return null;
  var conditions = ["1=1"];
  var params = [];
  var n = 0;

  if (filters.status && filters.status !== "All") {
    n++; conditions.push("status = $" + n); params.push(filters.status);
  } else {
    // Default: exclude Placed (mirrors existing BH endpoint behavior)
    conditions.push("status != 'Placed'");
  }
  if (filters.q) {
    n++; var q = "%" + filters.q + "%";
    conditions.push("(first_name ILIKE $" + n + " OR last_name ILIKE $" + n + " OR occupation ILIKE $" + n + " OR custom_text1 ILIKE $" + n + " OR custom_text2 ILIKE $" + n + ")");
    params.push(q);
  }
  if (filters.cert) {
    n++; conditions.push("(custom_text1 ILIKE $" + n + " OR custom_text2 ILIKE $" + n + ")");
    params.push("%" + filters.cert + "%");
  }
  if (filters.grade) {
    n++; conditions.push("custom_text6 = $" + n); params.push(filters.grade);
  }
  if (filters.epicRole) {
    n++; conditions.push("custom_text5 ILIKE $" + n); params.push("%" + filters.epicRole + "%");
  }
  if (filters.location) {
    n++; conditions.push("(address_city ILIKE $" + n + " OR address_state ILIKE $" + n + ")");
    params.push("%" + filters.location + "%");
  }
  if (filters.avail === "soon" || filters.avail === "now") {
    var past = Date.now() - 14 * 86400000;
    if (filters.avail === "soon") {
      var future = Date.now() + 14 * 86400000;
      n++; conditions.push("date_available >= $" + n); params.push(past);
      n++; conditions.push("date_available <= $" + n); params.push(future);
    } else {
      n++; conditions.push("date_available <= $" + n); params.push(Date.now());
      n++; conditions.push("date_available >= $" + n); params.push(past);
    }
  } else if (filters.avail === "30days") {
    var past30 = Date.now() - 14 * 86400000;
    var future30 = Date.now() + 30 * 86400000;
    n++; conditions.push("date_available >= $" + n); params.push(past30);
    n++; conditions.push("date_available <= $" + n); params.push(future30);
  }

  var sql = "SELECT * FROM candidates WHERE " + conditions.join(" AND ") + " ORDER BY date_last_modified DESC NULLS LAST";
  var countSql = "SELECT COUNT(*) as count FROM candidates WHERE " + conditions.join(" AND ");

  var rows = (await query(sql, params)).rows;
  var totalRes = await getOne(countSql, params);
  var total = totalRes ? parseInt(totalRes.count) : rows.length;

  var data = rows.map(function (c) {
    return {
      id: c.id,
      firstName: c.first_name || "",
      lastName: c.last_name || "",
      title: c.occupation || "",
      primaryCert: c.custom_text1 || "",
      secondaryCert: c.custom_text2 || "",
      preferredRole: c.custom_text3 || "",
      epicRole: c.custom_text5 || "",
      grade: c.custom_text6 || "",
      urgency: c.custom_text7 || "",
      notes: c.custom_text_block1 || "",
      status: c.status || "Unknown",
      location: [c.address_city, c.address_state].filter(Boolean).join(", "),
      salary: c.salary ? fmtMoney(c.salary) : "—",
      available: c.date_available ? fmtDate(c.date_available) : "—",
      availableRaw: c.date_available || null,
      email: c.email || "",
      phone: c.phone || "",
      lastModified: c.date_last_modified ? fmtDate(c.date_last_modified) : "",
      source: c.source || "",
      owner: c.owner_name || "",
    };
  });

  return { data: data, total: total, source: "db" };
}

/**
 * Search jobs with filters — returns { data, total } matching /api/jobs shape
 */
async function dbSearchJobs(filters) {
  if (!dbReady) return null;
  var conditions = ["1=1"];
  var params = [];
  var n = 0;

  if (filters.status && filters.status !== "All") {
    n++; conditions.push("status = $" + n); params.push(filters.status);
  }
  if (filters.q) {
    n++; var q = "%" + filters.q + "%";
    conditions.push("(title ILIKE $" + n + " OR client_name ILIKE $" + n + ")");
    params.push(q);
  }
  if (filters.priority && PRIORITY_MAP[filters.priority] !== undefined) {
    n++; conditions.push("type = $" + n); params.push(PRIORITY_MAP[filters.priority]);
  }

  var sql = "SELECT * FROM jobs WHERE " + conditions.join(" AND ") + " ORDER BY date_last_modified DESC NULLS LAST";
  var countSql = "SELECT COUNT(*) as count FROM jobs WHERE " + conditions.join(" AND ");

  var rows = (await query(sql, params)).rows;
  var totalRes = await getOne(countSql, params);
  var total = totalRes ? parseInt(totalRes.count) : rows.length;

  // Get submission counts for these jobs
  var jobIds = rows.map(function (j) { return j.id; });
  var subCounts = {};
  if (jobIds.length > 0) {
    try {
      var subRows = await getAll("SELECT job_id, COUNT(*) as cnt FROM submissions WHERE job_id = ANY($1) AND (is_deleted IS NULL OR is_deleted = false) GROUP BY job_id", [jobIds]);
      subRows.forEach(function (r) { subCounts[r.job_id] = parseInt(r.cnt); });
    } catch (e) { /* non-blocking */ }
  }

  var data = rows.map(function (j) {
    var dateAdded = j.date_added ? fmtDate(j.date_added) : "";
    var daysOpen = j.date_added && (j.status === "Accepting Candidates" || j.status === "Open")
      ? Math.floor((Date.now() - j.date_added) / 86400000) : null;
    return {
      id: j.id,
      title: j.title || "",
      client: j.client_name || "",
      location: [j.address_city, j.address_state].filter(Boolean).join(", "),
      type: j.employment_type || "",
      salary: j.salary ? fmtMoney(j.salary) : "—",
      status: j.status || "Unknown",
      priority: PRIORITY_LABELS[j.type] || "",
      openings: j.num_openings || 0,
      submissions: subCounts[j.id] || 0,
      dateAdded: dateAdded,
      daysOpen: daysOpen,
    };
  });

  return { data: data, total: total, source: "db" };
}

/**
 * Search placements with filters — returns { data, total } matching /api/placements shape
 */
async function dbSearchPlacements(filters) {
  if (!dbReady) return null;
  var conditions = ["1=1"];
  var params = [];
  var n = 0;

  if (filters.q) {
    n++; var q = "%" + filters.q + "%";
    conditions.push("(candidate_name ILIKE $" + n + " OR job_title ILIKE $" + n + " OR client_name ILIKE $" + n + ")");
    params.push(q);
  }
  if (filters.status && filters.status !== "All") {
    n++; conditions.push("status = $" + n); params.push(filters.status);
  }
  if (filters.type === "Direct Hire") {
    conditions.push("employment_type = 'Direct Hire'");
  } else if (filters.type === "Consultant") {
    conditions.push("(employment_type = 'Contract' OR employment_type = 'Temp' OR employment_type = 'Temp to Hire')");
  }

  var sql = "SELECT * FROM placements WHERE " + conditions.join(" AND ") + " ORDER BY date_begin DESC NULLS LAST";
  var countSql = "SELECT COUNT(*) as count FROM placements WHERE " + conditions.join(" AND ");

  var rows = (await query(sql, params)).rows;
  var totalRes = await getOne(countSql, params);
  var total = totalRes ? parseInt(totalRes.count) : rows.length;

  var data = rows.map(function (p) {
    var isDH = p.employment_type === "Direct Hire" || p.employment_type === "Permanent";
    var payRate = p.pay_rate || 0;
    var billRate = p.client_bill_rate || 0;
    var margin = billRate > 0 ? Math.round(((billRate - payRate) / billRate) * 100) + "%" : null;

    return {
      id: p.id,
      candidate: p.candidate_name || "",
      job: p.job_title || "",
      client: p.client_name || "",
      startDate: p.date_begin ? fmtDate(p.date_begin) : "",
      endDate: p.date_end ? fmtDate(p.date_end) : null,
      salary: isDH ? (p.salary ? fmtMoney(p.salary) : "—") : (payRate ? "$" + payRate + "/hr" : "—"),
      pt: isDH ? "Direct Hire" : "Consultant",
      status: p.status || "Unknown",
      fee: isDH && p.fee ? fmtMoney(p.fee) : null,
      margin: isDH ? null : margin,
      billRate: isDH ? null : (billRate ? "$" + billRate + "/hr" : null),
      payRate: isDH ? null : (payRate ? "$" + payRate + "/hr" : null),
    };
  });

  return { data: data, total: total, source: "db" };
}

/**
 * Search clients with filters — returns { data, total } matching /api/clients shape
 */
async function dbSearchClients(filters) {
  if (!dbReady) return null;
  var conditions = ["1=1"];
  var params = [];
  var n = 0;

  if (filters.q) {
    n++; conditions.push("name ILIKE $" + n); params.push("%" + filters.q + "%");
  }
  if (filters.status && filters.status !== "All") {
    n++; conditions.push("status = $" + n); params.push(filters.status);
  }

  var sql = "SELECT * FROM clients WHERE " + conditions.join(" AND ") + " ORDER BY date_last_modified DESC NULLS LAST";
  var countSql = "SELECT COUNT(*) as count FROM clients WHERE " + conditions.join(" AND ");

  var rows = (await query(sql, params)).rows;
  var totalRes = await getOne(countSql, params);
  var total = totalRes ? parseInt(totalRes.count) : rows.length;

  // Get active placement counts per client from local DB
  var placByClient = {};
  try {
    var placRows = await getAll("SELECT client_id, candidate_name FROM placements WHERE status = 'Approved' OR status = 'Actively On Contract'");
    placRows.forEach(function (p) {
      if (p.client_id) {
        if (!placByClient[p.client_id]) placByClient[p.client_id] = [];
        placByClient[p.client_id].push({ candidateName: p.candidate_name || "Unknown" });
      }
    });
  } catch (e) { /* non-blocking */ }

  var data = rows.map(function (c) {
    return {
      id: c.id,
      name: c.name || "",
      owner: c.owner_name || "",
      location: [c.address_city, c.address_state].filter(Boolean).join(", "),
      status: c.status || "Unknown",
      activePlacements: placByClient[c.id] ? placByClient[c.id].length : 0,
      placedConsultants: placByClient[c.id] || [],
    };
  });

  return { data: data, total: total, source: "db" };
}

/**
 * Dashboard summary — returns object matching /api/dashboard shape
 */
async function dbGetDashboard() {
  if (!dbReady) return null;
  var now = Date.now();
  var in30Days = now + 30 * 86400000;
  var past7 = now - 7 * 86400000;
  var past7Days = now - 7 * 86400000;
  var future14 = now + 14 * 86400000;

  // Stats
  var activeCands = await getOne("SELECT COUNT(*) as count FROM candidates WHERE status = 'Active'");
  var openJobs = await getOne("SELECT COUNT(*) as count FROM jobs WHERE status = 'Accepting Candidates'");

  // Urgent/Hot jobs (type 1 or 2)
  var urgentRows = (await query(
    "SELECT * FROM jobs WHERE (status = 'Accepting Candidates' OR status = 'Open') AND (type = 1 OR type = 2) ORDER BY type ASC LIMIT 10"
  )).rows;

  // Submission counts for urgent jobs
  var urgentIds = urgentRows.map(function (j) { return j.id; });
  var subCounts = {};
  if (urgentIds.length > 0) {
    try {
      var subRows = await getAll("SELECT job_id, COUNT(*) as cnt FROM submissions WHERE job_id = ANY($1) AND (is_deleted IS NULL OR is_deleted = false) GROUP BY job_id", [urgentIds]);
      subRows.forEach(function (r) { subCounts[r.job_id] = parseInt(r.cnt); });
    } catch (e) { /* non-blocking */ }
  }

  // New candidates (last 7 days)
  var newCandRows = (await query(
    "SELECT * FROM candidates WHERE date_added >= $1 ORDER BY date_added DESC LIMIT 10", [past7]
  )).rows;
  var newCandTotal = await getOne("SELECT COUNT(*) as count FROM candidates WHERE date_added >= $1", [past7]);

  // Expiring placements (next 30 days)
  var expRows = (await query(
    "SELECT * FROM placements WHERE date_end IS NOT NULL AND date_end >= $1 AND date_end <= $2 ORDER BY date_end ASC", [now, in30Days]
  )).rows;

  // Candidates available soon (past 7 days to next 14 days)
  var availRows = (await query(
    "SELECT * FROM candidates WHERE status = 'Active' AND date_available >= $1 AND date_available <= $2 ORDER BY date_available ASC LIMIT 10", [past7Days, future14]
  )).rows;
  var availTotal = await getOne("SELECT COUNT(*) as count FROM candidates WHERE status = 'Active' AND date_available >= $1 AND date_available <= $2", [past7Days, future14]);

  // Count urgent jobs total
  var urgentTotal = await getOne("SELECT COUNT(*) as count FROM jobs WHERE (status = 'Accepting Candidates' OR status = 'Open') AND (type = 1 OR type = 2)");

  return {
    stats: {
      activeCandidates: activeCands ? parseInt(activeCands.count) : 0,
      openJobs: openJobs ? parseInt(openJobs.count) : 0,
    },
    urgentJobs: urgentRows.map(function (j) {
      var daysOpen = j.date_added ? Math.floor((now - j.date_added) / 86400000) : null;
      return {
        id: j.id, title: j.title || "", priority: PRIORITY_LABELS[j.type] || "",
        status: j.status || "", client: j.client_name || "",
        openings: j.num_openings || 0, daysOpen: daysOpen,
        submissions: subCounts[j.id] || 0,
      };
    }),
    urgentJobsTotal: urgentTotal ? parseInt(urgentTotal.count) : 0,
    newCandidates: newCandRows.map(function (c) {
      return {
        id: c.id, name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
        title: c.occupation || "", primaryCert: c.custom_text1 || "",
        grade: c.custom_text6 || "", dateAdded: c.date_added ? fmtDate(c.date_added) : "",
      };
    }),
    newCandidatesTotal: newCandTotal ? parseInt(newCandTotal.count) : 0,
    expiringPlacements: expRows.map(function (p) {
      var daysLeft = p.date_end ? Math.ceil((p.date_end - now) / 86400000) : null;
      return {
        id: p.id, candidate: p.candidate_name || "",
        job: p.job_title || "",
        endDate: p.date_end ? fmtDate(p.date_end) : "",
        daysLeft: daysLeft,
        marginAtRisk: ((p.client_bill_rate || 0) - (p.pay_rate || 0)) * 40 * 4,
      };
    }),
    availableSoon: availRows.map(function (c) {
      return {
        id: c.id, name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
        title: c.occupation || "", primaryCert: c.custom_text1 || "",
        grade: c.custom_text6 || "", available: c.date_available ? fmtDate(c.date_available) : "",
      };
    }),
    availableSoonTotal: availTotal ? parseInt(availTotal.count) : 0,
    source: "db",
  };
}

/**
 * Smart lists — group candidates by primary cert
 */
async function dbGetSmartLists() {
  if (!dbReady) return null;
  var rows = (await query("SELECT * FROM candidates WHERE custom_text1 IS NOT NULL AND custom_text1 != '' ORDER BY date_last_modified DESC NULLS LAST")).rows;
  var totalRes = await getOne("SELECT COUNT(*) as count FROM candidates WHERE custom_text1 IS NOT NULL AND custom_text1 != ''");

  var lists = {};
  rows.forEach(function (c) {
    var cert = (c.custom_text1 || "").trim();
    if (!cert) return;
    var certKeys = cert.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var candidateObj = {
      id: c.id,
      name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
      title: c.occupation || "", status: c.status || "",
      primaryCert: cert, secondaryCert: c.custom_text2 || "",
      epicRole: c.custom_text5 || "", grade: c.custom_text6 || "",
      salary: c.salary ? fmtMoney(c.salary) : "—",
      available: c.date_available ? fmtDate(c.date_available) : "",
      location: [c.address_city, c.address_state].filter(Boolean).join(", "),
      email: c.email || "",
    };
    certKeys.forEach(function (key) {
      if (!lists[key]) lists[key] = { name: key, candidates: [] };
      lists[key].candidates.push(candidateObj);
    });
  });

  var sorted = Object.values(lists).sort(function (a, b) { return b.candidates.length - a.candidates.length; });
  return { lists: sorted, total: totalRes ? parseInt(totalRes.count) : rows.length, source: "db" };
}

/**
 * Stale candidates — not modified in X days
 */
async function dbGetStaleCandidates(days) {
  if (!dbReady) return null;
  var cutoff = Date.now() - days * 86400000;
  var rows = (await query(
    "SELECT * FROM candidates WHERE status = 'Active' AND date_last_modified <= $1 ORDER BY date_last_modified ASC", [cutoff]
  )).rows;
  var totalRes = await getOne("SELECT COUNT(*) as count FROM candidates WHERE status = 'Active' AND date_last_modified <= $1", [cutoff]);

  var data = rows.map(function (c) {
    return {
      id: c.id, name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
      title: c.occupation || "", primaryCert: c.custom_text1 || "",
      grade: c.custom_text6 || "",
      lastModified: c.date_last_modified ? fmtDate(c.date_last_modified) : "",
      daysSinceTouch: c.date_last_modified ? Math.floor((Date.now() - c.date_last_modified) / 86400000) : 999,
      available: c.date_available ? fmtDate(c.date_available) : "—",
    };
  });

  return { data: data, total: totalRes ? parseInt(totalRes.count) : data.length, source: "db" };
}

/**
 * Touch report — stale candidates, consultants, and client contacts
 * A "touch" = the most recent Note (or email action) logged against the person
 */
async function dbGetTouchReport(days) {
  if (!dbReady) return null;
  var cutoff = Date.now() - days * 86400000;
  var nowMs = Date.now();

  // Touch actions that count as real outreach (call, email, meeting, etc.)
  var TOUCH_ACTIONS = "'Email','Phone Call','Left Message','Call','Meeting','Appointment','Interview','Visit','Outreach','Follow Up','Follow-Up','Spoke With','Sent Email','Text','SMS'";

  // Build a lookup of last REAL touch (Note with outreach action or touch-related content) per person_id
  var noteRows = [];
  try {
    noteRows = (await query(
      "SELECT person_id, MAX(date_added) as last_touch, " +
      "(SELECT action FROM notes n2 WHERE n2.person_id = notes.person_id AND n2.date_added = MAX(notes.date_added) LIMIT 1) as last_action " +
      "FROM notes WHERE person_id IS NOT NULL AND (" +
      "action IN (" + TOUCH_ACTIONS + ") OR " +
      "LOWER(comments_text) LIKE '%call%' OR LOWER(comments_text) LIKE '%email%' OR " +
      "LOWER(comments_text) LIKE '%spoke%' OR LOWER(comments_text) LIKE '%touch base%' OR " +
      "LOWER(comments_text) LIKE '%follow up%' OR LOWER(comments_text) LIKE '%follow-up%' OR " +
      "LOWER(comments_text) LIKE '%reached out%' OR LOWER(comments_text) LIKE '%meeting%' OR " +
      "LOWER(comments_text) LIKE '%check in%' OR LOWER(comments_text) LIKE '%check-in%' OR " +
      "LOWER(comments_text) LIKE '%connected%' OR LOWER(comments_text) LIKE '%left message%' OR " +
      "LOWER(comments_text) LIKE '%voicemail%' OR LOWER(comments_text) LIKE '%scheduled%'" +
      ") GROUP BY person_id"
    )).rows;
  } catch (e) { /* notes table might be empty */ }
  var lastTouch = {};
  var lastTouchAction = {};
  noteRows.forEach(function (n) {
    if (n.person_id) {
      lastTouch[n.person_id] = Number(n.last_touch);
      lastTouchAction[n.person_id] = n.last_action || "Note";
    }
  });

  // Build a lookup of last real touch per client_id
  var clientNoteRows = [];
  try {
    clientNoteRows = (await query(
      "SELECT client_id, MAX(date_added) as last_touch FROM notes WHERE client_id IS NOT NULL AND (" +
      "action IN (" + TOUCH_ACTIONS + ") OR " +
      "LOWER(comments_text) LIKE '%call%' OR LOWER(comments_text) LIKE '%email%' OR " +
      "LOWER(comments_text) LIKE '%touch base%' OR LOWER(comments_text) LIKE '%meeting%'" +
      ") GROUP BY client_id"
    )).rows;
  } catch (e) {}
  var lastClientTouch = {};
  clientNoteRows.forEach(function (n) { if (n.client_id) lastClientTouch[n.client_id] = Number(n.last_touch); });

  // Stale candidates — Active, with an owner (skip unassigned leads)
  var candRows = (await query(
    "SELECT * FROM candidates WHERE status = 'Active' AND owner_id IS NOT NULL ORDER BY date_last_modified ASC"
  )).rows;
  var candidates = candRows.map(function (c) {
    var touch = lastTouch[c.id] || null;
    var touchDate = touch || c.date_last_modified;
    var daysSince = touchDate ? Math.floor((nowMs - touchDate) / 86400000) : 999;
    return {
      id: c.id, type: "Candidate",
      name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
      title: c.occupation || "", primaryCert: c.custom_text1 || "",
      grade: c.custom_text6 || "", email: c.email || "", phone: c.phone || "",
      owner: c.owner_name || "",
      lastTouched: touchDate ? fmtDate(touchDate) : "Never",
      lastTouchType: touch ? (lastTouchAction[c.id] || "Note") : "No outreach logged",
      daysSince: daysSince,
    };
  }).filter(function (c) { return c.daysSince >= days; });
  candidates.sort(function (a, b) { return b.daysSince - a.daysSince; });

  // Active placements — find stale consultants
  var placRows = (await query(
    "SELECT * FROM placements WHERE (status = 'Approved' OR status = 'Actively On Contract' OR status ILIKE '%active%') AND date_end >= $1 ORDER BY date_last_modified ASC", [nowMs]
  )).rows;
  var consultants = placRows.map(function (p) {
    var touch = p.candidate_id ? lastTouch[p.candidate_id] : null;
    var touchDate = touch || p.date_last_modified;
    var daysSince = touchDate ? Math.floor((nowMs - touchDate) / 86400000) : 999;
    return {
      id: p.id, type: "Consultant",
      name: p.candidate_name || "Unknown",
      candidateId: p.candidate_id || null,
      job: p.job_title || "", client: p.client_name || "",
      endsOn: p.date_end ? fmtDate(p.date_end) : "",
      lastTouched: touchDate ? fmtDate(touchDate) : "Never",
      lastTouchType: touch ? "Note" : "Modified",
      daysSince: daysSince,
      payRate: p.pay_rate ? "$" + p.pay_rate + "/hr" : "—",
      billRate: p.client_bill_rate ? "$" + p.client_bill_rate + "/hr" : "—",
    };
  }).filter(function (c) { return c.daysSince >= days; });
  consultants.sort(function (a, b) { return b.daysSince - a.daysSince; });

  // Stale client contacts — Active people assigned to a health system with an owner
  // A touch = last Note logged against their client_id or their person_id
  var ccRows = (await query(
    "SELECT * FROM client_contacts WHERE status = 'Active' AND client_id IS NOT NULL AND owner_id IS NOT NULL ORDER BY date_last_modified ASC"
  )).rows;
  var clients = ccRows.map(function (c) {
    // Check for note against this contact's person ID or their client
    var personTouch = lastTouch[c.id] || null;
    var clientTouch = c.client_id ? lastClientTouch[c.client_id] : null;
    var touch = Math.max(personTouch || 0, clientTouch || 0) || null;
    var touchDate = touch || c.date_last_modified;
    var daysSince = touchDate ? Math.floor((nowMs - touchDate) / 86400000) : 999;
    return {
      id: c.id, type: "Client Contact",
      name: ((c.first_name || "") + " " + (c.last_name || "")).trim(),
      company: c.client_name || "",
      title: c.occupation || "",
      status: c.status || "",
      email: c.email || "", phone: c.phone || "",
      owner: c.owner_name || "",
      location: [c.address_city, c.address_state].filter(Boolean).join(", "),
      lastTouched: touchDate ? fmtDate(touchDate) : "Never",
      lastTouchType: touch ? "Note" : "Modified",
      daysSince: daysSince,
    };
  }).filter(function (c) { return c.daysSince >= days; });
  clients.sort(function (a, b) { return b.daysSince - a.daysSince; });

  return {
    days: days,
    candidates: { data: candidates, total: candTotal ? parseInt(candTotal.count) : candidates.length },
    consultants: { data: consultants, total: consultants.length },
    clients: { data: clients, total: clientTotal ? parseInt(clientTotal.count) : clients.length },
    source: "db",
  };
}

/**
 * Expiring placements — ending within N days
 */
async function dbGetExpiringPlacements(days) {
  if (!dbReady) return null;
  var now = Date.now();
  var future = now + (days || 30) * 86400000;
  var rows = (await query(
    "SELECT * FROM placements WHERE date_end IS NOT NULL AND date_end >= $1 AND date_end <= $2 ORDER BY date_end ASC", [now, future]
  )).rows;

  var data = rows.map(function (p) {
    var daysLeft = p.date_end ? Math.ceil((p.date_end - now) / 86400000) : null;
    return {
      id: p.id, candidate: p.candidate_name || "", job: p.job_title || "",
      client: p.client_name || "",
      endDate: p.date_end ? fmtDate(p.date_end) : "",
      daysLeft: daysLeft,
      marginAtRisk: ((p.client_bill_rate || 0) - (p.pay_rate || 0)) * 40 * 4,
    };
  });

  return { data: data, total: data.length, source: "db" };
}

/**
 * Candidate submissions — for candidate detail view
 */
async function dbGetCandidateSubmissions(candidateId) {
  if (!dbReady) return null;
  var rows = (await query(
    "SELECT * FROM submissions WHERE candidate_id = $1 AND (is_deleted IS NULL OR is_deleted = false) ORDER BY date_added DESC", [candidateId]
  )).rows;

  var data = rows.map(function (s) {
    return {
      id: s.id, job: s.job_title || "", jobId: s.job_id || null,
      status: s.status || "",
      date: s.date_added ? fmtDate(s.date_added) : "",
      submittedBy: s.sending_user || "", source: s.source || "",
    };
  });

  return { data: data, total: data.length, source: "db" };
}

/* ═══ EXPORTS ═══ */
module.exports = {
  init: init,
  isEnabled: isEnabled,
  createTables: createTables,
  query: query,
  getOne: getOne,
  getAll: getAll,
  setBullhornFetchers: setBullhornFetchers,
  syncEntity: syncEntity,
  fullSync: fullSync,
  incrementalSync: incrementalSync,
  startSyncLoop: startSyncLoop,
  stopSyncLoop: stopSyncLoop,
  getSyncStatus: getSyncStatus,
  getSyncDetails: getSyncDetails,
  // Query functions — return data in frontend-ready shapes
  searchCandidates: dbSearchCandidates,
  searchJobs: dbSearchJobs,
  searchPlacements: dbSearchPlacements,
  searchClients: dbSearchClients,
  getDashboard: dbGetDashboard,
  getSmartLists: dbGetSmartLists,
  getStaleCandidates: dbGetStaleCandidates,
  getTouchReport: dbGetTouchReport,
  getExpiringPlacements: dbGetExpiringPlacements,
  getCandidateSubmissions: dbGetCandidateSubmissions,
  get ready() { return dbReady; },
};
