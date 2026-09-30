import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { checkDatabaseConnection } from "@nightcode/database";
import sessions from "./routes/sessions"
import health from "./routes/health"

const app = new Hono();

app.onError((error, c)=> {
    if(error instanceof HTTPException){
        return c.json ({
            error: error.message || "Request failed"
        }, error.status);
    };

    console.error("Unhandled server error", error);
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

const port = 3000;
console.log(`[server] Listening on http://localhost:${port}`);

// idleTimeout must be high, otherwise LLM tool calls might not complete
export default {port, fetch: app.fetch, idleTimeout: 255};
