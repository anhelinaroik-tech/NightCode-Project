import { realpath } from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";

function isInside(root: string, target: string): boolean {
    const rel = relative(root, target);
    return !(rel.startsWith("..") || isAbsolute(rel));
}

// realpath that also works for paths that don't exist yet (e.g. a file about to be written)
async function realpathAllowMissing(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch (err) {
        const parent = dirname(path);
        if ((err as NodeJS.ErrnoException).code !== "ENOENT" || parent === path) throw err;
        return join(await realpathAllowMissing(parent), basename(path));
    }
}

// Resolves a model-supplied path against the project root. Returns null when it points outside,
// either lexically ("../x") or through a symlink inside the project ("link -> /etc").
export async function resolveProjectPath(cwd: string, path: string): Promise<string | null> {
    const resolved = resolve(cwd, path);
    if (!isInside(cwd, resolved)) return null;

    const [realCwd, realResolved] = await Promise.all([
        realpath(cwd),
        realpathAllowMissing(resolved),
    ]);
    return isInside(realCwd, realResolved) ? resolved : null;
}
