import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Skeleton } from "@corbits/react-ui";

// Every screen that loads data renders through this, so loading, failure and "nothing yet" look the
// same everywhere and none of them is forgotten.
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending)
    return (
      <div
        className="flex flex-col gap-3"
        aria-busy="true"
        data-testid="query-loading"
      >
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-2/3" />
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" data-testid="query-error">
        <EmptyState
          title="Something went wrong"
          description={query.error.message}
          action={
            <Button onClick={() => void query.refetch()}>Try again</Button>
          }
        />
      </div>
    );
  if (empty !== undefined && isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
