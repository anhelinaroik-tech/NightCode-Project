import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { checkDatabaseConnection } from "@nightcode/database/client";
import sessions from "./routes/sessions"
import health from "./routes/health"
import * as Sentry from "@sentry/hono/bun";

const app = new Hono();

// Must be registered before any routes so every request is traced and errors reach Sentry.
// Without SENTRY_DSN the SDK stays disabled and the server runs normally.
app.use(
    Sentry.sentry(app, {
        dsn: process.env.SENTRY_DSN,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    }),
);

// Unauthenticated and always throws, so keep it out of production
if (process.env.NODE_ENV !== "production") {
    app.get("/debug-sentry", () => {
        // Send a log and a metric before throwing the error
        Sentry.logger.info("User triggered test error", {
            action: "test_error_endpoint",
        });
        Sentry.metrics.count("test_counter", 1);
        throw new Error("My first Sentry error!");
    });
}

app.onError((error, c)=> {
    if(error instanceof HTTPException){
        Sentry.logger.warn("Handled HTTP error", {
            status: error.status,
            message: error.message || "Request failed",
            path: c.req.path,
            method: c.req.method,
        });
        return c.json({
            error: error.message || "Request failed"
        }, error.status);
    };

    console.error("Unhandled server error", error);
    Sentry.logger.error("Unhandled server error",{
        path: c.req.path,
        method: c.req.method,
        message: error instanceof Error ? error.message : "Unknown error",
    });
    return c.json({error: "Internal server error"}, 500);
});

// registered to app all routes
const routes = app
    .route("/health", health)
    .route("/sessions", sessions);
export type AppType = typeof routes;

// Fail fast with a readable message instead of serving requests that will all fail
try{
    await checkDatabaseConnection();
} catch(error){
    console.error(`[server] ${error instanceof Error ? error.message : error}`);
    console.error("[server] Check DATABASE_URL in .env and that the database is running.");
    process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
console.log(`[server] Listening on http://localhost:${port}`);

// idleTimeout must be high, otherwise LLM tool calls might not complete
export default {port, fetch: app.fetch, idleTimeout: 255};
