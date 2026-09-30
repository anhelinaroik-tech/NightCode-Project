import { Hono } from "hono";
import { checkDatabaseConnection } from "@nightcode/database";

const app = new Hono()
    .get("/", async (c)=> {
        try{
            await checkDatabaseConnection();
            return c.json({status: "ok", database: "up"} as const, 200);
        } catch(error){
            console.error("[health]", error instanceof Error ? error.message : error);
            return c.json({status: "error", database: "down"} as const, 503);
        }
    });

export default app;
