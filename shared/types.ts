import { z } from "zod";

// ─── Zod Schemas ───────────────────────────────────────────

export const projectSchema = z.object({
  id: z.string(),
  recipientName: z.string().min(1),
  occasion: z.string().min(1),
  organizerName: z.string().min(1),
  status: z.enum(["collecting", "compiling", "compiled", "failed"]),
  compiledVideoPath: z.string().nullable(),
  createdAt: z.string(),
});

export const contributorSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  email: z.string().nullable(),
  inviteStatus: z.enum(["invited", "submitted"]),
  createdAt: z.string(),
});

export const submissionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  contributorId: z.string().nullable(),
  contributorName: z.string().min(1),
  filename: z.string(),
  filePath: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  caption: z.string().default(""),
  durationSeconds: z.number().nullable(),
  displayOrder: z.number().int().default(0),
  status: z.enum(["received", "processing", "ready", "failed", "needs_transcode"]),
  createdAt: z.string(),
});

export const compilationJobSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
  outputPath: z.string().nullable(),
  totalSegments: z.number().int().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const uploadRequestSchema = z.object({
  contributorName: z.string().optional().default("Anonymous"),
  caption: z.string().max(120).optional().default(""),
});

// ─── TypeScript Types ──────────────────────────────────────

export type Project = z.infer<typeof projectSchema>;
export type Contributor = z.infer<typeof contributorSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type CompilationJob = z.infer<typeof compilationJobSchema>;

export interface ProjectWithDetails extends Project {
  submissions: Submission[];
  contributors: Contributor[];
}

export interface ApiError {
  error: string;
  code?: string;
  details?: string;
}
