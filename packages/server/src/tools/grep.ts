import { tool } from "ai";
import { z } from "zod";
import { relative } from "path";
import { resolveProjectPath } from "./project-path";

const MAX_MATCHES = 50;
const MAX_LINE_LENGTH = 500;

export function createGrepTool(cwd: string) {
    return tool({
        description:
            "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers. Skips hidden directories, node_modules, and binary files.",
        inputSchema: z.object({
            pattern: z.string().describe("Regex pattern to search for"),
            path: z
                .string()
                .describe("Relative directory to search in (defaults to project root)")
                .default("."),
            include: z
                .string()
                .describe("Glob pattern to filter files (e.g. '*.ts', '*.tsx')")
                .optional(),
        }),
        execute: async ({ pattern, path, include }) => {
            const resolved = await resolveProjectPath(cwd, path);
            if (!resolved) {
                return { error: "Path is outside the project directory" };
            }

            try {
                const args = [
                    "-rn",
                    "-I", // skip binary files
                    "--color=never",
                    "--exclude-dir=node_modules",
                    "--exclude-dir=.*", // skip hidden directories (.git, .next, ...)
                    "-E",
                ];

                if (include) {
                    args.push(`--include=${include}`);
                }

                // -e keeps patterns that start with "-" from being parsed as flags
                args.push("-e", pattern, resolved);

                const proc = Bun.spawn(["grep", ...args], {
                    stdout: "pipe",
                    stderr: "pipe",
                    cwd,
                });

                const [stdout, stderr, exitCode] = await Promise.all([
                    new Response(proc.stdout).text(),
                    new Response(proc.stderr).text(),
                    proc.exited,
                ]);

                // grep exits with 0 on matches, 1 on no matches, 2 on errors (e.g. invalid regex)
                if (exitCode > 1) {
                    return { error: `grep failed: ${stderr.trim() || `exit code ${exitCode}`}` };
                }

                if (!stdout.trim()) {
                    return { matches: [], message: "No matches found" };
                }

                const lines = stdout.trim().split("\n");
                const matches: { file: string; line: number; content: string }[] = [];
                let truncated = false;

                for (const line of lines) {
                    if (matches.length >= MAX_MATCHES) {
                        truncated = true;
                        break;
                    }

                    const match = line.match(/^(.+?):(\d+):(.*)$/);
                    if (match) {
                        const content = match[3]!;
                        matches.push({
                            file: relative(cwd, match[1]!),
                            line: parseInt(match[2]!, 10),
                            content:
                                content.length > MAX_LINE_LENGTH
                                    ? `${content.slice(0, MAX_LINE_LENGTH)}...`
                                    : content,
                        });
                    }
                }

                return {
                    matches,
                    ...(truncated ? { truncated: true, totalMatches: lines.length } : {}),
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { error: `Failed to execute command: ${message}` };
            }
        },
    });
}
