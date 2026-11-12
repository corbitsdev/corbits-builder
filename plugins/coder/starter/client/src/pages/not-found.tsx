import { Link } from "react-router";
import { Button, EmptyState } from "@corbits/react-ui";

export function NotFound() {
  return (
    <EmptyState
      className="py-16"
      title="Page not found"
      description="The address may be mistyped or the page may have moved."
      action={
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
      }
    />
  );
}
