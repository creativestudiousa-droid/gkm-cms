require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET || "gkm-cms-secret-2025";

// ── Database ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Middleware ──
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : "*",
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve CMS admin panel
app.use(express.static(path.join(__dirname, "public")));
// Serve uploaded media
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── File Upload ──
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, "uploads");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg|pdf/;
    cb(null, allowed.test(file.mimetype) || allowed.test(path.extname(file.originalname).toLowerCase()));
  },
});

// ── Auth Middleware ──
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Unauthorised" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch { res.status(401).json({ error: "Session expired. Please log in again." }); }
};

// ── Init Database ──
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cms_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      avatar TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cms_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cms_pages (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      template TEXT DEFAULT 'default',
      hero_heading TEXT,
      hero_subheading TEXT,
      hero_cta_text TEXT DEFAULT 'Book Consultation',
      hero_cta_link TEXT DEFAULT '/contact.html',
      hero_image TEXT,
      content TEXT,
      sections JSONB DEFAULT '[]',
      meta_title TEXT,
      meta_description TEXT,
      status TEXT DEFAULT 'published',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cms_posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category TEXT,
      thumbnail TEXT,
      summary TEXT,
      content TEXT,
      author TEXT DEFAULT 'GK Malik & Associates',
      read_time INT DEFAULT 5,
      featured BOOL DEFAULT false,
      status TEXT DEFAULT 'draft',
      meta_title TEXT,
      meta_description TEXT,
      published_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cms_media (
      id SERIAL PRIMARY KEY,
      filename TEXT,
      original_name TEXT,
      url TEXT,
      size INT,
      width INT,
      height INT,
      mime_type TEXT,
      alt TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cms_leads (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT,
      phone TEXT,
      service TEXT,
      message TEXT,
      status TEXT DEFAULT 'new',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cms_clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      pan TEXT,
      gstin TEXT,
      services TEXT[],
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cms_compliance (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      due_date DATE NOT NULL,
      type TEXT,
      description TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Default admin
  const { rows } = await pool.query("SELECT id FROM cms_users LIMIT 1");
  if (!rows.length) {
    const hash = await bcrypt.hash("GKMAdmin2025!", 10);
    await pool.query(
      "INSERT INTO cms_users (name, email, password, role) VALUES ($1,$2,$3,$4)",
      ["GKM Admin", "admin@gkmalik.com", hash, "admin"]
    );
    console.log("✓ Admin created: admin@gkmalik.com / GKMAdmin2025!");
  }

  // Default settings
  const defaults = {
    site_name: "GK Malik & Associates",
    tagline: "Beyond Compliance. Towards Growth.",
    phone: "+91 98850 41052",
    email: "ask@gkmalik.com",
    address: "#803, Babukhan Estate, Basheerbagh, Hyderabad — 500 001",
    whatsapp: "919885041052",
    linkedin: "", facebook: "", instagram: "", twitter: "",
    google_analytics: "",
    footer_copyright: "© 2025 GK Malik & Associates. All Rights Reserved.",
    footer_desc: "Strategic Tax, Audit & Business Advisory for Startups, SMEs, NGOs and NRIs.",
    hero_heading: "Beyond Compliance. Towards Growth.",
    hero_sub: "Strategic Tax, Audit & Business Advisory for Startups, SMEs, NGOs, NRIs and Enterprises.",
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      "INSERT INTO cms_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING",
      [key, value]
    );
  }

  // Default compliance events
  await pool.query(`
    INSERT INTO cms_compliance (title, due_date, type, description) VALUES
    ('GSTR-3B June 2025', '2025-06-20', 'GST', 'Monthly GST return for May 2025'),
    ('GSTR-1 June 2025', '2025-06-11', 'GST', 'Sales return for May 2025'),
    ('TDS Return Q4 FY25', '2025-05-31', 'TDS', 'TDS/TCS return Q4 FY 2024-25'),
    ('Advance Tax Q1 FY26', '2025-06-15', 'Income Tax', '1st installment advance tax FY 2025-26'),
    ('ITR Non-Audit FY25', '2025-07-31', 'Income Tax', 'Last date ITR non-audit cases FY 2024-25'),
    ('Advance Tax Q2 FY26', '2025-09-15', 'Income Tax', '2nd installment advance tax'),
    ('ITR Audit FY25', '2025-10-31', 'Income Tax', 'Last date ITR audit cases FY 2024-25'),
    ('Advance Tax Q3 FY26', '2025-12-15', 'Income Tax', '3rd installment advance tax'),
    ('GSTR-9 Annual FY25', '2025-12-31', 'GST', 'GST Annual Return FY 2024-25'),
    ('Advance Tax Q4 FY26', '2026-03-15', 'Income Tax', '4th installment advance tax')
    ON CONFLICT DO NOTHING
  `).catch(() => {});

  console.log("✓ Database ready");
}

// ════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════

app.get("/api/health", (req, res) => res.json({ status: "ok", cms: "GKM CMS v2.0" }));

// ── AUTH ──
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query("SELECT * FROM cms_users WHERE email=$1", [email?.toLowerCase()]);
    if (!rows.length || !await bcrypt.compare(password, rows[0].password))
      return res.status(401).json({ error: "Invalid email or password" });
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role }, SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT id,name,email,role,avatar,created_at FROM cms_users WHERE id=$1", [req.user.id]);
  res.json(rows[0]);
});

// ── SETTINGS ──
app.get("/api/settings", async (req, res) => {
  const { rows } = await pool.query("SELECT key, value FROM cms_settings");
  const s = {}; rows.forEach(r => s[r.key] = r.value);
  res.json(s);
});

app.post("/api/settings", auth, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await pool.query(
        "INSERT INTO cms_settings (key,value,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()",
        [key, String(value ?? "")]
      );
    }
    res.json({ success: true, message: "Settings saved successfully." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PAGES ──
app.get("/api/pages", async (req, res) => {
  const { rows } = await pool.query("SELECT id,title,slug,status,template,updated_at FROM cms_pages ORDER BY created_at ASC");
  res.json({ data: rows });
});

app.get("/api/pages/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM cms_pages WHERE id=$1 OR slug=$2", [+req.params.id || -1, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Page not found" });
  res.json(rows[0]);
});

app.post("/api/pages", auth, async (req, res) => {
  try {
    const { title, slug, template, hero_heading, hero_subheading, hero_cta_text, hero_cta_link, hero_image, content, sections, meta_title, meta_description, status } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO cms_pages (title,slug,template,hero_heading,hero_subheading,hero_cta_text,hero_cta_link,hero_image,content,sections,meta_title,meta_description,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
      [title, slug, template || "default", hero_heading, hero_subheading, hero_cta_text, hero_cta_link, hero_image, content, JSON.stringify(sections || []), meta_title, meta_description, status || "published"]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/pages/:id", auth, async (req, res) => {
  try {
    const { title, slug, template, hero_heading, hero_subheading, hero_cta_text, hero_cta_link, hero_image, content, sections, meta_title, meta_description, status } = req.body;
    const { rows } = await pool.query(
      "UPDATE cms_pages SET title=$1,slug=$2,template=$3,hero_heading=$4,hero_subheading=$5,hero_cta_text=$6,hero_cta_link=$7,hero_image=$8,content=$9,sections=$10,meta_title=$11,meta_description=$12,status=$13,updated_at=NOW() WHERE id=$14 RETURNING *",
      [title, slug, template, hero_heading, hero_subheading, hero_cta_text, hero_cta_link, hero_image, content, JSON.stringify(sections || []), meta_title, meta_description, status, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POSTS ──
app.get("/api/posts", async (req, res) => {
  try {
    const { status, category, limit = 20, offset = 0, search } = req.query;
    let where = []; const params = [];
    if (status) where.push(`status=$${params.push(status)}`);
    if (category) where.push(`category=$${params.push(category)}`);
    if (search) where.push(`title ILIKE $${params.push("%" + search + "%")}`);
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id,title,slug,category,thumbnail,summary,status,featured,read_time,author,created_at,published_at FROM cms_posts ${w} ORDER BY created_at DESC LIMIT $${params.push(+limit)} OFFSET $${params.push(+offset)}`,
      params
    );
    const cnt = await pool.query(`SELECT COUNT(*) FROM cms_posts ${w}`, params.slice(0, where.length));
    res.json({ data: rows, total: +cnt.rows[0].count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/posts/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM cms_posts WHERE id=$1 OR slug=$2", [+req.params.id || -1, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  res.json(rows[0]);
});

app.post("/api/posts", auth, async (req, res) => {
  try {
    const { title, slug, category, thumbnail, summary, content, author, read_time, featured, status, meta_title, meta_description } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO cms_posts (title,slug,category,thumbnail,summary,content,author,read_time,featured,status,meta_title,meta_description,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
      [title, slug, category, thumbnail, summary, content, author || "GK Malik & Associates", read_time || 5, featured || false, status || "draft", meta_title, meta_description, status === "published" ? new Date() : null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/posts/:id", auth, async (req, res) => {
  try {
    const { title, slug, category, thumbnail, summary, content, author, read_time, featured, status, meta_title, meta_description } = req.body;
    const { rows } = await pool.query(
      `UPDATE cms_posts SET title=$1,slug=$2,category=$3,thumbnail=$4,summary=$5,content=$6,author=$7,read_time=$8,featured=$9,status=$10,meta_title=$11,meta_description=$12,
       published_at=CASE WHEN $10='published' AND published_at IS NULL THEN NOW() ELSE published_at END,
       updated_at=NOW() WHERE id=$13 RETURNING *`,
      [title, slug, category, thumbnail, summary, content, author, read_time, featured, status, meta_title, meta_description, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/posts/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM cms_posts WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

// ── MEDIA ──
app.get("/api/media", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM cms_media ORDER BY created_at DESC LIMIT 200");
  res.json({ data: rows });
});

app.post("/api/media/upload", auth, upload.array("files", 20), async (req, res) => {
  try {
    const baseUrl = process.env.PUBLIC_URL || `https://${req.headers.host}`;
    const uploaded = [];
    for (const file of req.files) {
      let width, height;
      try {
        const meta = await sharp(file.path).metadata();
        width = meta.width; height = meta.height;
      } catch {}
      const url = `${baseUrl}/uploads/${file.filename}`;
      const { rows } = await pool.query(
        "INSERT INTO cms_media (filename,original_name,url,size,width,height,mime_type,alt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [file.filename, file.originalname, url, file.size, width, height, file.mimetype, file.originalname.replace(/\.[^.]+$/, "")]
      );
      uploaded.push(rows[0]);
    }
    res.json({ success: true, data: uploaded });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/media/:id", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT filename FROM cms_media WHERE id=$1", [req.params.id]);
  if (rows.length) {
    const fp = path.join(__dirname, "uploads", rows[0].filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await pool.query("DELETE FROM cms_media WHERE id=$1", [req.params.id]);
  }
  res.json({ success: true });
});

// ── LEADS ──
app.post("/api/leads", async (req, res) => {
  try {
    const { name, email, phone, service, message } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO cms_leads (name,email,phone,service,message) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [name, email, phone, service, message]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/leads", auth, async (req, res) => {
  const { status } = req.query;
  const where = status ? "WHERE status=$1" : "";
  const params = status ? [status] : [];
  const { rows } = await pool.query(`SELECT * FROM cms_leads ${where} ORDER BY created_at DESC LIMIT 100`, params);
  const cnt = await pool.query(`SELECT COUNT(*) FROM cms_leads ${where}`, params);
  res.json({ data: rows, total: +cnt.rows[0].count });
});

app.put("/api/leads/:id", auth, async (req, res) => {
  const { status, notes } = req.body;
  await pool.query("UPDATE cms_leads SET status=$1, notes=$2 WHERE id=$3", [status, notes, req.params.id]);
  res.json({ success: true });
});

app.delete("/api/leads/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM cms_leads WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

// ── CLIENTS ──
app.get("/api/clients", auth, async (req, res) => {
  const { search } = req.query;
  const where = search ? "WHERE name ILIKE $1 OR email ILIKE $1 OR pan ILIKE $1 OR gstin ILIKE $1" : "";
  const params = search ? ["%" + search + "%"] : [];
  const { rows } = await pool.query(`SELECT * FROM cms_clients ${where} ORDER BY created_at DESC LIMIT 100`, params);
  res.json({ data: rows });
});

app.post("/api/clients", auth, async (req, res) => {
  try {
    const { name, email, phone, company, pan, gstin, services, status, notes } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO cms_clients (name,email,phone,company,pan,gstin,services,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [name, email, phone, company, pan, gstin, services || [], status || "active", notes]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/clients/:id", auth, async (req, res) => {
  try {
    const { name, email, phone, company, pan, gstin, services, status, notes } = req.body;
    const { rows } = await pool.query(
      "UPDATE cms_clients SET name=$1,email=$2,phone=$3,company=$4,pan=$5,gstin=$6,services=$7,status=$8,notes=$9 WHERE id=$10 RETURNING *",
      [name, email, phone, company, pan, gstin, services || [], status, notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/clients/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM cms_clients WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

// ── COMPLIANCE ──
app.get("/api/compliance", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM cms_compliance ORDER BY due_date ASC");
  res.json({ data: rows });
});

app.post("/api/compliance", auth, async (req, res) => {
  try {
    const { title, due_date, type, description, status } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO cms_compliance (title,due_date,type,description,status) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [title, due_date, type, description, status || "pending"]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/compliance/:id", auth, async (req, res) => {
  const { title, due_date, type, description, status } = req.body;
  const { rows } = await pool.query(
    "UPDATE cms_compliance SET title=$1,due_date=$2,type=$3,description=$4,status=$5 WHERE id=$6 RETURNING *",
    [title, due_date, type, description, status, req.params.id]
  );
  res.json(rows[0]);
});

app.delete("/api/compliance/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM cms_compliance WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

// ── DASHBOARD ──
app.get("/api/dashboard", auth, async (req, res) => {
  try {
    const [pages, posts, leads, clients, compliance] = await Promise.all([
      pool.query("SELECT COUNT(*) total FROM cms_pages"),
      pool.query("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='published') published, COUNT(*) FILTER (WHERE status='draft') drafts FROM cms_posts"),
      pool.query("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='new') new_leads FROM cms_leads"),
      pool.query("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='active') active FROM cms_clients"),
      pool.query("SELECT COUNT(*) FILTER (WHERE due_date <= NOW()+INTERVAL '7 days' AND status='pending') urgent FROM cms_compliance"),
    ]);
    const recentLeads = await pool.query("SELECT name,email,service,status,created_at FROM cms_leads ORDER BY created_at DESC LIMIT 5");
    const upcomingDates = await pool.query("SELECT title,due_date,type,status FROM cms_compliance WHERE due_date >= CURRENT_DATE ORDER BY due_date ASC LIMIT 8");
    res.json({
      pages: pages.rows[0],
      posts: posts.rows[0],
      leads: leads.rows[0],
      clients: clients.rows[0],
      compliance: compliance.rows[0],
      recent_leads: recentLeads.rows,
      upcoming_dates: upcomingDates.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI PROXY ──
app.post("/api/ai", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI not configured" });
    const { message, history = [] } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: 500,
        system: "You are GKM AI, expert CA assistant for GK Malik & Associates, Hyderabad. Answer questions about Indian GST, Income Tax, NGO compliance, FCRA, TDS, NRI taxation, transfer pricing. Be concise and practical.",
        messages: [...history.slice(-6), { role: "user", content: message }],
      }),
    });
    const data = await response.json();
    res.json({ reply: data.content?.[0]?.text || "Please contact us at +91 98850 41052" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serve CMS for all /cms routes
app.get("/cms*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start
initDB()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`✓ GKM CMS running on port ${PORT}`)))
  .catch(err => { console.error("DB failed:", err.message); process.exit(1); });
