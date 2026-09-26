import { Suspense } from "react";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { Dashboard } from "@/components/dashboard";
export default function Home() {
  return (
    <WorkspaceProvider>
      <Suspense
        fallback={<div className="app-loading">Opening your workspace...</div>}
      >
        <Dashboard />
      </Suspense>
    </WorkspaceProvider>
  );
}
