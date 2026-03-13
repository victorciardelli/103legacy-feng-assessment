import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "../db/uploads.db");

if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// ─── Schema (4 tables mirroring production core) ───────────

db.exec(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    recipient_name TEXT NOT NULL,
    occasion TEXT NOT NULL,
    organizer_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'collecting',
    compiled_video_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE contributors (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    email TEXT,
    invite_status TEXT NOT NULL DEFAULT 'invited',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    contributor_id TEXT REFERENCES contributors(id),
    contributor_name TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT,
    file_size INTEGER,
    caption TEXT DEFAULT '',
    duration_seconds REAL,
    display_order INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'received',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE compilation_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    error TEXT,
    output_path TEXT,
    total_segments INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
`);

console.log("Schema created (4 tables: projects, contributors, submissions, compilation_jobs)\n");

// ─── Seed Data ─────────────────────────────────────────────

const projectId = "test-project-001";

db.prepare(`
  INSERT INTO projects (id, recipient_name, occasion, organizer_name, status)
  VALUES (?, 'Grandma Rose', '80th Birthday', 'Sarah', 'collecting')
`).run(projectId);

const contributors = [
  { id: uuidv4(), name: "Uncle Mike", email: "mike@example.com" },
  { id: uuidv4(), name: "Aunt Lisa", email: "lisa@example.com" },
  { id: uuidv4(), name: "Cousin Jake", email: "jake@example.com" },
  { id: uuidv4(), name: "Cousin Tommy", email: "tommy@example.com" },
  { id: uuidv4(), name: "Grandpa Ed", email: "ed@example.com" },
];

for (const c of contributors) {
  db.prepare(`
    INSERT INTO contributors (id, project_id, name, email, invite_status)
    VALUES (?, ?, ?, ?, 'invited')
  `).run(c.id, projectId, c.name, c.email);
}

console.log(`Test project: ${projectId}`);
console.log(`  Recipient: Grandma Rose (80th Birthday)`);
console.log(`  Organizer: Sarah`);
console.log(`  Contributors: ${contributors.map(c => c.name).join(", ")}\n`);

// ─── Generate Sample Videos ────────────────────────────────
// Creates 3 short test videos using FFmpeg so the candidate has real
// video files to work with for the compilation pipeline.

const samplesDir = path.join(__dirname, "../samples");
if (!fs.existsSync(samplesDir)) fs.mkdirSync(samplesDir, { recursive: true });

const sampleVideos = [
  { name: "sample_1.mp4", color: "blue", text: "Happy Birthday Grandma!", duration: 3 },
  { name: "sample_2.mp4", color: "green", text: "We love you so much!", duration: 4 },
  { name: "sample_3.mp4", color: "red", text: "Cheers to 80 years!", duration: 3 },
];

let ffmpegAvailable = false;
try {
  execSync("ffmpeg -version", { stdio: "pipe" });
  ffmpegAvailable = true;
} catch {
  try {
    // Check for ffmpeg-static
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      ffmpegAvailable = true;
    }
  } catch {}
}

if (ffmpegAvailable) {
  console.log("Generating sample test videos...");
  for (const sample of sampleVideos) {
    const outputPath = path.join(samplesDir, sample.name);
    if (fs.existsSync(outputPath)) continue;

    try {
      execSync(
        `ffmpeg -f lavfi -i color=c=${sample.color}:s=640x480:d=${sample.duration} ` +
        `-f lavfi -i anullsrc=r=48000:cl=stereo -t ${sample.duration} ` +
        `-vf "drawtext=text='${sample.text}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" ` +
        `-c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p ` +
        `-c:a aac -b:a 64k -shortest -y "${outputPath}"`,
        { stdio: "pipe" }
      );
      console.log(`  Created: ${sample.name} (${sample.duration}s, ${sample.color} bg)`);
    } catch (err) {
      // Simpler fallback without text overlay
      try {
        execSync(
          `ffmpeg -f lavfi -i color=c=${sample.color}:s=640x480:d=${sample.duration} ` +
          `-f lavfi -i anullsrc=r=48000:cl=stereo -t ${sample.duration} ` +
          `-c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p ` +
          `-c:a aac -b:a 64k -shortest -y "${outputPath}"`,
          { stdio: "pipe" }
        );
        console.log(`  Created: ${sample.name} (${sample.duration}s, no text overlay)`);
      } catch {
        console.warn(`  Could not create ${sample.name} — FFmpeg may not support all filters`);
      }
    }
  }

  // Pre-seed two submissions so the dashboard has data and compile can be tested immediately
  const uploadsDir = path.join(__dirname, "../uploads", projectId);
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const seededSubs = [
    { contributor: contributors[0], sample: sampleVideos[0], caption: "Happy 80th birthday Mom! Love you forever." },
    { contributor: contributors[1], sample: sampleVideos[1], caption: "" }, // intentionally empty caption
  ];

  for (let i = 0; i < seededSubs.length; i++) {
    const { contributor, sample, caption } = seededSubs[i];
    const samplePath = path.join(samplesDir, sample.name);
    if (!fs.existsSync(samplePath)) continue;

    const filename = `${contributor.name.toLowerCase().replace(/ /g, "_")}_${uuidv4().slice(0, 8)}.mp4`;
    const destPath = path.join(uploadsDir, filename);
    fs.copyFileSync(samplePath, destPath);
    const fileSize = fs.statSync(destPath).size;

    const subId = uuidv4();
    // BUG: Caption is accepted but never stored (same bug as the upload endpoint)
    db.prepare(`
      INSERT INTO submissions (id, project_id, contributor_id, contributor_name, filename, file_path, file_size, duration_seconds, display_order, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
    `).run(subId, projectId, contributor.id, contributor.name, filename, destPath, fileSize, sample.duration, i);

    db.prepare(`UPDATE contributors SET invite_status = 'submitted' WHERE id = ?`).run(contributor.id);

    console.log(`  Seeded submission: ${contributor.name} → ${filename}${caption ? " (caption not stored — bug)" : " (no caption)"}`);
  }
} else {
  console.warn("FFmpeg not found — sample videos not generated.");
  console.warn("Install FFmpeg to enable video processing tests: brew install ffmpeg");
}

db.close();

console.log(`\nSetup complete!`);
console.log(`  Database: ${dbPath}`);
console.log(`  Upload page: http://localhost:5173/upload/${projectId}`);
console.log(`  Dashboard:   http://localhost:5173/dashboard/${projectId}`);
