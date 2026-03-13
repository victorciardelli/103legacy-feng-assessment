import { spawn } from "child_process";
import fs from "fs";
import path from "path";

// ─── FFmpeg Path ───────────────────────────────────────────

let ffmpegPath = "ffmpeg";
let ffprobePath = "ffprobe";

try {
  const ffmpegStatic = require("ffmpeg-static") as string;
  if (ffmpegStatic) ffmpegPath = ffmpegStatic;
} catch {}

try {
  const ffprobeStatic = require("ffprobe-static") as { path: string };
  if (ffprobeStatic?.path) ffprobePath = ffprobeStatic.path;
} catch {}

// ─── Probe ─────────────────────────────────────────────────

interface ProbeResult {
  videoCodec: string;
  audioCodec: string;
  duration: number;
  width: number;
  height: number;
  needsTranscode: boolean;
}

const INCOMPATIBLE_CODECS = ["hevc", "h265", "hev1", "hvc1", "vp9", "av1"];

export function probeVideo(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath,
    ]);

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffprobe failed"));
      try {
        const info = JSON.parse(stdout);
        const streams = info.streams || [];
        const videoStream = streams.find((s: any) => s.codec_type === "video");
        const audioStream = streams.find((s: any) => s.codec_type === "audio");

        const videoCodec = (videoStream?.codec_name || "").toLowerCase();
        const audioCodec = (audioStream?.codec_name || "").toLowerCase();

        resolve({
          videoCodec,
          audioCodec,
          duration: parseFloat(info.format?.duration || "0"),
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          needsTranscode: INCOMPATIBLE_CODECS.includes(videoCodec),
        });
      } catch (e) {
        reject(e);
      }
    });
    proc.on("error", reject);
  });
}

// ─── Transcode ─────────────────────────────────────────────

export function transcodeToH264(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // BUG: No timeout. If FFmpeg hangs on a corrupted file, this promise
    // never resolves. The real production code has a 10-minute timeout that
    // kills the process. Without it, the server can accumulate zombie FFmpeg
    // processes that consume memory indefinitely.
    const args = [
      "-i", inputPath,
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Transcode failed (code ${code}): ${stderr.slice(-300)}`));
      resolve();
    });
    proc.on("error", reject);
  });
}

// ─── Caption Overlay ───────────────────────────────────────

// BUG: This function is supposed to burn a caption as subtitle text onto the
// video. But it has multiple issues:
// 1. It doesn't escape special characters in the caption text. If a user types
//    a caption with colons, quotes, or backslashes, FFmpeg's drawtext filter
//    will crash or produce garbled output.
// 2. It doesn't handle empty captions. If caption is "", the drawtext filter
//    gets an empty text= parameter which may render unpredictably.
// 3. No font fallback. If the default font isn't available on the system,
//    the text overlay silently fails with no caption shown.
export function overlayCaptionOnVideo(
  inputPath: string,
  outputPath: string,
  caption: string,
  contributorName: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // BUG: caption text is inserted directly into the filter string without
    // escaping FFmpeg special characters (: ' \ etc). This will crash on
    // captions like "Here's to you!" or "Love: Mom & Dad"
    const drawFilter =
      `drawtext=text='${caption}':fontsize=28:fontcolor=white:` +
      `x=(w-text_w)/2:y=h-80:box=1:boxcolor=black@0.6:boxborderw=8,` +
      `drawtext=text='— ${contributorName}':fontsize=20:fontcolor=white@0.8:` +
      `x=(w-text_w)/2:y=h-40`;

    const args = [
      "-i", inputPath,
      "-vf", drawFilter,
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-c:a", "copy",
      "-y", outputPath,
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Caption overlay failed: ${stderr.slice(-300)}`));
      resolve();
    });
    proc.on("error", reject);
  });
}

// ─── Concatenation ─────────────────────────────────────────

// BUG: This concatenation approach assumes all input videos have the same
// resolution, framerate, and codec. If one contributor uploaded a 4K video
// and another uploaded 720p, the concat demuxer will either fail or produce
// a corrupt output. The production pipeline normalizes all clips to a
// consistent format before concatenating — this doesn't.
export function concatenateVideos(inputPaths: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const listFile = outputPath + ".txt";
    const listContent = inputPaths.map((p) => `file '${p}'`).join("\n");
    fs.writeFileSync(listFile, listContent);

    const args = [
      "-f", "concat", "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      "-y", outputPath,
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      try { fs.unlinkSync(listFile); } catch {}
      if (code !== 0) return reject(new Error(`Concat failed: ${stderr.slice(-300)}`));
      resolve();
    });
    proc.on("error", reject);
  });
}
