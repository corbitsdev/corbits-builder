import { Outlet } from "react-router";
import {
  PageShell,
  ThemeToggle,
  TopBar,
  TopBarActions,
  TopBarTitle,
} from "@corbits/react-ui";

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopBar>
        <TopBarTitle>App</TopBarTitle>
        <TopBarActions>
          <ThemeToggle />
        </TopBarActions>
      </TopBar>
      <PageShell width="wide" className="flex-1">
        <Outlet />
      </PageShell>
    </div>
  );
}
