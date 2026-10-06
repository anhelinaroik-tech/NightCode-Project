import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { isReadOnlyTool, toolInputSchemas, Mode, type ModeType } from "@nightcode/shared";

const MAX_FILE_SIZE = 10_000;
const MAX_RESULTS = 200;
const MAX_MATCHES = 50;
const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT = 30_000;

export function isInside(root: string, target: string) {
  const rel = relative(root, target);
  // Compare the first segment exactly, so names like "..cache" still count as inside
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

// realpath that also works for paths that don't exist yet (e.g. a file about to be written)
async function realpathAllowMissing(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (err) {
    const parent = dirname(path);
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" || parent === path) throw err;
    // A dangling symlink also gives ENOENT; writing through it would follow it outside the project
    const isDanglingSymlink = await lstat(path).then((info) => info.isSymbolicLink(), () => false);
    if (isDanglingSymlink) throw new Error("Path is a broken symlink");
    return join(await realpathAllowMissing(parent), basename(path));
  }
}

// Resolves a model-supplied path against the project directory and refuses anything outside it,
// either lexically ("../x") or through a symlink inside the project ("link -> /etc").
async function resolveInsideCwd(path: string) {
  const cwd = process.cwd();
  const resolved = resolve(cwd, path);
  const [realCwd, realResolved] = await Promise.all([
    realpath(cwd),
    realpathAllowMissing(resolved),
  ]);

  if (!isInside(cwd, resolved) || !isInside(realCwd, realResolved)) {
    throw new Error("Path is outside the project directory");
  }

  return { cwd, resolved };
}

// Cuts text that is longer than the limit
function truncate(value: string, limit: number) {
  return value.length > limit
    ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
    : value;
}

export async function executeLocalTool(
  toolName: string,
  input: unknown,
  mode: ModeType,
  // Aborted when the user interrupts the reply; stops a running bash command
  signal?: AbortSignal
) {
  if (mode === Mode.PLAN && !isReadOnlyTool(toolName)) {
    throw new Error(`Tool ${toolName} is not available in PLAN mode`);
  }

  switch (toolName) {
    case "readFile": {
      const { path } = toolInputSchemas.readFile.parse(input);
      const { resolved } = await resolveInsideCwd(path);
      const content = await readFile(resolved, "utf-8");
      return content.length > MAX_FILE_SIZE
        ? {
            content: content.slice(0, MAX_FILE_SIZE),
            truncated: true,
            totalLength: content.length,
          }
        : { content };
    }
    case "listDirectory": {
      const { path } = toolInputSchemas.listDirectory.parse(input);
      const { cwd, resolved } = await resolveInsideCwd(path);
      // withFileTypes doesn't follow symlinks, so a broken one can't fail the whole listing
      const entries = await readdir(resolved, { withFileTypes: true });
      const results: { name: string; type: "file" | "directory" | "symlink" }[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        results.push({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
        });
      }

      results.sort((a, b) =>
        a.type !== b.type
          ? a.type === "directory"
            ? -1
            : 1
          : a.name.localeCompare(b.name)
      );
      return { path: relative(cwd, resolved) || ".", entries: results };
    }
    case "glob": {
      const { pattern, path } = toolInputSchemas.glob.parse(input);
      const { cwd, resolved } = await resolveInsideCwd(path);
      const glob = new Bun.Glob(pattern);
      const files: string[] = [];
      let truncated = false;

      for await (const match of glob.scan({
        cwd: resolved,
        dot: false,
        onlyFiles: true,
      })) {
        if (match.includes("node_modules")) continue;
        if (files.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }

        files.push(relative(cwd, resolve(resolved, match)));
      }

      files.sort();
      return { files, ...(truncated ? { truncated: true } : {}) };
    }
    case "grep": {
      const { pattern, path, include } = toolInputSchemas.grep.parse(input);
      const { cwd, resolved } = await resolveInsideCwd(path);
      const args = [
        "-rn",
        "--color=never",
        "--exclude-dir=node_modules",
        "--exclude-dir=.git",
        "-E",
      ];
      if (include) args.push(`--include=${include}`);
      // -e and -- keep a pattern or path that starts with "-" from being read as an option
      args.push("-e", pattern, "--", resolved);

      const proc = Bun.spawn(["grep", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      // grep exits with 0 on matches, 1 on no matches and 2+ on errors
      if (exitCode !== 0 && exitCode !== 1)
        throw new Error(`grep failed: ${stderr.trim()}`);
      if (!stdout.trim()) return { matches: [], message: "No matches found" };

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
          matches.push({
            file: relative(cwd, match[1]!),
            line: Number(match[2]),
            content: match[3]!,
          });
        }
      }

      return {
        matches,
        ...(truncated ? { truncated: true, totalMatches: lines.length } : {}),
      };
    }
    case "writeFile": {
      const { content, path } = toolInputSchemas.writeFile.parse(input);
      const { cwd, resolved } = await resolveInsideCwd(path);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
      return {
        success: true as const,
        path: relative(cwd, resolved),
        bytesWritten: Buffer.byteLength(content, "utf-8"),
      };
    }
    case "editFile": {
      const { path, oldString, newString } = toolInputSchemas.editFile.parse(input);
      const { cwd, resolved } = await resolveInsideCwd(path);
      const content = await readFile(resolved, "utf-8");
      const occurrences = content.split(oldString).length - 1;

      if (occurrences === 0) throw new Error("oldString not found in file");
      if (occurrences > 1) throw new Error(`oldString is ambiguous; found ${occurrences} matches`);

      await writeFile(resolved, content.replace(oldString, () => newString), "utf-8");
      return { success: true as const, path: relative(cwd, resolved) };
    }
    case "bash": {
      const { command, timeout = DEFAULT_TIMEOUT } = toolInputSchemas.bash.parse(input);
      // Own process group, so the timeout can also kill background children (`cmd &`).
      // Otherwise they keep stdout/stderr open and the reads below never finish.
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, TERM: "dumb" },
        detached: true,
      });
      const killGroup = () => {
        try {
          process.kill(-proc.pid, "SIGKILL");
        } catch {
          // group already exited
        }
      };
      const timer = setTimeout(killGroup, timeout);
      signal?.addEventListener("abort", killGroup, { once: true });
      let stdout: string;
      let stderr: string;
      let exitCode: number;
      try {
        [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
      } finally {
        // Also on failure, so a late timer can't kill a reused process group id
        clearTimeout(timer);
        signal?.removeEventListener("abort", killGroup);
      }
      if (signal?.aborted) throw new Error("Interrupted by the user");
      return {
        stdout: truncate(stdout, MAX_OUTPUT),
        stderr: truncate(stderr, MAX_OUTPUT),
        exitCode,
      };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

