import { createBrowserRouter } from "react-router";
import { Layout } from "./components/layout.tsx";
import { ErrorPage } from "./pages/error.tsx";
import { Home } from "./pages/home.tsx";
import { NotFound } from "./pages/not-found.tsx";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Home /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
