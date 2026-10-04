import {tool} from "ai";
import { z} from "zod";

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;

function truncate(output: string): string {
    if (output.length <= MAX_OUTPUT) return output;
    return `${output.slice(0, MAX_OUTPUT)}\n... (output truncated, ${output.length - MAX_OUTPUT} more characters)`;
}

export function createBashTool(cwd: string){
    return tool({
        description:
        "Execute a shell command in the project directory. Use this for running tests, builds, git operations, package installs, and any other shell commands",
        inputSchema: z.object({
            command: z.string().describe("The shell command to execute"),
            timeout: z
                .number()
                .int()
                .positive()
                .max(MAX_TIMEOUT)
                .describe("Timeout in milliseconds (default: 30000, max: 120000)")
                .default(DEFAULT_TIMEOUT),
        }),
        execute: async ({command, timeout}) => {
            try {
                // Own process group, so the timeout can also kill background children (`cmd &`).
                // Otherwise they keep stdout/stderr open and the reads below never finish.
                const proc = Bun.spawn(["bash", "-c", command], {
                    cwd,
                    stdout: "pipe",
                    stderr: "pipe",
                    env: {...process.env, TERM: "dumb"},
                    detached: true,
                });

                const timer = setTimeout(()=> {
                    try {
                        process.kill(-proc.pid, "SIGKILL");
                    } catch {
                        // group already exited
                    }
                },timeout);

                const [stdout, stderr, exitCode] = await Promise.all([
                    new Response(proc.stdout).text(),
                    new Response(proc.stderr).text(),
                    proc.exited,
                ]);
                clearTimeout(timer);

                return {
                    stdout: truncate(stdout),
                    stderr: truncate(stderr),
                    exitCode
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to execute command: ${message}`};
            }
        },
    });
}
