require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const Groq = require("groq-sdk");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const DAILY_LIMIT = Math.max(1, Number(process.env.DAILY_QUESTION_LIMIT || 20));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("ERROR: Set JWT_SECRET to a random string of at least 32 characters.");
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "thanwa.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'ป.4',
  language TEXT NOT NULL DEFAULT 'th',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  questions INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, day)
);
CREATE TABLE IF NOT EXISTS essays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 *  60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "ลองใหม่ภายหลัง (จำกัดการเข้าสู่ระบบชั่วคราว)" }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "ส่งคำขอเร็วเกินไป กรุณารอสักครู่" }
});
app.use("/api/auth", authLimiter);
app.use("/api", apiLimiter);

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function makeToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id,name,email,level,language FROM users WHERE id=?").get(payload.id);
    if (!user) return res.status(401).json({ error: "ไม่พบบัญชีผู้ใช้" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบใหม่" });
  }
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, level: user.level, language: user.language };
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "STUDENT THANWA OS",
    aiConfigured: Boolean(groq),
    model: groq ? GROQ_MODEL : null
  });
});

app.post("/api/auth/register", async (req, res) => {
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 160).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const level = cleanText(req.body.level, 20) || "ป.4";

  if (name.length < 2) return res.status(400).json({ error: "กรุณากรอกชื่ออย่างน้อย 2 ตัวอักษร" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "รูปแบบอีเมลไม่ถูกต้อง" });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: "รหัสผ่านต้องมี 8–72 ตัวอักษร" });

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      "INSERT INTO users(name,email,password_hash,level) VALUES(?,?,?,?)"
    ).run(name, email, hash, level);
    const user = db.prepare("SELECT id,name,email,level,language FROM users WHERE id=?").get(result.lastInsertRowid);
    res.status(201).json({ token: makeToken(user), user: publicUser(user) });
  } catch (error) {
    if (String(error.code).includes("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "อีเมลนี้มีบัญชีแล้ว" });
    console.error(error);
    res.status(500).json({ error: "สร้างบัญชีไม่สำเร็จ" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = cleanText(req.body.email, 160).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  }
  res.json({
    token: makeToken(user),
    user: publicUser(user)
  });
});

app.get("/api/auth/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.patch("/api/profile", auth, (req, res) => {
  const name = cleanText(req.body.name, 60);
  const level = cleanText(req.body.level, 20);
  const language = req.body.language === "en" ? "en" : "th";
  if (name.length < 2) return res.status(400).json({ error: "ชื่อสั้นเกินไป" });
  db.prepare("UPDATE users SET name=?,level=?,language=? WHERE id=?")
    .run(name, level || req.user.level, language, req.user.id);
  const user = db.prepare("SELECT id,name,email,level,language FROM users WHERE id=?").get(req.user.id);
  res.json({ user: publicUser(user) });
});

app.get("/api/usage", auth, (req, res) => {
  const row = db.prepare("SELECT questions FROM usage WHERE user_id=? AND day=?").get(req.user.id, todayKey());
  res.json({ used: row ? row.questions : 0, limit: DAILY_LIMIT });
});

app.post("/api/tutor", auth, async (req, res) => {
  if (!groq) return res.status(503).json({ error: "AI ยังไม่ได้ตั้งค่า GROQ_API_KEY บนเซิร์ฟเวอร์" });

  const question = cleanText(req.body.question, 4000);
  const subject = cleanText(req.body.subject, 60) || "ทั่วไป";
  const language = req.body.language === "en" ? "English" : "Thai";
  if (question.length < 2) return res.status(400).json({ error: "กรุณาพิมพ์คำถาม" });

  const getUsage = db.prepare("SELECT questions FROM usage WHERE user_id=? AND day=?");
  const current = getUsage.get(req.user.id, todayKey());
  if ((current?.questions || 0) >= DAILY_LIMIT) {
    return res.status(429).json({ error: `วันนี้ใช้ครบ ${DAILY_LIMIT} คำถามแล้ว กรุณากลับมาใหม่พรุ่งนี้` });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0.4,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: `You are STUDENT THANWA OS, a patient educational tutor for school and university learners. Teach rather than merely give answers. Explain in clear ${language}. Adapt to the learner level: ${req.user.level}. Subject: ${subject}. Use small steps, examples, and check understanding. For essays, help plan and improve the student's own writing rather than encouraging dishonest submission. Do not claim certainty when unsure.`
        },
        { role: "user", content: question }
      ]
    });

    db.prepare(`
      INSERT INTO usage(user_id,day,questions) VALUES(?,?,1)
      ON CONFLICT(user_id,day) DO UPDATE SET questions=questions+1
    `).run(req.user.id, todayKey());

    res.json({
      answer: completion.choices?.[0]?.message?.content || "ยังไม่มีคำตอบ ลองถามอีกครั้ง",
      model: GROQ_MODEL
    });
  } catch (error) {
    console.error("Groq request failed:", error.message);
    res.status(502).json({ error: "เชื่อมต่อ AI ไม่สำเร็จ กรุณาลองใหม่ภายหลัง" });
  }
});

app.get("/api/essays", auth, (req, res) => {
  const rows = db.prepare(
    "SELECT id,title,content,updated_at FROM essays WHERE user_id=? ORDER BY updated_at DESC"
  ).all(req.user.id);
  res.json({ essays: rows });
});

app.post("/api/essays", auth, (req, res) => {
  const title = cleanText(req.body.title, 160) || "ไม่มีชื่อเรื่อง";
  const content = cleanText(req.body.content, 20000);
  const id = Number(req.body.id);

  if (content.length < 1) return res.status(400).json({ error: "เนื้อหายังว่างอยู่" });

  if (Number.isInteger(id) && id > 0) {
    const result = db.prepare(
      "UPDATE essays SET title=?,content=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?"
    ).run(title, content, id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: "ไม่พบบทความนี้" });
    return res.json({ id, message: "บันทึกแล้ว" });
  }

  const result = db.prepare(
    "INSERT INTO essays(user_id,title,content) VALUES(?,?,?)"
  ).run(req.user.id, title, content);
  res.status(201).json({ id: result.lastInsertRowid, message: "บันทึกแล้ว" });
});

app.delete("/api/essays/:id", auth, (req, res) => {
  const result = db.prepare("DELETE FROM essays WHERE id=? AND user_id=?")
    .run(Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: "ไม่พบบทความนี้" });
  res.json({ message: "ลบแล้ว" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`STUDENT THANWA OS running on port ${PORT}`);
  console.log(`Groq AI: ${groq ? "configured" : "NOT configured"}`);
});
