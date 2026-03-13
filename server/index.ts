import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

import { addCompilationJob, getCompilationJob, getJobsByProject } from "./compilationQueue.js";
import { probeVideo } from "./videoProcessing.js";

import type { ApiError } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

function getDb(): Database.Database {
  return new Database(path.join(__dirname, "../db/uploads.db"));
}

// ─── File Storage ──────────────────────────────────────────

// BUG: No file size limit. Large phone videos (100MB+) will timeout or OOM.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads/temp");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // BUG: Using original filename → collisions when two contributors
    // upload files with the same name (e.g. IMG_0001.MOV)
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

// ─── Project Routes ────────────────────────────────────────

app.get("/api/projects/:projectId", (req, res) => {
  const db = getDb();
  try {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.projectId) as any;
    if (!project) return res.status(404).json({ error: "Project not found" } as ApiError);

    const submissions = db.prepare(
      "SELECT * FROM submissions WHERE project_id = ? ORDER BY display_order ASC"
    ).all(req.params.projectId);

    const contributors = db.prepare(
      "SELECT * FROM contributors WHERE project_id = ?"
    ).all(req.params.projectId);

    res.json({ ...project, submissions, contributors });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" } as ApiError);
  } finally {
    db.close();
  }
});

// ─── Upload Route ──────────────────────────────────────────

// BUG: No file type validation. Accepts any file (PDFs, executables, etc).
// BUG: No upload progress — frontend stares at "Uploading..." with no feedback.
// BUG: Generic "Something went wrong" for every error type.
app.post("/api/projects/:projectId/upload", upload.single("video"), (req, res) => {
  const db = getDb();
  try {
    const { projectId } = req.params;
    const contributorName = (req.body.contributorName as string) || "Anonymous";
    const caption = (req.body.caption as string) || "";

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
    if (!project) return res.status(404).json({ error: "Something went wrong" } as ApiError);
    if (!req.file) return res.status(400).json({ error: "Something went wrong" } as ApiError);

    // Move file from temp to project directory
    const projectDir = path.join(__dirname, "../uploads", projectId);
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
    const destPath = path.join(projectDir, req.file.originalname);
    fs.renameSync(req.file.path, destPath);

    const submissionId = uuidv4();

    // BUG: Caption is accepted from the form but SILENTLY DROPPED here.
    // The INSERT statement doesn't include the caption column.
    // When compilation runs, every caption is empty.
    db.prepare(`
      INSERT INTO submissions (id, project_id, contributor_name, filename, file_path, file_size, display_order, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM submissions WHERE project_id = ?), 'received', datetime('now'))
    `).run(submissionId, projectId, contributorName, req.file.originalname, destPath, req.file.size, projectId);

    // BUG: Contributor is not linked to the submission.
    // Even if the contributor was invited, we don't match them or update their invite_status.
    // The organizer dashboard can't tell which invited contributors have submitted.

    res.json({ success: true, submissionId, message: "Upload complete" });
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "Something went wrong" } as ApiError);
  } finally {
    db.close();
  }
});

// ─── Compile Route ─────────────────────────────────────────

app.post("/api/projects/:projectId/compile", (req, res) => {
  const db = getDb();
  try {
    const { projectId } = req.params;

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
    if (!project) return res.status(404).json({ error: "Project not found" } as ApiError);

    const submissions = db.prepare(
      "SELECT * FROM submissions WHERE project_id = ? AND status IN ('ready', 'received')"
    ).all(projectId) as any[];

    if (submissions.length === 0) {
      return res.status(400).json({ error: "No videos to compile" } as ApiError);
    }

    // Update project status
    db.prepare("UPDATE projects SET status = 'compiling' WHERE id = ?").run(projectId);

    // Queue the compilation job
    const jobId = addCompilationJob(projectId);

    res.json({ success: true, jobId, message: "Compilation started" });
  } catch (err) {
    console.error("Compile trigger failed:", err);
    res.status(500).json({ error: "Something went wrong" } as ApiError);
  } finally {
    db.close();
  }
});

// ─── Job Status (for polling) ──────────────────────────────

app.get("/api/compilation-jobs/:jobId", (req, res) => {
  const job = getCompilationJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" } as ApiError);
  res.json(job);
});

app.get("/api/projects/:projectId/compilation-jobs", (req, res) => {
  const jobs = getJobsByProject(req.params.projectId);
  res.json(jobs);
});

// ─── Submission Management ─────────────────────────────────

app.delete("/api/submissions/:submissionId", (req, res) => {
  const db = getDb();
  try {
    const sub = db.prepare("SELECT * FROM submissions WHERE id = ?").get(req.params.submissionId) as any;
    if (!sub) return res.status(404).json({ error: "Submission not found" } as ApiError);

    // Delete the file
    if (sub.file_path && fs.existsSync(sub.file_path)) {
      fs.unlinkSync(sub.file_path);
    }

    db.prepare("DELETE FROM submissions WHERE id = ?").run(req.params.submissionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" } as ApiError);
  } finally {
    db.close();
  }
});

// Reorder submissions
app.patch("/api/projects/:projectId/submissions/order", (req, res) => {
  const db = getDb();
  try {
    const { order } = req.body as { order: { submissionId: string; displayOrder: number }[] };
    for (const item of order) {
      db.prepare("UPDATE submissions SET display_order = ? WHERE id = ?").run(item.displayOrder, item.submissionId);
    }
    const submissions = db.prepare(
      "SELECT * FROM submissions WHERE project_id = ? ORDER BY display_order ASC"
    ).all(req.params.projectId);
    res.json(submissions);
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" } as ApiError);
  } finally {
    db.close();
  }
});

// ─── Contributors ──────────────────────────────────────────

app.get("/api/projects/:projectId/contributors", (req, res) => {
  const db = getDb();
  try {
    const contributors = db.prepare(
      "SELECT * FROM contributors WHERE project_id = ?"
    ).all(req.params.projectId);
    res.json(contributors);
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" } as ApiError);
  } finally {
    db.close();
  }
});

// ─── Start ─────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
