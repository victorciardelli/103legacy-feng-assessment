# 103Legacy — Founding Engineer Technical Assessment

## What is 103Legacy?

103Legacy creates physical keepsake greeting cards with embedded HD screens that play compiled video messages. When someone has a milestone moment — a birthday, wedding, retirement — their loved ones each record a short video message through our platform. We compile those messages into a single video and deliver them inside a beautiful physical card.

## About This Repo

This is a simplified version of our **video upload and compilation pipeline**. Contributors upload video messages, and the system compiles them into a single final video with caption overlays. The organizer dashboard tracks contributor progress and triggers compilation.

**The code works in the happy path, but it's fragile.** Your job is to make it production-ready. See the assessment brief for full instructions.

## Tech Stack

This assessment uses a subset of our production stack:

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Frontend | React 18 + Wouter (routing) + Tailwind CSS |
| Backend | Express 4 + Zod (validation) |
| Video processing | FFmpeg (spawned via child_process) |
| Database | SQLite via better-sqlite3 (production uses PostgreSQL + Drizzle ORM) |
| File storage | Local disk (production uses Supabase signed URLs) |
| Shared types | `shared/types.ts` — Zod schemas + TypeScript types |

We use **Wouter** instead of React Router — it's our production router. If you haven't used it, the API is nearly identical (`useParams`, `Link`, `Route`).

## Setup

### Prerequisites
- Node.js 20+
- npm
- **FFmpeg** installed and on your PATH (required for video processing)
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install ffmpeg`
  - Windows: download from https://ffmpeg.org

### Installation

```bash
# Install root dependencies
npm install

# Install client dependencies + set up database + generate sample videos
npm run setup
```

The setup script creates the database, seeds a test project with 5 invited contributors, and generates 3 sample video files using FFmpeg. It also pre-seeds 2 submissions so you can test compilation immediately.

### Running

```bash
npm run dev
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001
- **Contributor upload page:** http://localhost:5173/upload/test-project-001
- **Organizer dashboard:** http://localhost:5173/dashboard/test-project-001

## Project Structure

```
├── server/
│   ├── index.ts              # Express server with all routes
│   ├── setup-db.ts           # Database schema, seed data, sample video generation
│   ├── videoProcessing.ts    # FFmpeg pipeline: probe, transcode, caption overlay, concat
│   └── compilationQueue.ts   # DB-backed job queue for video compilation
├── client/
│   └── src/
│       ├── main.tsx           # Wouter routing
│       ├── index.css          # Tailwind base
│       └── pages/
│           ├── HomePage.tsx
│           ├── UploadPage.tsx       # Contributor upload experience
│           └── DashboardPage.tsx    # Organizer dashboard + compile trigger
├── shared/
│   └── types.ts              # Zod schemas + TypeScript types (shared by client & server)
├── design/
│   └── wireframe.svg         # Low-fidelity wireframe for the upload flow
├── samples/                  # Generated sample videos for testing (created by setup)
├── uploads/                  # Where uploaded + compiled files are stored
└── db/                       # SQLite database
```

## Database Schema (4 tables)

| Table | Purpose |
|-------|---------|
| `projects` | Video gift projects (recipient, occasion, status, compiled video path) |
| `contributors` | Invited people who should submit a video (name, email, invite status) |
| `submissions` | Uploaded video files with metadata (path, caption, duration, display order, status) |
| `compilation_jobs` | Job queue tracking compilation progress (status, progress %, error, output path) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:projectId` | Get project with submissions + contributors |
| POST | `/api/projects/:projectId/upload` | Upload video (multipart, field: `video`) |
| POST | `/api/projects/:projectId/compile` | Trigger video compilation (returns jobId) |
| GET | `/api/compilation-jobs/:jobId` | Poll compilation job status + progress |
| GET | `/api/projects/:projectId/compilation-jobs` | List all compilation jobs for a project |
| PATCH | `/api/projects/:projectId/submissions/order` | Reorder submissions |
| DELETE | `/api/submissions/:submissionId` | Delete a submission |
| GET | `/api/projects/:projectId/contributors` | List invited contributors |

## Known Bugs & Limitations

### 1. No file validation
The server accepts any file type — PDFs, spreadsheets, executables. No check that the file is actually a video, and no file size limit.

### 2. Filename collisions
Uploaded files keep their original filename. If two contributors both upload `IMG_0001.MOV`, the second silently overwrites the first.

### 3. No upload progress
The frontend shows "Uploading..." with no progress indicator. For large files on slow mobile connections, contributors give up.

### 4. Generic error messages
Every error returns "Something went wrong." Contributors (often non-technical family members) have no way to diagnose or fix the problem.

### 5. No mobile responsiveness
The upload page uses hardcoded `w-[400px]` widths that overflow on mobile screens. ~70% of contributors open their upload link on their phone via text message.

### 6. Captions are silently lost
Contributors type a caption that should appear as a subtitle overlay in the compiled video. The caption field exists in the form and is sent to the server, but **the server never stores it in the database**. The `INSERT` statement omits the caption column entirely. When compilation runs, every caption is empty. The dashboard shows "—" for all captions with no warning.

### 7. Caption overlay crashes on special characters
The FFmpeg `drawtext` filter receives caption text without escaping. Captions containing colons, apostrophes, or backslashes (e.g., "Here's to you!" or "Love: Mom & Dad") cause FFmpeg to crash. Empty captions also cause unpredictable behavior.

### 8. Compilation assumes identical video formats
The concat step uses FFmpeg's concat demuxer, which requires all input files to have identical codecs, resolution, and framerate. If one contributor uploads 4K and another uploads 720p, the concat either fails or produces a corrupt file. Videos should be normalized before concatenation.

### 9. No compilation timeout or recovery
If FFmpeg hangs on a corrupted file, the compilation job stays "processing" forever. There's no timeout to kill the process. If the server restarts, stalled jobs are never recovered — they stay in "processing" state permanently.

### 10. Contributors not linked to submissions
When a contributor uploads a video, their `contributors` record is never updated. The organizer dashboard can't tell which invited people have actually submitted because there's no link between the `contributors` and `submissions` tables.

## Test Data

After running `npm run setup`:

- **Project ID:** `test-project-001`
- **Recipient:** Grandma Rose (80th Birthday)
- **Organizer:** Sarah
- **Contributors:** Uncle Mike, Aunt Lisa, Cousin Jake, Cousin Tommy, Grandpa Ed
- **Pre-seeded submissions:** 2 videos from Uncle Mike and Aunt Lisa (captions not stored — bug)
- **Sample videos:** 3 test videos in `samples/` (3-4 seconds each, colored backgrounds)

Click "Compile Card Video" on the dashboard to test the compilation pipeline immediately.
