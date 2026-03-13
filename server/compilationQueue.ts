import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { probeVideo, overlayCaptionOnVideo, concatenateVideos } from "./videoProcessing.js";

import type { CompilationJob, Submission } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Queue ─────────────────────────────────────────────────
// Modeled on our production compilation queue:
// - DB-backed so job status survives server restarts
// - Serial processing (one at a time) to prevent OOM from concurrent FFmpeg
// - Progress tracking so the frontend can poll for updates
//
// BUGS in this implementation:
// 1. No stalled job recovery. If the server crashes mid-compile, the job stays
//    "processing" forever. Production has recoverStalledJobs() on startup.
// 2. No timeout on the FFmpeg pipeline. A corrupted video can hang forever.
// 3. Captions are read from submissions but were never stored (see upload bug).
// 4. No cleanup of temp files on failure — fills up disk over time.
// 5. concatenateVideos assumes all clips are same resolution (they won't be).

let processing = false;

function getDb(): Database.Database {
  return new Database(path.join(__dirname, "../db/uploads.db"));
}

export function addCompilationJob(projectId: string): string {
  const db = getDb();
  const id = `${projectId}-${Date.now()}`;

  db.prepare(`
    INSERT INTO compilation_jobs (id, project_id, status, progress, created_at)
    VALUES (?, ?, 'pending', 0, datetime('now'))
  `).run(id, projectId);

  db.close();

  // Kick off processing on next tick
  setImmediate(() => processNext());

  return id;
}

export function getCompilationJob(jobId: string): CompilationJob | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM compilation_jobs WHERE id = ?").get(jobId) as any;
  db.close();
  if (!row) return undefined;
  return rowToJob(row);
}

export function getJobsByProject(projectId: string): CompilationJob[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM compilation_jobs WHERE project_id = ? ORDER BY created_at DESC"
  ).all(projectId) as any[];
  db.close();
  return rows.map(rowToJob);
}

function updateJobStatus(
  jobId: string,
  status: string,
  updates: { progress?: number; error?: string; outputPath?: string; totalSegments?: number } = {}
) {
  const db = getDb();
  const completedAt = (status === "completed" || status === "failed") ? new Date().toISOString() : null;

  db.prepare(`
    UPDATE compilation_jobs
    SET status = ?, progress = COALESCE(?, progress), error = COALESCE(?, error),
        output_path = COALESCE(?, output_path), total_segments = COALESCE(?, total_segments),
        completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `).run(status, updates.progress ?? null, updates.error ?? null,
         updates.outputPath ?? null, updates.totalSegments ?? null,
         completedAt, jobId);
  db.close();
}

async function processNext(): Promise<void> {
  if (processing) return;
  processing = true;

  const db = getDb();
  try {
    const row = db.prepare(
      "SELECT * FROM compilation_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    ).get() as any;

    if (!row) {
      processing = false;
      db.close();
      return;
    }

    const job = rowToJob(row);
    db.close();

    updateJobStatus(job.id, "processing", { progress: 5 });
    console.log(`[Compile] Starting job ${job.id} for project ${job.projectId}`);

    try {
      await executeCompilation(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown compilation error";
      console.error(`[Compile] Job ${job.id} failed:`, message);
      updateJobStatus(job.id, "failed", { error: message });

      // Update project status
      const db2 = getDb();
      db2.prepare("UPDATE projects SET status = 'failed' WHERE id = ?").run(job.projectId);
      db2.close();
    }
  } catch (err) {
    console.error("[Compile] Queue error:", err);
  } finally {
    processing = false;

    // Check for more pending jobs
    const db3 = getDb();
    const next = db3.prepare(
      "SELECT id FROM compilation_jobs WHERE status = 'pending' LIMIT 1"
    ).get();
    db3.close();
    if (next) processNext();
  }
}

async function executeCompilation(job: CompilationJob): Promise<void> {
  const db = getDb();

  // Get submissions for this project
  const submissions = db.prepare(
    "SELECT * FROM submissions WHERE project_id = ? AND status IN ('ready', 'received') ORDER BY display_order ASC"
  ).all(job.projectId) as any[];
  db.close();

  if (submissions.length === 0) {
    throw new Error("No submissions to compile");
  }

  updateJobStatus(job.id, "processing", { progress: 10, totalSegments: submissions.length });

  const outputDir = path.join(__dirname, "../uploads", job.projectId, "compiled");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const captionedPaths: string[] = [];

  // Step 1: Overlay captions on each submission
  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i];
    const inputPath = sub.file_path;

    if (!inputPath || !fs.existsSync(inputPath)) {
      console.warn(`[Compile] Submission ${sub.id} has no file — skipping`);
      continue;
    }

    const progress = 10 + Math.round((i / submissions.length) * 60);
    updateJobStatus(job.id, "processing", { progress });

    // BUG: sub.caption is always empty because the upload endpoint never stores it.
    // Even if the contributor typed a caption, this will overlay an empty string.
    const caption = sub.caption || "";
    const contributorName = sub.contributor_name;

    if (caption) {
      const captionedPath = path.join(outputDir, `captioned_${i}.mp4`);
      await overlayCaptionOnVideo(inputPath, captionedPath, caption, contributorName);
      captionedPaths.push(captionedPath);
    } else {
      // BUG: When there's no caption, we just use the raw file as-is.
      // This means the concat step gets a mix of captioned (re-encoded) and
      // raw (potentially different codec/resolution) files. The concat demuxer
      // requires all inputs to have identical stream parameters.
      captionedPaths.push(inputPath);
    }
  }

  if (captionedPaths.length === 0) {
    throw new Error("No valid video files found for compilation");
  }

  // Step 2: Concatenate all clips into final video
  updateJobStatus(job.id, "processing", { progress: 75 });
  const finalPath = path.join(outputDir, `final_${Date.now()}.mp4`);

  await concatenateVideos(captionedPaths, finalPath);

  if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size === 0) {
    throw new Error("Compiled video is empty or missing");
  }

  // Step 3: Update job and project
  updateJobStatus(job.id, "completed", { progress: 100, outputPath: finalPath });

  const db2 = getDb();
  db2.prepare(
    "UPDATE projects SET status = 'compiled', compiled_video_path = ? WHERE id = ?"
  ).run(finalPath, job.projectId);
  db2.close();

  console.log(`[Compile] Job ${job.id} completed: ${finalPath}`);
}

function rowToJob(row: any): CompilationJob {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    progress: row.progress ?? 0,
    error: row.error ?? null,
    outputPath: row.output_path ?? null,
    totalSegments: row.total_segments ?? null,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  };
}

// BUG: No recoverStalledJobs() function. In production, when the server starts,
// it resets any jobs stuck in "processing" back to "pending" so they get retried.
// Without this, a server crash during compilation leaves orphaned jobs forever.
