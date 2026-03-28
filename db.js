const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "one_dsd.db");
let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
    initSchema(db);
    saveDb(db);
  }
  return db;
}

function saveDb(database) {
  const data = (database || db).export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initSchema(d) {
  d.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      division TEXT,
      password_hash TEXT,
      reset_token_hash TEXT,
      reset_token_expires_at TEXT,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submitted_by TEXT NOT NULL,
      submitter_email TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      urgency TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'submitted',
      triage_notes TEXT,
      consultant_response TEXT,
      linked_document_ids TEXT DEFAULT '[]',
      linked_activity_ids TEXT DEFAULT '[]',
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deai_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      entered_by TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      raw_description TEXT NOT NULL,
      classified_category TEXT,
      classified_subcategory TEXT,
      confidence_level TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending',
      consultant_notes TEXT,
      linked_consultation_id INTEGER,
      linked_document_id INTEGER,
      outcome_notes TEXT,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      document_type TEXT,
      file_url TEXT,
      file_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      tags TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      uploaded_by TEXT,
      version TEXT DEFAULT '1.0',
      parent_document_id INTEGER,
      ingestion_status TEXT DEFAULT 'pending',
      ingestion_job_id INTEGER,
      extracted_text TEXT,
      extraction_method TEXT,
      extracted_char_count INTEGER,
      ocr_applied INTEGER DEFAULT 0,
      ocr_confidence TEXT,
      ocr_review_recommended INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kpis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      baseline REAL,
      target REAL,
      current_value REAL,
      unit TEXT,
      data_source TEXT,
      reporting_period TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS disparity_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kpi_id INTEGER,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      description TEXT NOT NULL,
      affected_population TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      consultant_notes TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS queue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      priority TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_to TEXT,
      due_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS community_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_type TEXT NOT NULL DEFAULT 'anonymous',
      submitter_name TEXT,
      submitter_email TEXT,
      feedback_text TEXT NOT NULL,
      theme TEXT,
      sentiment TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      consultant_notes TEXT,
      linked_activity_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS community_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      population_name TEXT NOT NULL,
      description TEXT,
      key_barriers TEXT,
      linked_resources TEXT DEFAULT '[]',
      linked_guidance TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS institutional_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      linked_consultation_id INTEGER,
      linked_activity_id INTEGER,
      linked_document_id INTEGER,
      approved_by TEXT,
      approved_at TEXT,
      is_searchable INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      actor_label TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS learning_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      course_type TEXT,
      format TEXT,
      duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      linked_document_id INTEGER,
      tags TEXT DEFAULT '[]',
      completion_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS content_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content_type TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      authored_by TEXT,
      approved_by TEXT,
      approved_at TEXT,
      published_at TEXT,
      archived_at TEXT,
      version INTEGER DEFAULT 1,
      tags TEXT DEFAULT '[]',
      audience_segment_ids TEXT DEFAULT '[]',
      linked_document_id INTEGER,
      linked_activity_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      question TEXT NOT NULL,
      intent TEXT,
      scope TEXT DEFAULT 'all',
      external_research_mode TEXT DEFAULT 'off',
      total_internal_results INTEGER DEFAULT 0,
      live_external_used INTEGER DEFAULT 0,
      output_summary TEXT,
      orchestration_route_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS language_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_type TEXT,
      source_entity_id INTEGER,
      source_title TEXT NOT NULL,
      source_text TEXT,
      source_language TEXT NOT NULL DEFAULT 'English',
      target_language TEXT NOT NULL,
      language_variant TEXT,
      content_type TEXT NOT NULL,
      audience_type TEXT NOT NULL,
      urgency TEXT NOT NULL DEFAULT 'standard',
      request_reason TEXT,
      needs_plain_language INTEGER NOT NULL DEFAULT 0,
      needs_accessibility_review INTEGER NOT NULL DEFAULT 0,
      is_outward_facing INTEGER NOT NULL DEFAULT 0,
      is_update_request INTEGER NOT NULL DEFAULT 0,
      linked_community_profile_id INTEGER,
      linked_consultation_id INTEGER,
      request_status TEXT NOT NULL DEFAULT 'requested',
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      approved_by TEXT,
      approved_at TEXT,
      publication_decision TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS report_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      report_period TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      generated_by TEXT,
      filters TEXT DEFAULT '{}',
      output_summary TEXT,
      output_data TEXT,
      record_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT DEFAULT 'intake',
      error_message TEXT,
      item_count INTEGER DEFAULT 1,
      processed_at TEXT,
      indexed_at TEXT,
      triggered_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audience_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      segment_type TEXT,
      criteria TEXT,
      member_count INTEGER DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orchestration_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_module TEXT NOT NULL,
      target_module TEXT NOT NULL,
      route_type TEXT NOT NULL,
      entity_id INTEGER,
      entity_type TEXT,
      route_context TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      actioned_by TEXT,
      actioned_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed initial data
  seedData(d);
}

function seedData(d) {
  // Seed a consultant user (password: OneDSD2026!)
  d.run(`INSERT OR IGNORE INTO users (email, display_name, role, password_hash, is_active) VALUES 
    ('gary.banks@state.mn.us', 'Gary Banks', 'consultant', '$2a$10$placeholder_will_be_set', 1)`);

  // Seed KPIs
  const kpis = [
    ["Consultations Resolved", "Total consultations closed this fiscal year", "Consultations", 45, 120, 78, "count", "live_data"],
    ["Staff Reached", "Unique DSD staff engaged through equity programs", "Engagement", 80, 180, 134, "count", "live_data"],
    ["DEAI Activities Logged", "Logged DEAI activities in current period", "Activities", 60, 200, 147, "count", "live_data"],
    ["Documents in Knowledge Base", "Active documents available for research", "Knowledge", 20, 100, 67, "count", "live_data"],
    ["Community Feedback Actioned", "Feedback items addressed within 30 days", "Community", 40, 90, 71, "percent", "live_data"],
    ["Avg Consultation Response Time", "Average days from submission to first response", "Quality", 10, 3, 4.2, "days", "live_data"],
    ["Equity Analysis Completions", "Equity analyses completed this fiscal year", "Analysis", 8, 24, 15, "count", "live_data"],
    ["Training Completion Rate", "Staff completing at least one equity learning module", "Learning", 25, 70, 52, "percent", "live_data"],
  ];
  for (const [name, desc, cat, baseline, target, current, unit, source] of kpis) {
    d.run(`INSERT OR IGNORE INTO kpis (name, description, category, baseline, target, current_value, unit, data_source, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`, [name, desc, cat, baseline, target, current, unit, source]);
  }

  // Seed sample consultation
  d.run(`INSERT OR IGNORE INTO consultations (submitted_by, submitter_email, subject, description, urgency, status)
    VALUES ('Test Staff', 'staff@example.com', 'Hmong language access for CFSS program', 
    'We have a family requesting all CFSS program materials in Hmong but our current materials are English-only. Need guidance on language access obligations and available resources.', 
    'high', 'submitted')`);

  // Seed audit log entry
  d.run(`INSERT INTO audit_log (actor_type, actor_label, action, entity_type, details) VALUES
    ('system', 'One DSD Platform', 'platform_initialized', 'system', 'Platform database initialized with seed data')`);

  console.log("✓ Database seeded");
}

// Helper: run a SELECT and return rows as objects
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const result = stmt.getAsObject ? [] : [];
  stmt.bind(sanitize(params));
  while (stmt.step()) result.push(stmt.getAsObject());
  stmt.free();
  return result;
}

function sanitize(p) { return p.map(v => v === undefined ? null : v); }
function run(sql, params = []) {
  db.run(sql, sanitize(params));
  saveDb(db);
}

function runReturning(sql, params = []) {
  db.run(sql, sanitize(params));
  const id = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0];
  saveDb(db);
  return id;
}

module.exports = { getDb, query, run, runReturning, saveDb };
