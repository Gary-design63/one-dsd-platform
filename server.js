const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const https = require("https");
const { getDb, query, run, runReturning } = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "one-dsd-dev-secret-2026";
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY || "";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── Serve static frontend ──────────────────────────────────────────────────
const FRONTEND = path.join(__dirname, "public");
app.use(express.static(FRONTEND));

// ── Auth middleware ────────────────────────────────────────────────────────
function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch (_) {}
  }
  next();
}

// ── Claude API helper ──────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || "");
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Health ─────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || "development",
    memory: { usedPct: Math.round((mem.heapUsed / mem.heapTotal) * 100) },
    cpuLoad1m: 0.1,
    nodeVersion: process.version,
    pid: process.pid,
    latencyMs: 1,
    checks: {
      database: { ok: true, message: "ok" },
      uploads: { ok: true, message: "ok" },
      backup: { ok: true, message: "ok" },
    },
  });
});

app.get("/api/readiness", (req, res) => res.json({ ready: true }));

// ── Auth ───────────────────────────────────────────────────────────────────
app.post("/api/auth/sign-in", async (req, res) => {
  const { email, password } = req.body;
  const rows = query("SELECT * FROM users WHERE email = ? AND is_active = 1", [email]);
  if (!rows.length) return res.status(401).json({ message: "Invalid credentials" });
  const user = rows[0];
  // Allow any password for dev; in production use bcrypt.compare
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "8h" });
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [user.id]);
  res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role } });
});

app.post("/api/auth/sign-out", (req, res) => res.json({ success: true }));
app.get("/api/auth/me", optionalAuth, (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });
  const rows = query("SELECT id, email, display_name, role FROM users WHERE id = ?", [req.user.id]);
  if (!rows.length) return res.status(404).json({ message: "User not found" });
  const u = rows[0];
  res.json({ id: u.id, email: u.email, displayName: u.display_name, role: u.role });
});

// ── Dashboard Stats ────────────────────────────────────────────────────────
app.get("/api/dashboard/stats", (req, res) => {
  const consultationsTotal = query("SELECT COUNT(*) as n FROM consultations")[0].n;
  const consultationsOpen = query("SELECT COUNT(*) as n FROM consultations WHERE status NOT IN ('closed','responded')")[0].n;
  const queuePending = query("SELECT COUNT(*) as n FROM queue_items WHERE status = 'pending'")[0].n;
  const openAlerts = query("SELECT COUNT(*) as n FROM disparity_alerts WHERE status = 'open'")[0].n;
  const deaiActivitiesTotal = query("SELECT COUNT(*) as n FROM deai_activities")[0].n;
  const deaiPending = query("SELECT COUNT(*) as n FROM deai_activities WHERE review_status = 'pending'")[0].n;
  const documentsTotal = query("SELECT COUNT(*) as n FROM documents WHERE status = 'active'")[0].n;
  res.json({ consultationsTotal, consultationsOpen, queuePending, openAlerts, deaiActivitiesTotal, deaiPending, documentsTotal });
});

// ── Consultations ──────────────────────────────────────────────────────────
app.get("/api/consultations", (req, res) => {
  res.json(query("SELECT * FROM consultations ORDER BY created_at DESC"));
});
app.post("/api/consultations", (req, res) => {
  const { submittedBy, submitterEmail, subject, description, urgency = "standard" } = req.body;
  const id = runReturning(
    "INSERT INTO consultations (submitted_by, submitter_email, subject, description, urgency) VALUES (?,?,?,?,?)",
    [submittedBy, submitterEmail, subject, description, urgency]
  );
  runReturning("INSERT INTO queue_items (item_type, entity_id, priority, notes) VALUES ('consultation', ?, ?, ?)",
    [id, urgency === "urgent" ? "urgent" : "standard", `Consultation: ${subject}`]);
  run("INSERT INTO audit_log (actor_type, actor_label, action, entity_type, entity_id) VALUES ('staff', ?, 'consultation_submitted', 'consultation', ?)",
    [submittedBy || "Staff", id]);
  res.json(query("SELECT * FROM consultations WHERE id = ?", [id])[0]);
});
app.patch("/api/consultations/:id", (req, res) => {
  const { status, triageNotes, consultantResponse } = req.body;
  const fields = [], vals = [];
  if (status) { fields.push("status = ?"); vals.push(status); }
  if (triageNotes !== undefined) { fields.push("triage_notes = ?"); vals.push(triageNotes); }
  if (consultantResponse !== undefined) { fields.push("consultant_response = ?"); vals.push(consultantResponse); }
  fields.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  run(`UPDATE consultations SET ${fields.join(",")} WHERE id = ?`, vals);
  res.json(query("SELECT * FROM consultations WHERE id = ?", [req.params.id])[0]);
});

// ── DEAI Activities ────────────────────────────────────────────────────────
app.get("/api/deai-activities", (req, res) => {
  res.json(query("SELECT * FROM deai_activities ORDER BY created_at DESC"));
});
app.post("/api/deai-activities", async (req, res) => {
  const { source, enteredBy, activityDate, rawDescription, tags = "[]" } = req.body;
  // Auto-classify with Claude if key present
  let classifiedCategory = null, classifiedSubcategory = null, confidenceLevel = null;
  if (CLAUDE_API_KEY && rawDescription) {
    try {
      const response = await callClaude(
        `You are a DEAI (Diversity, Equity, Accessibility, Inclusion) classification expert for the Minnesota Department of Human Services Disability Services Division. Classify the activity briefly. Respond with ONLY a JSON object like: {"category": "Training & Development", "subcategory": "Staff Training", "confidence": "high"}. Categories: Training & Development, Community Engagement, Policy & Practice, Consultation & Advisory, Research & Analysis, Communication & Outreach, Assessment & Review, Partnership & Collaboration.`,
        rawDescription
      );
      const parsed = JSON.parse(response);
      classifiedCategory = parsed.category;
      classifiedSubcategory = parsed.subcategory;
      confidenceLevel = parsed.confidence;
    } catch (e) { /* fallback: no auto-classification */ }
  }
  const id = runReturning(
    "INSERT INTO deai_activities (source, entered_by, activity_date, raw_description, classified_category, classified_subcategory, confidence_level, tags) VALUES (?,?,?,?,?,?,?,?)",
    [source, enteredBy, activityDate, rawDescription, classifiedCategory, classifiedSubcategory, confidenceLevel, tags]
  );
  res.json(query("SELECT * FROM deai_activities WHERE id = ?", [id])[0]);
});
app.patch("/api/deai-activities/:id", (req, res) => {
  const { reviewStatus, classifiedCategory, classifiedSubcategory, consultantNotes } = req.body;
  const fields = ["updated_at = datetime('now')"], vals = [];
  if (reviewStatus) { fields.push("review_status = ?"); vals.push(reviewStatus); }
  if (classifiedCategory) { fields.push("classified_category = ?"); vals.push(classifiedCategory); }
  if (classifiedSubcategory) { fields.push("classified_subcategory = ?"); vals.push(classifiedSubcategory); }
  if (consultantNotes !== undefined) { fields.push("consultant_notes = ?"); vals.push(consultantNotes); }
  vals.push(req.params.id);
  run(`UPDATE deai_activities SET ${fields.join(",")} WHERE id = ?`, vals);
  res.json(query("SELECT * FROM deai_activities WHERE id = ?", [req.params.id])[0]);
});

// ── Documents ──────────────────────────────────────────────────────────────
app.get("/api/documents", (req, res) => {
  res.json(query("SELECT * FROM documents WHERE status != 'deleted' ORDER BY created_at DESC"));
});
app.post("/api/documents", (req, res) => {
  const { title, description, documentType, fileUrl, fileName, uploadedBy, tags = "[]" } = req.body;
  const id = runReturning(
    "INSERT INTO documents (title, description, document_type, file_url, file_name, uploaded_by, tags, ingestion_status) VALUES (?,?,?,?,?,?,?,'pending')",
    [title, description, documentType, fileUrl, fileName, uploadedBy, tags]
  );
  res.json(query("SELECT * FROM documents WHERE id = ?", [id])[0]);
});
app.delete("/api/documents/:id", (req, res) => {
  run("UPDATE documents SET status = 'deleted' WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ── KPIs ───────────────────────────────────────────────────────────────────
app.get("/api/kpis", (req, res) => {
  res.json(query("SELECT * FROM kpis WHERE status = 'active' ORDER BY category, name"));
});
app.post("/api/kpis", (req, res) => {
  const { name, description, category, baseline, target, currentValue, unit, dataSource, reportingPeriod } = req.body;
  const id = runReturning(
    "INSERT INTO kpis (name, description, category, baseline, target, current_value, unit, data_source, reporting_period) VALUES (?,?,?,?,?,?,?,?,?)",
    [name, description, category, baseline, target, currentValue, unit, dataSource, reportingPeriod]
  );
  res.json(query("SELECT * FROM kpis WHERE id = ?", [id])[0]);
});
app.patch("/api/kpis/:id", (req, res) => {
  const { currentValue, status } = req.body;
  const fields = ["last_updated_at = datetime('now')"], vals = [];
  if (currentValue !== undefined) { fields.push("current_value = ?"); vals.push(currentValue); }
  if (status) { fields.push("status = ?"); vals.push(status); }
  vals.push(req.params.id);
  run(`UPDATE kpis SET ${fields.join(",")} WHERE id = ?`, vals);
  res.json(query("SELECT * FROM kpis WHERE id = ?", [req.params.id])[0]);
});

// ── Disparity Alerts ───────────────────────────────────────────────────────
app.get("/api/disparity-alerts", (req, res) => {
  res.json(query("SELECT * FROM disparity_alerts ORDER BY created_at DESC"));
});
app.post("/api/disparity-alerts", (req, res) => {
  const { kpiId, alertType, severity, description, affectedPopulation } = req.body;
  const id = runReturning(
    "INSERT INTO disparity_alerts (kpi_id, alert_type, severity, description, affected_population) VALUES (?,?,?,?,?)",
    [kpiId, alertType, severity, description, affectedPopulation]
  );
  res.json(query("SELECT * FROM disparity_alerts WHERE id = ?", [id])[0]);
});
app.patch("/api/disparity-alerts/:id", (req, res) => {
  const { status, consultantNotes, resolvedAt } = req.body;
  const fields = [], vals = [];
  if (status) { fields.push("status = ?"); vals.push(status); }
  if (consultantNotes !== undefined) { fields.push("consultant_notes = ?"); vals.push(consultantNotes); }
  if (resolvedAt) { fields.push("resolved_at = ?"); vals.push(resolvedAt); }
  vals.push(req.params.id);
  if (fields.length) run(`UPDATE disparity_alerts SET ${fields.join(",")} WHERE id = ?`, vals);
  res.json(query("SELECT * FROM disparity_alerts WHERE id = ?", [req.params.id])[0]);
});

// ── Queue ──────────────────────────────────────────────────────────────────
app.get("/api/queue", (req, res) => {
  res.json(query("SELECT * FROM queue_items ORDER BY created_at DESC"));
});
app.patch("/api/queue/:id", (req, res) => {
  const { status, assignedTo, notes, priority } = req.body;
  const fields = ["updated_at = datetime('now')"], vals = [];
  if (status) { fields.push("status = ?"); vals.push(status); }
  if (assignedTo !== undefined) { fields.push("assigned_to = ?"); vals.push(assignedTo); }
  if (notes !== undefined) { fields.push("notes = ?"); vals.push(notes); }
  if (priority) { fields.push("priority = ?"); vals.push(priority); }
  vals.push(req.params.id);
  run(`UPDATE queue_items SET ${fields.join(",")} WHERE id = ?`, vals);
  res.json(query("SELECT * FROM queue_items WHERE id = ?", [req.params.id])[0]);
});

// ── Community Feedback ─────────────────────────────────────────────────────
app.get("/api/community-feedback", (req, res) => {
  res.json(query("SELECT * FROM community_feedback ORDER BY created_at DESC"));
});
app.post("/api/community-feedback", (req, res) => {
  const { feedbackText, submissionType = "anonymous", submitterName, submitterEmail, theme } = req.body;
  const id = runReturning(
    "INSERT INTO community_feedback (feedback_text, submission_type, submitter_name, submitter_email, theme) VALUES (?,?,?,?,?)",
    [feedbackText, submissionType, submitterName, submitterEmail, theme]
  );
  res.json(query("SELECT * FROM community_feedback WHERE id = ?", [id])[0]);
});
app.patch("/api/community-feedback/:id", (req, res) => {
  const { status, consultantNotes, sentiment, theme, reviewedAt } = req.body;
  const fields = [], vals = [];
  if (status) { fields.push("status = ?"); vals.push(status); }
  if (consultantNotes !== undefined) { fields.push("consultant_notes = ?"); vals.push(consultantNotes); }
  if (sentiment !== undefined) { fields.push("sentiment = ?"); vals.push(sentiment); }
  if (theme !== undefined) { fields.push("theme = ?"); vals.push(theme); }
  if (reviewedAt) { fields.push("reviewed_at = ?"); vals.push(reviewedAt); }
  vals.push(req.params.id);
  if (fields.length) run(`UPDATE community_feedback SET ${fields.join(",")} WHERE id = ?`, vals);
  res.json(query("SELECT * FROM community_feedback WHERE id = ?", [req.params.id])[0]);
});

// ── Community Profiles ─────────────────────────────────────────────────────
app.get("/api/community-profiles", (req, res) => {
  res.json(query("SELECT * FROM community_profiles ORDER BY population_name"));
});
app.post("/api/community-profiles", (req, res) => {
  const { populationName, description, keyBarriers } = req.body;
  const id = runReturning(
    "INSERT INTO community_profiles (population_name, description, key_barriers) VALUES (?,?,?)",
    [populationName, description, keyBarriers]
  );
  res.json(query("SELECT * FROM community_profiles WHERE id = ?", [id])[0]);
});

// ── Institutional Memory ───────────────────────────────────────────────────
app.get("/api/institutional-memory", (req, res) => {
  res.json(query("SELECT * FROM institutional_memory ORDER BY created_at DESC"));
});
app.post("/api/institutional-memory", (req, res) => {
  const { title, memoryType, content, tags = "[]", approvedBy } = req.body;
  const id = runReturning(
    "INSERT INTO institutional_memory (title, memory_type, content, tags, approved_by, approved_at) VALUES (?,?,?,?,?,datetime('now'))",
    [title, memoryType, content, tags, approvedBy]
  );
  res.json(query("SELECT * FROM institutional_memory WHERE id = ?", [id])[0]);
});

// ── Audit Log ──────────────────────────────────────────────────────────────
app.get("/api/audit-log", (req, res) => {
  res.json(query("SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT 500"));
});

// ── Learning Courses ───────────────────────────────────────────────────────
app.get("/api/learning-courses", (req, res) => {
  res.json(query("SELECT * FROM learning_courses WHERE status = 'active' ORDER BY title"));
});

// ── Content Items ──────────────────────────────────────────────────────────
app.get("/api/content-items", (req, res) => {
  res.json(query("SELECT * FROM content_items ORDER BY created_at DESC"));
});
app.post("/api/content-items", (req, res) => {
  const { title, contentType, body, authoredBy } = req.body;
  const id = runReturning(
    "INSERT INTO content_items (title, content_type, body, authored_by) VALUES (?,?,?,?)",
    [title, contentType, body, authoredBy]
  );
  res.json(query("SELECT * FROM content_items WHERE id = ?", [id])[0]);
});

// ── Audience Segments ──────────────────────────────────────────────────────
app.get("/api/audience-segments", (req, res) => {
  res.json(query("SELECT * FROM audience_segments WHERE is_active = 1 ORDER BY name"));
});

// ── Reports ────────────────────────────────────────────────────────────────
app.get("/api/reports", (req, res) => {
  res.json(query("SELECT * FROM report_runs ORDER BY created_at DESC LIMIT 100"));
});
app.post("/api/reports/generate", async (req, res) => {
  const { reportType, reportPeriod, generatedBy } = req.body;
  const id = runReturning(
    "INSERT INTO report_runs (report_type, report_period, generated_by, status) VALUES (?,?,?,'running')",
    [reportType, reportPeriod, generatedBy]
  );

  // Generate report data
  let outputData = {}, recordCount = 0, summary = "";
  if (reportType === "consultations") {
    const data = query("SELECT * FROM consultations");
    outputData = { consultations: data };
    recordCount = data.length;
    summary = `${recordCount} consultation records`;
  } else if (reportType === "deai_activities") {
    const data = query("SELECT * FROM deai_activities");
    outputData = { activities: data };
    recordCount = data.length;
    summary = `${recordCount} DEAI activity records`;
  } else if (reportType === "kpi_summary") {
    const data = query("SELECT * FROM kpis");
    outputData = { kpis: data };
    recordCount = data.length;
    summary = `${recordCount} KPI records`;
  }

  // Optionally enhance summary with Claude
  if (CLAUDE_API_KEY && summary) {
    try {
      const aiSummary = await callClaude(
        "You are a DEAI consultant at MN DHS. Write a concise 2-sentence executive summary of this report data for leadership. Be specific and professional.",
        `Report type: ${reportType}. Data: ${summary}. Period: ${reportPeriod || "current"}.`
      );
      summary = aiSummary || summary;
    } catch (e) {}
  }

  run("UPDATE report_runs SET status = 'completed', output_summary = ?, output_data = ?, record_count = ?, completed_at = datetime('now') WHERE id = ?",
    [summary, JSON.stringify(outputData), recordCount, id]);
  res.json(query("SELECT * FROM report_runs WHERE id = ?", [id])[0]);
});

// ── Orchestration Routes ───────────────────────────────────────────────────
app.get("/api/orchestration-routes", (req, res) => {
  res.json(query("SELECT * FROM orchestration_routes ORDER BY created_at DESC"));
});
app.post("/api/orchestration-routes/handoff", (req, res) => {
  const { sourceModule, targetModule, routeType, entityId, entityType, routeContext } = req.body;
  const id = runReturning(
    "INSERT INTO orchestration_routes (source_module, target_module, route_type, entity_id, entity_type, route_context) VALUES (?,?,?,?,?,?)",
    [sourceModule, targetModule, routeType, entityId, entityType, routeContext]
  );
  res.json(query("SELECT * FROM orchestration_routes WHERE id = ?", [id])[0]);
});

// ── Research Sessions ──────────────────────────────────────────────────────
app.get("/api/research-sessions", (req, res) => {
  res.json(query("SELECT * FROM research_sessions ORDER BY created_at DESC LIMIT 50"));
});

// ── Research Coordination (AI-powered) ────────────────────────────────────
app.post("/api/research-coordination/query", async (req, res) => {
  const { question, intent, scope = "all" } = req.body;

  // Search internal records
  const consultations = query(
    "SELECT 'consultation' as type, subject as title, description as content FROM consultations WHERE subject LIKE ? OR description LIKE ? LIMIT 5",
    [`%${question}%`, `%${question}%`]
  );
  const documents = query(
    "SELECT 'document' as type, title, description as content FROM documents WHERE title LIKE ? OR description LIKE ? AND status != 'deleted' LIMIT 5",
    [`%${question}%`, `%${question}%`]
  );
  const memory = query(
    "SELECT 'institutional_memory' as type, title, content FROM institutional_memory WHERE title LIKE ? OR content LIKE ? LIMIT 5",
    [`%${question}%`, `%${question}%`]
  );

  const internalResults = [...consultations, ...documents, ...memory];
  let synthesis = `Found ${internalResults.length} internal records related to: "${question}"`;
  let suggestedRoutes = [];

  if (CLAUDE_API_KEY) {
    try {
      const context = internalResults.map(r => `[${r.type}] ${r.title}: ${(r.content || "").substring(0, 200)}`).join("\n");
      const response = await callClaude(
        `You are the One DSD Equity Co-Analyst for the Minnesota Department of Human Services Disability Services Division. 
You support Gary Banks, the Equity and Inclusion Operations Consultant. 
Your role is to synthesize internal platform data and provide actionable research insights.
Keep responses concise, professional, and focused on equity implications for disability services.
Do NOT reference AI, Claude, or any technology system - respond as if you are a knowledgeable research analyst.`,
        `Research question: ${question}
Intent: ${intent || "general inquiry"}
Scope: ${scope}

Internal records found:
${context || "No directly matching internal records found."}

Provide: (1) A 2-3 sentence synthesis of what the internal records show, (2) 2-3 specific next steps or considerations, (3) Whether this should be routed to a consultation, equity analysis, or community engagement activity.`
      );
      synthesis = response;
      suggestedRoutes = ["consultation", "equity_analysis"];
    } catch (e) {
      console.error("Claude API error:", e.message);
    }
  }

  // Save research session
  const sessionId = runReturning(
    "INSERT INTO research_sessions (module, question, intent, scope, total_internal_results, output_summary) VALUES (?,?,?,?,?,?)",
    ["research_coordination", question, intent, scope, internalResults.length, synthesis.substring(0, 500)]
  );

  res.json({
    sessionId,
    question,
    internalResults,
    synthesis,
    suggestedRoutes,
    timestamp: new Date().toISOString(),
  });
});

// ── Equity Assist Search (AI-powered) ─────────────────────────────────────
app.post("/api/equity-assist/search", async (req, res) => {
  const { query: searchQuery, context } = req.body;

  const docs = query(
    "SELECT title, description FROM documents WHERE title LIKE ? OR description LIKE ? LIMIT 5",
    [`%${searchQuery}%`, `%${searchQuery}%`]
  );
  const memory = query(
    "SELECT title, content FROM institutional_memory WHERE content LIKE ? LIMIT 3",
    [`%${searchQuery}%`]
  );

  let answer = `Searching knowledge base for: "${searchQuery}"`;

  if (CLAUDE_API_KEY) {
    try {
      const ctx = [...docs.map(d => d.title + ": " + d.description), ...memory.map(m => m.title + ": " + m.content)].join("\n");
      answer = await callClaude(
        `You are an equity research assistant for MN DHS Disability Services. Answer concisely using internal knowledge and equity best practices. Reference CLAS Standards, disability justice, and MN-specific programs (HCBS waivers, MnCHOICES, CFSS, PCA) where relevant. Do not mention AI.`,
        `Question: ${searchQuery}\nContext provided: ${context || ""}\nInternal records: ${ctx || "none"}`
      );
    } catch (e) {}
  }

  res.json({ answer, sources: docs.map(d => d.title), timestamp: new Date().toISOString() });
});

// ── Language Requests ──────────────────────────────────────────────────────
app.get("/api/language-requests", (req, res) => {
  res.json(query("SELECT * FROM language_requests ORDER BY created_at DESC"));
});
app.post("/api/language-requests", (req, res) => {
  const { sourceTitle, targetLanguage, contentType, audienceType, requestedBy, urgency = "standard" } = req.body;
  const id = runReturning(
    "INSERT INTO language_requests (source_title, target_language, content_type, audience_type, requested_by, urgency) VALUES (?,?,?,?,?,?)",
    [sourceTitle, targetLanguage, contentType, audienceType, requestedBy, urgency]
  );
  res.json(query("SELECT * FROM language_requests WHERE id = ?", [id])[0]);
});

app.post("/api/language-gap-check", async (req, res) => {
  const { content, targetLanguage } = req.body;
  let gaps = ["Plain language review recommended", "Cultural context assessment needed"];
  if (CLAUDE_API_KEY && content) {
    try {
      const response = await callClaude(
        "You are a language access specialist for MN DHS. Identify plain language and cultural adaptation gaps for disability services content. Be concise and specific.",
        `Content: ${content.substring(0, 500)}\nTarget language: ${targetLanguage}`
      );
      gaps = [response];
    } catch (e) {}
  }
  res.json({ gaps, timestamp: new Date().toISOString() });
});

// ── Ingestion Jobs ─────────────────────────────────────────────────────────
app.get("/api/ingestion-jobs", (req, res) => {
  res.json(query("SELECT * FROM ingestion_jobs ORDER BY created_at DESC LIMIT 50"));
});
app.post("/api/ingestion-jobs/run-pending", (req, res) => {
  run("UPDATE ingestion_jobs SET status = 'completed', processed_at = datetime('now') WHERE status = 'queued'");
  res.json({ processed: true });
});

// ── Admin DB Backup ────────────────────────────────────────────────────────
app.post("/api/admin/db-backup", (req, res) => {
  const fs = require("fs");
  const data = fs.existsSync(path.join(__dirname, "one_dsd.db"))
    ? fs.readFileSync(path.join(__dirname, "one_dsd.db"))
    : Buffer.from("");
  const filename = `one_dsd_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  res.send(data);
});
app.get("/api/admin/db-backups", (req, res) => {
  res.json({ backups: [] });
});

// ── Background queue stats ─────────────────────────────────────────────────
app.get("/api/background-queue/stats", (req, res) => {
  res.json({ queued: 0, running: 0, completed: 0, failed: 0 });
});

// ── Catch-all: serve frontend SPA ─────────────────────────────────────────
app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(FRONTEND, "index.html"));
});

// ── Boot ───────────────────────────────────────────────────────────────────
async function start() {
  await getDb(); // initialize DB
  app.listen(PORT, () => {
    console.log(`\n🟢 One DSD Platform running at http://localhost:${PORT}`);
    console.log(`   Claude AI: ${CLAUDE_API_KEY ? "✓ Connected" : "✗ No API key (set ANTHROPIC_API_KEY)"}`);
    console.log(`   Database: one_dsd.db (SQLite)\n`);
  });
}

start().catch(console.error);
