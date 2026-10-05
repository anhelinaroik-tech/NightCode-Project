import { createMiddleware } from "hono/factory";
import * as Sentry from "@sentry/hono/bun";
import type { AuthenticatedEnv } from "./require-auth";
import {getAvailableCreditsBalance} from "../lib/polar";

export const requireCreditsBalance = createMiddleware<AuthenticatedEnv>(async (c, next) => {
    const userId = c.get("userId");
    let creditsBalance: number;
    try {
        creditsBalance = await getAvailableCreditsBalance(userId);
    } catch (error) {
        Sentry.captureException(error);
        return c.json({error: "Unable to verify credits balance right now"}, 503);
    }

    // This is a simple launch-time gate: only start new work when the customer
    // still has credits left. It does not reserve the full eventual cost of the
    // request, so low-volume apps may tolerate small overspend on edge
    if(creditsBalance <= 0) return c.json({error: "No credits remaining. Run /upgrade to buy more credits"}, 402);

    await next();
})
