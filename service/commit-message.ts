// A commit message written by an agent CLI from a space's changes: the Changes panel's sparkles asks the space's
// machine for it (service/actions.ts' space-commit-message). The prompt carries the Conventional Commits guide
// (https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13), the reply is cleaned of what a CLI adds around
// it, and Claude Code writes it in its print mode (codex exec when that is the one installed there). Nothing is
// committed here: the message goes back to the box for the person to read, change or commit.
import type { Hub } from "./hub.ts";
import { exec, sh } from "./model.ts";

/** The guide's rules, as short as a one-shot prompt can hold them; then only the message back. */
export const RULES = `You write one git commit message in the Conventional Commits style, and nothing else. Answer with the
message only: no introduction, no explanation of your choice, no notes after it, no code fence, no quotes, no
bulleted summary, no questions, no options to pick from.

    <type>[optional scope][!]: <description>

    [optional body]

    [optional footer(s)]

- type: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert, or another the project uses, for what
  the change is, not for what file it touched
- scope, optional: the part it changes, lowercase, in parentheses, never a file's extension: fix(auth): say why the
  login fails
- !: after the type or scope when the change breaks compatibility; then a footer "BREAKING CHANGE: what breaks"
- description: imperative mood, lowercase, no full stop, at most 72 characters
- body, optional: a blank line after the description, then why the change is made (never that something is unclear),
  wrapped at 72 characters
- footer, optional: references and such, after a blank line: "Refs: SHEP-12"
- if the changes are mostly untracked files or too many files to describe, write one short subject line such as
  "feat: add initial project files" or "chore: add generated files"; do not list or analyze the files`;


/** What the panel sends as the prompt's last part: the space's changes; one too big says it is cut short. */
export function prompt(changes: string, limited = false): string {
  return `The changes${limited ? " (the diff is cut short: enough to say what the change is)" : ""}:\n\n${changes.trim()}`;
}

/** The whole ask for a CLI with no system prompt of its own (codex): the rules, then the changes. Claude Code gets the
 *  rules as its system prompt, so they weigh more than the diff does. */
export function ask(changes: string, limited = false): string {
  return `${RULES}\n\n${prompt(changes, limited)}`;
}

/** What a CLI answered, as the box gets it: the message alone, no fence, quotes or "Commit message:" line. */
export function clean(text: string): string {
  let out = String(text ?? "").replace(/\r\n/g, "\n").trim();
  // a fence around it, as some CLIs add
  const fence = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(out);
  if (fence) out = fence[1].trim();
  // "Here is the commit message:" / "Suggested commit message:" before it, on its own line or at the start
  out = out.replace(/^(?:here(?:'s| is)|sure[,:]?|suggested|commit message)\b[^\n:]{0,40}:\s*\n*/i, "").trim();
  // quotes around the whole of it
  if (/^(["'`])/.test(out) && out.at(-1) === out[0] && !out.slice(1, -1).includes(out[0]!)) out = out.slice(1, -1).trim();
  return out.slice(0, 10_000);
}

/** The space's folder's uncommitted changes against HEAD: the changed files' letters first (untracked ones too),
 *  then the diff. `limited`: it was cut at `MAX_DIFF` characters. */
const CHANGES = 'cd "$1" 2>/dev/null && cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 1\n' +
  'git --no-pager status --porcelain=v1 --untracked-files=all; echo "@@@"\n' +
  'if git rev-parse --verify --quiet HEAD >/dev/null; then\n' +
  '  git --no-pager diff HEAD --stat --no-color; echo "@@@"; git --no-pager diff HEAD --no-color\n' +
  'else\n' +
  '  echo "(no commits yet)"; echo "@@@"; git --no-pager diff --no-color\n' +
  'fi\ntrue';
const MAX_DIFF = 16_000;

const MAX_FILES = 40;
function summarizeFiles(files: string): string {
  const lines = files.split("\n").filter(Boolean);
  if (lines.length <= MAX_FILES) return files;
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const status = line.slice(0, 2).trim().replace(/\?\?/, "A").replace(/\S/g, (c) => c) || "?";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const summary = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ");
  const sample = lines.slice(0, 30).join("\n");
  return `${lines.length} files changed (${summary})\n--- first ${Math.min(30, lines.length)} ---\n${sample}\n... and ${lines.length - 30} more`;
}

export async function changes(hub: Hub, folder: string, machine: string | null): Promise<{ text: string; limited: boolean }> {
  const r = await sh(hub, CHANGES, ["changes", folder], machine);
  if (r.code !== 0) throw new Error("That folder isn't a git repository.");
  // the script's three parts: the files' letters, the stat line, the diff
  const [files = "", stat = "", diff = ""] = r.stdout.split("@@@");
  if (!files.trim() && !diff.trim()) throw new Error("Nothing to commit yet.");
  const summarized = summarizeFiles(files.trim());
  let text = [summarized, stat.trim(), diff.trim()].filter(Boolean).join("\n");
  const limited = text.length > MAX_DIFF;
  if (limited) text = text.slice(0, MAX_DIFF);
  return { text, limited };
}

/** Which agent CLI writes it there: Claude Code in its print mode, else Codex's exec. Nothing (none installed). */
async function agentThere(hub: Hub, machine: string | null): Promise<"claude" | "codex" | null> {
  const r = await sh(hub, 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done', ["agents", "claude", "codex"], machine)
    .catch(() => null);
  const have = new Set(String(r?.stdout ?? "").split("\n").filter(Boolean));
  return have.has("claude") ? "claude" : have.has("codex") ? "codex" : null;
}

/** The message for those changes, in the space's folder (so an agent that looks at the files sees them). */
export async function write(hub: Hub, folder: string, machine: string | null, changes: string, limited = false): Promise<string> {
  const agent = await agentThere(hub, machine);
  if (!agent) throw new Error("Writing a commit message needs Claude Code or Codex on that machine.");
  // big or messy changes need the stronger model; small ones can use haiku for speed
  const big = changes.length > 4000 || changes.split("\n").length > 200;
  const r = agent === "claude"
    // -p: print mode, one answer, no tools asked of the person; --append-system-prompt: the rules, which weigh more
    // than the diff; omit --model for big changes to use the default (stronger) model, else haiku for speed
    ? await exec(hub, ["claude", "-p", ...(big ? [] : ["--model", "haiku"]), "--append-system-prompt", RULES, prompt(changes, limited)], machine, 180)
    // codex exec: its one-shot, read-only sandbox (it has nothing to change here); the message is its last words
    : await exec(hub, ["codex", "exec", "--sandbox", "read-only", ask(changes, limited)], machine, 180);
  if (r.code !== 0) throw new Error(`Writing a commit message failed: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
  const message = clean(r.stdout);
  if (!message) throw new Error("It answered nothing to put in the box.");
  return message;
}
