import { Hono } from "hono";

// The CLI's local callback port, from the state it generated. Null if missing or not a valid unprivileged port.
function getCallbackPort(state: string | undefined): number | null {
  try {
    const [encoded] = (state ?? "").split(".");
    if (!encoded) return null;

    const port = JSON.parse(Buffer.from(encoded, "base64url").toString())?.port;
    return typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535
      ? port
      : null;
  } catch {
    return null;
  }
}

// Literal loopback IP rather than "localhost", which could resolve to another listener (RFC 8252)
function callbackUrl(port: number, params: Record<string, string>) {
  return `http://127.0.0.1:${port}/callback?${new URLSearchParams(params)}`;
}

const app = new Hono().get("/callback", (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  const errorDescription = c.req.query("error_description");

  const port = getCallbackPort(state);

  if (error) {
    // Forward to the CLI so /login fails right away instead of waiting for its timeout
    if (port) {
      return c.redirect(callbackUrl(port, {
        error,
        ...(errorDescription ? { error_description: errorDescription } : {}),
      }));
    }
    return c.text(errorDescription ?? error, 400);
  }

  if (!code || !state) {
    return c.text("Missing authorization code or state", 400);
  }

  if (!port) {
    return c.text("Invalid authentication state", 400);
  }

  return c.redirect(callbackUrl(port, { code, state }));
});

export default app;
