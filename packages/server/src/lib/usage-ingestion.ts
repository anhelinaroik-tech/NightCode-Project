import * as Sentry from "@sentry/hono/bun";
import { db } from "@nightcode/database/client";
import { ingestAiUsage } from "./polar";

// In-process retries cover short Polar hiccups; anything longer is left to the periodic flush.
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const FLUSH_INTERVAL_MS = 5 * 60_000;
const FLUSH_BATCH_SIZE = 50;
// Rows younger than this may still be in their in-process retries
const FLUSH_MIN_AGE_MS = 2 * 60_000;

type UsageEvent = {
    // Stable per charge (Polar external_id), so redelivery can't bill twice
    eventId: string;
    userId: string;
    credits: number;
};

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

async function deliver({ eventId, userId, credits }: UsageEvent) {
    await ingestAiUsage({ externalCustomerId: userId, eventId, credits });
    await db.pendingUsageEvent.deleteMany({ where: { id: eventId } });
}

async function markFailed(eventId: string, error: unknown) {
    await db.pendingUsageEvent.updateMany({
        where: { id: eventId },
        data: { attempts: { increment: 1 }, lastError: errorMessage(error) },
    });
}

// Stores the charge before sending it, so a Polar outage or a server restart can't lose it.
// Throws only if the charge could not even be stored.
export async function recordUsage(event: UsageEvent) {
    if (event.credits <= 0) return;

    await db.pendingUsageEvent.upsert({
        where: { id: event.eventId },
        create: { id: event.eventId, userId: event.userId, credits: event.credits },
        update: {},
    });

    for (let attempt = 0; ; attempt++) {
        try {
            await deliver(event);
            return;
        } catch (error) {
            const delay = RETRY_DELAYS_MS[attempt];
            if (delay === undefined) {
                // Stays in the table for flushPendingUsage
                Sentry.captureException(error);
                await markFailed(event.eventId, error);
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

export async function flushPendingUsage() {
    const pending = await db.pendingUsageEvent.findMany({
        where: { createdAt: { lt: new Date(Date.now() - FLUSH_MIN_AGE_MS) } },
        orderBy: { createdAt: "asc" },
        take: FLUSH_BATCH_SIZE,
    });

    for (const row of pending) {
        try {
            await deliver({ eventId: row.id, userId: row.userId, credits: row.credits });
        } catch (error) {
            Sentry.captureException(error);
            await markFailed(row.id, error);
        }
    }
}

let flushTimer: ReturnType<typeof setInterval> | undefined;

// Delivers charges left over from failed attempts or a previous run of the server
export function startPendingUsageFlush() {
    if (flushTimer) return;

    const run = () => {
        flushPendingUsage().catch((error) => Sentry.captureException(error));
    };
    run();
    flushTimer = setInterval(run, FLUSH_INTERVAL_MS);
}
