import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as CM from "./commit-message.ts";

// A commit message written from a space's changes (the Changes panel's ✨): the prompt, what a CLI's answer is cleaned
// to, the changes read in a real throwaway git repo, and which CLI writes it (machine.exec answered here, nothing run).

const answer = (stdout: string, code = 0): any =>
  ({ code, stdout: Buffer.from(stdout).toString("base64"), stderr: Buffer.from(code ? "boom" : "").toString("base64") });

// machine.exec as herdr-core answers it: the argv says what it is
function hubWith(answers: (argv: string[]) => any) {
  const argv: string[][] = [];
  return {
    argv,
    hub: { terminals: new Map(), async call(method: string, p: any) { if (method !== "machine.exec") throw new Error(method); argv.push(p.argv); return answers(p.argv); } } as any,
  };
}

// machine.exec running here, as this computer's machine does: the folder's git answers for real
const realHub = (): any => ({
  terminals: new Map(),
  async call(method: string, p: any) {
    if (method !== "machine.exec") throw new Error(method);
    const proc = Bun.spawn(p.argv, { stdout: "pipe", stderr: "pipe" });
    const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout: Buffer.from(o).toString("base64"), stderr: Buffer.from(e).toString("base64") };
  },
});

test("the prompt carries the guide's rules, then the changes", () => {
  const a = CM.ask("M src/a.ts\n@@ -1 +1 @@\n-a\n+b");
  expect(a).toContain("Conventional Commits");
  expect(a).toContain("fix(auth)");
  expect(a).toContain("no explanation");
  expect(a.endsWith("-a\n+b")).toBe(true);
  expect(CM.prompt("x", true)).toContain("cut short");
  expect(CM.prompt("x")).not.toContain("Conventional Commits");
});

test("a CLI's answer is just the message: no fence, quotes or greeting", () => {
  expect(CM.clean("```\nfeat(web): add the sparkles\n```\n")).toBe("feat(web): add the sparkles");
  expect(CM.clean('"fix(compose): keep the box"\n')).toBe("fix(compose): keep the box");
  expect(CM.clean("Here is the commit message:\n\nchore: drop a line\n")).toBe("chore: drop a line");
  expect(CM.clean("Commit message: docs: say how it writes one")).toBe("docs: say how it writes one");
  expect(CM.clean("  \n")).toBe("");
});

test("the changes are the folder's, untracked files included, cut when they are long", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-commit-"));
  const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: dir, stdout: "pipe", stderr: "ignore" });
  git("init", "-q");
  const hub = realHub();
  await expect(CM.changes(hub, dir, null)).rejects.toThrow("Nothing to commit yet");
  writeFileSync(join(dir, "a.txt"), "one\n");
  const { text } = await CM.changes(hub, dir, null);
  expect(text).toContain("?? a.txt");
  // a folder that isn't a repo says so
  await expect(CM.changes(hub, join(dir, "nowhere"), null)).rejects.toThrow("isn't a git repository");
});

test("Claude Code writes it when it is there, and its answer is cleaned", async () => {
  const { hub, argv } = hubWith((a) => a[0] === "sh" ? answer("claude\n") : answer("```\nfeat(web): add the sparkles\n```\n"));
  expect(await CM.write(hub, "/repo", null, "M a.ts", false)).toBe("feat(web): add the sparkles");
  expect(argv[1]!.slice(0, 4)).toEqual(["claude", "-p", "--model", "haiku"]);
  expect(argv[1]!.at(-1)).toContain("M a.ts");
});

test("Codex writes it when that is the CLI installed, and no CLI at all says so", async () => {
  const codex = hubWith((a) => a[0] === "sh" ? answer("codex\n") : answer("fix: keep the box\n"));
  expect(await CM.write(codex.hub, "/repo", null, "M a.ts")).toBe("fix: keep the box");
  expect(codex.argv[1]!.slice(0, 3)).toEqual(["codex", "exec", "--sandbox"]);
  const none = hubWith((a) => a[0] === "sh" ? answer("") : answer(""));
  await expect(CM.write(none.hub, "/repo", null, "M a.ts")).rejects.toThrow("needs Claude Code or Codex");
  const bad = hubWith((a) => a[0] === "sh" ? answer("claude\n") : answer("", 1));
  await expect(CM.write(bad.hub, "/repo", null, "M a.ts")).rejects.toThrow("Writing a commit message failed");
});
