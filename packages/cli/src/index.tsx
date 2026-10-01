import * as Sentry from "@sentry/bun";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";
import { NotFound } from "./screens/not-found";

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout/>,
     children: [
      {index: true, element: <Home/>},
      {path: "sessions/new", element: <NewSession/>},
      {path: "sessions/:id", element: <Session/> },
      {path: "*", element: <NotFound/>},
     ]
  }
]);

function App() {
  return <RouterProvider router={router}/>
}

// Initialised before the renderer so startup errors are captured too.
// Without SENTRY_DSN the SDK stays disabled and the CLI runs normally.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
});

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);
