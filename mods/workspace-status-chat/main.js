// The status bar: the shown space's machine (as the sidebar names it) and branch, the red Needs-you
// badge (the Tasks panel's count, inbox.js) when something needs the person, the agents that
// finished while unseen and those working, and the palette key. Each count is a button: Needs you
// goes to the first agent waiting (else the Tasks panel), Done and Working to their first agent.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, window, keys, shared, nextCommand } from "herdr";
import { spaces, agents, inRender } from "./live.js";
import { items as needsYou, toAgent, showInbox } from "./inbox.js";
import { countBadge, TEXT, RADIUS } from "./ui.js";

// A machine as the sidebar shows it (mods/spaces-chat sections.js machineLook): the name it was
// given there, else its own.
const machineName = (m) => (shared("spaces-chat")?.machines?.[m ?? ""]?.name) || (m ?? "This computer");

// To the first agent that needs the person, else the first one done, else the Tasks panel.
function goToWaiting() {
  const first = needsYou().find((it) => it.terminal);
  if (first) return toAgent(first.terminal);
  const done = agents().find((a) => a.status === "done");
  if (done) return toAgent(done.address);
  showInbox();
}

export default class WorkspaceStatus extends View {
  // "workspace-status-chat.next-waiting" (cmd-shift-j): to the agent that waits on the person (the first
  // Needs you), else the first one done, else the Tasks panel. At most 5 s per wait, so a reload's old
  // build ends at its next cx use.
  init(_props, cx) {
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        if (c === "next-waiting") inRender(() => goToWaiting());
      }
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("Commands") instead of lying.
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  Commands` : "Commands";
  }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const needs = needsYou();
    const first = needs.find((it) => it.terminal);
    const all = agents();
    const done = all.filter((a) => a.status === "done");
    const working = all.filter((a) => a.status === "working");
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(14)).child(text);
    // A count as a button: a dot in its status color, the number and what it counts.
    const button = (id, color, n, text, go) => h_flex().id(id).gap(6).px(6).h(20).items_center().rounded(RADIUS.control).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(go)
      .child(div().size(8).rounded(4).bg(color)).child(`${n} ${text}`);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(TEXT.label).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", machineName(space?.machine ?? null)))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .when(needs.length > 0, el => el.child(h_flex().id("needs").gap(6).px(6).h(20).items_center().rounded(RADIUS.control).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => (first ? toAgent(first.terminal) : showInbox()))
        .child(countBadge(needs.length, 0, t.chrome)).child("Needs you")))
      .when(done.length > 0, el => el.child(button("done", t.done, done.length, "done", () => toAgent(done[0].address))))
      .when(working.length > 0, el => el.child(button("working", t.working, working.length, "working", () => toAgent(working[0].address))))
      .child(div().flex_1())
      .child(div().id("palette").px(6).h(20).flex().items_center().rounded(RADIUS.control).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("app.palette")).child(this.hint()));
  }
}
