import dotenv from "dotenv";
import path from "path";
import {PrismaPg} from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

// Load the root .env so it works no matter which package directory the process starts in
dotenv.config({
    path: path.resolve(import.meta.dirname, "../../../.env"),
    quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;

if(!databaseUrl){
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env in the repo root and fill it in.")
}

const adapter = new PrismaPg({connectionString: databaseUrl});

export const db = new PrismaClient({adapter});

// Host and database name only, so the password never ends up in logs
function describeDatabase(){
    try{
        const url = new URL(databaseUrl!);
        return `${url.hostname}${url.pathname}`;
    } catch{
        return "the configured database";
    }
}

export async function checkDatabaseConnection(){
    try{
        await db.$queryRaw`SELECT 1`;
    } catch(error){
        // Prisma wraps driver failures as a generic P2010; the real cause (e.g. a bad password) is in meta.driverAdapterError
        const driverCause = (error as {meta?: {driverAdapterError?: {cause?: {originalCode?: unknown; originalMessage?: unknown}}}})
            ?.meta?.driverAdapterError?.cause;
        // Connection errors carry the cause in `code` (e.g. ECONNREFUSED) and an empty-ish message
        const code = (error as {code?: unknown})?.code;
        const message = error instanceof Error ? error.message.trim() : String(error);
        const reason = typeof driverCause?.originalMessage === "string"
            ? `${driverCause.originalMessage} (${String(driverCause.originalCode)})`
            : typeof code === "string" ? code : message;
        throw new Error(`Cannot connect to ${describeDatabase()}: ${reason}`);
    }
}
