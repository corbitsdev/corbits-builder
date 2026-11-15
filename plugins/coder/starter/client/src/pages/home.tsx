import { EmptyState, StatusDot } from "@corbits/react-ui";
import { useHealth } from "../api.ts";
import { QueryState } from "../components/query-state.tsx";

export function Home() {
  return (
    <section className="flex flex-col items-center gap-6 py-16">
      <EmptyState
        title="Nothing here yet"
        description="This app is ready to be built."
      />
      <QueryState query={useHealth()}>
        {() => (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusDot tone="success" label="Server connected" />
            <span aria-hidden="true">Server connected</span>
          </p>
        )}
      </QueryState>
    </section>
  );
}
