import { useState, useEffect, useCallback } from "react";
import { useParams } from "wouter";

export function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<any>(null);
  const [compilationJobs, setCompilationJobs] = useState<any[]>([]);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState("");

  const loadProject = useCallback(() => {
    fetch(`/api/projects/${projectId}`).then((r) => r.json()).then(setProject).catch(() => setError("Something went wrong"));
  }, [projectId]);

  const loadJobs = useCallback(() => {
    fetch(`/api/projects/${projectId}/compilation-jobs`).then((r) => r.json()).then(setCompilationJobs).catch(() => {});
  }, [projectId]);

  useEffect(() => { loadProject(); loadJobs(); }, [loadProject, loadJobs]);

  // Poll job status while compiling
  useEffect(() => {
    if (!compiling) return;
    const interval = setInterval(() => {
      loadJobs();
      loadProject();
    }, 2000);
    return () => clearInterval(interval);
  }, [compiling, loadJobs, loadProject]);

  // Check if compilation finished
  useEffect(() => {
    const activeJob = compilationJobs.find((j) => j.status === "processing" || j.status === "pending");
    if (compiling && !activeJob && compilationJobs.length > 0) setCompiling(false);
  }, [compilationJobs, compiling]);

  const handleCompile = async () => {
    setCompiling(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/compile`, { method: "POST" });
      if (!res.ok) { const data = await res.json(); setError(data.error); setCompiling(false); }
    } catch { setError("Failed to start compilation"); setCompiling(false); }
  };

  if (error && !project) return <div className="max-w-4xl mx-auto px-10 py-10"><p className="text-red-600">{error}</p></div>;
  if (!project) return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;

  const submissions = project.submissions || [];
  const contributors = project.contributors || [];
  const latestJob = compilationJobs[0];

  return (
    <div className="max-w-5xl mx-auto px-10 py-10">
      <h1 className="font-serif text-3xl font-semibold text-brand mb-1">
        Card for {project.recipient_name}
      </h1>
      <p className="text-gray-500 mb-6">{project.occasion} — organized by {project.organizer_name}</p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="text-2xl font-semibold text-brand">{submissions.length}</div>
          <div className="text-sm text-gray-500">Videos uploaded</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="text-2xl font-semibold text-amber-600">
            {contributors.filter((c: any) => c.invite_status === "invited").length}
          </div>
          <div className="text-sm text-gray-500">Pending</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="text-2xl font-semibold text-red-600">
            {submissions.filter((s: any) => !s.caption).length}
          </div>
          <div className="text-sm text-gray-500">Missing caption</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="text-sm font-medium text-gray-500 mb-1">Status</div>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
            project.status === "compiled" ? "bg-green-100 text-green-700" :
            project.status === "compiling" ? "bg-blue-100 text-blue-700" :
            project.status === "failed" ? "bg-red-100 text-red-700" :
            "bg-gray-100 text-gray-700"
          }`}>{project.status}</span>
        </div>
      </div>

      {/* Contributors */}
      <h2 className="text-lg font-semibold text-gray-800 mb-3">Contributors</h2>
      <div className="overflow-x-auto mb-8">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="pb-2 pr-4 text-sm font-medium text-gray-500">Name</th>
              <th className="pb-2 pr-4 text-sm font-medium text-gray-500">Status</th>
              <th className="pb-2 pr-4 text-sm font-medium text-gray-500">Caption</th>
              <th className="pb-2 pr-4 text-sm font-medium text-gray-500">File</th>
              <th className="pb-2 text-sm font-medium text-gray-500">Size</th>
            </tr>
          </thead>
          <tbody>
            {contributors.map((c: any) => {
              const sub = submissions.find((s: any) => s.contributor_id === c.id);
              return (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="py-3 pr-4 text-sm">{c.name}</td>
                  <td className="py-3 pr-4 text-sm">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.invite_status === "submitted" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                    }`}>{c.invite_status === "submitted" ? "Received" : "Pending"}</span>
                  </td>
                  <td className="py-3 pr-4 text-sm text-gray-500 italic">
                    {sub?.caption || "—"}
                  </td>
                  <td className="py-3 pr-4 text-sm text-gray-600">{sub?.filename || "—"}</td>
                  <td className="py-3 text-sm text-gray-600">
                    {sub?.file_size ? `${(sub.file_size / 1024 / 1024).toFixed(1)} MB` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Compile Section */}
      <div className="border-t border-gray-200 pt-6">
        <div className="flex items-center gap-4">
          <button onClick={handleCompile} disabled={compiling || submissions.length === 0}
            className="px-6 py-3 bg-brand text-white rounded-lg font-medium hover:bg-brand-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {compiling ? "Compiling..." : "Compile Card Video"}
          </button>

          {latestJob && (
            <div className="text-sm">
              <span className={`font-medium ${
                latestJob.status === "completed" ? "text-green-600" :
                latestJob.status === "failed" ? "text-red-600" :
                latestJob.status === "processing" ? "text-blue-600" :
                "text-gray-600"
              }`}>
                {latestJob.status === "processing" ? `Compiling: ${latestJob.progress}%` :
                 latestJob.status === "completed" ? "Compilation complete" :
                 latestJob.status === "failed" ? `Failed: ${latestJob.error}` :
                 "Queued"}
              </span>
            </div>
          )}
        </div>

        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </div>
    </div>
  );
}
