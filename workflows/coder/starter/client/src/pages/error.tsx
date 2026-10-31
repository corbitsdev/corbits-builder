import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button, EmptyState } from "@corbits/react-ui";

export function ErrorPage() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <EmptyState
        title="Something went wrong"
        description={detail}
        action={
          <Button onClick={() => window.location.reload()}>Reload</Button>
        }
      />
    </main>
  );
}
