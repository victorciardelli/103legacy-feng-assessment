import { useState, useEffect } from "react";
import { useParams } from "wouter";

type UploadStatus = "idle" | "uploading" | "done" | "error";

export function UploadPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then(setProject)
      .catch(() => setErrorMsg("Something went wrong"));
  }, [projectId]);

  const handleUpload = async () => {
    if (!file) { alert("Please select a file"); return; }
    setStatus("uploading");
    setErrorMsg("");

    const formData = new FormData();
    formData.append("video", file);
    formData.append("contributorName", name || "Anonymous");
    formData.append("caption", caption);

    try {
      const res = await fetch(`/api/projects/${projectId}/upload`, { method: "POST", body: formData });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Something went wrong"); }
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  if (!project) return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;

  return (
    <div className="max-w-lg mx-auto px-10 py-10">
      <h1 className="font-serif text-3xl font-semibold text-brand mb-1">
        Record a message for {project.recipient_name}
      </h1>
      <p className="text-gray-500 mb-8">{project.occasion} — organized by {project.organizer_name}</p>

      {status === "done" ? (
        <div>
          <h2 className="text-xl font-semibold text-green-700">Upload complete!</h2>
          <p className="text-gray-600 mt-2">Thanks for your message.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your name"
              className="w-[400px] px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Caption for your video</label>
            <p className="text-xs text-gray-400 mb-1.5">This text will appear as a subtitle when your video plays in the card.</p>
            <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)}
              placeholder='e.g. "Happy birthday from the whole family!"'
              className="w-[400px] px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select video file</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-[400px] text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
          </div>

          {file && <p className="text-sm text-gray-500">Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}

          <button onClick={handleUpload} disabled={status === "uploading"}
            className="px-8 py-3 bg-brand text-white rounded-lg font-medium hover:bg-brand-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {status === "uploading" ? "Uploading..." : "Upload Video"}
          </button>

          {status === "error" && <p className="text-red-600 text-sm">{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}
