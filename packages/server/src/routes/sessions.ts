import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {zValidator} from "@hono/zod-validator"
import {z} from "zod";
import {db} from "@nightcode/database/client";
import { Role, Mode, MessageStatus} from "@nightcode/database/enums";
import * as Sentry from "@sentry/hono/bun";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";
import { isSupportedChatModel } from "../lib/models";

const createSessionSchema = z.object({
    title: z.string(),
    cwd: z.string().optional(),
    initialMessage: z.object({
        role: z.enum(Role),
        content: z.string(),
        mode: z.enum(Mode),
        // refine() - valid or invalide data
        model: z.string().refine(isSupportedChatModel, "Unsupported model"),
    }).optional(),
});

const CreateSessionValidator = zValidator(
    "json", createSessionSchema, (result, c) => {
    if(!result.success){
        Sentry.logger.warn("Session creation validation failed",{
            path: c.req.path,
            issues: result.error.issues.length,
        });
        // c - context of some HTTP-request
        return c.json({error: "Invalid request body"}, 400);
    }
});

const app = new Hono<AuthenticatedEnv>()
    .get("/", async (c)=>{
        const userId = c.get("userId");
         const sessions = await db.session.findMany({
            where: {userId},
            orderBy: {createdAt: "desc"},
            select:{
                id: true,
                title: true,
                createdAt:true,
            },
        });

        Sentry.logger.info("Listed sessions", {
            count: sessions.length,
        });

        return c.json(sessions);
    })
    // loading individual session
    .get("/:id", async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout (r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(500, 
    //    { message: "Mock error: session loading failed" }
    // )

    // req - deleting not needed part of request
    const id = c.req.param("id");
    const userId = c.get("userId");

    const session = await db.session.findUnique({
        where:{id, userId},
        include: {
            messages:{ orderBy:{ createdAt: "asc"}}
        },
    });

    if(!session){
        Sentry.logger.info("Session not found", {
            sessionId: id,
            userId,
        });
        return c.json({error: "Session not found"}, 404);
    }

    Sentry.logger.info("Loaded session",{
        sessionId: session.id,
    })

    return c.json(session);
})
    .post("/", CreateSessionValidator, requireCreditsBalance, async (c)=> {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout (r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(500, 
    //    { message: "Mock error: session loading failed" }
    // )

    const userId = c.get("userId");

    const {initialMessage, ...data} = c.req.valid("json");
    // session as prefetch
    const session = await db.session.create({
        data:{
            ...data, 
            userId,
            ...(initialMessage && {
                messages:{
                    create:{
                        ...initialMessage,
                        status: MessageStatus.COMPLETE,
                    }
                }
            })
        },
        include:{messages:true},
    });

    Sentry.logger.info("Created session",{
        sessionId: session.id,
    })

    return c.json(session,201);
});

export default app;