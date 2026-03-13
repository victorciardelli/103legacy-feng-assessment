import { Link } from "wouter";

export function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="font-serif text-4xl font-semibold text-brand mb-2">103Legacy</h1>
      <p className="text-gray-500 mb-8 text-center max-w-md">
        Founding engineer technical assessment — video upload + compilation pipeline.
      </p>
      <div className="flex flex-col gap-3">
        <Link href="/upload/test-project-001" className="px-6 py-3 bg-brand text-white rounded-lg text-center hover:bg-brand-light transition-colors">
          Contributor Upload Page
        </Link>
        <Link href="/dashboard/test-project-001" className="px-6 py-3 border border-brand text-brand rounded-lg text-center hover:bg-gray-50 transition-colors">
          Organizer Dashboard
        </Link>
      </div>
      <p className="text-sm text-gray-400 mt-8">
        Run <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">npm run db:setup</code> first.
      </p>
    </div>
  );
}
