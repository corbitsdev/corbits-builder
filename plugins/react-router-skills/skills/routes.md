# Routes in React Router

- Import from `react-router`. The starter defines its routes with `createBrowserRouter([...])` in `client/src/routes.tsx` and renders `<RouterProvider router={router} />`; add a page as a route object there.
- Shared chrome (header, navigation) is a layout route whose `element` renders `<Outlet />`; its child routes render inside it. An `index: true` child is the layout's default page.
- Dynamic segments are `path: "items/:id"`; read them with `useParams()`. Query-string state is `useSearchParams()`.
- Navigate with `<Link to>` or `<NavLink>` (which marks the active link), and from code after an action with `useNavigate()`.
- Give the root route an `errorElement` so a thrown error or unknown URL shows a page instead of a blank screen, and add a `path: "*"` route for not found.
- In the starter, data comes from TanStack Query (`useQuery`, `useMutation`) rather than route loaders; follow what the app already does instead of mixing both for the same data.
