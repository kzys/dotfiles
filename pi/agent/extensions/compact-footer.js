function formatCwdForFooter(cwd, home) {
  if (!home) return cwd;
  const homeResolved = home.replace(/\/$/, "");
  const cwdResolved = cwd.replace(/\/$/, "");
  if (cwdResolved === homeResolved) return "~";
  if (cwdResolved.startsWith(`${homeResolved}/`)) {
    return `~${cwdResolved.slice(homeResolved.length)}`;
  }
  return cwdResolved;
}

function truncateToWidth(text, width) {
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function setCompactFooter(ctx) {
  ctx.ui.setFooter((_tui, _theme, footerData) => ({
    render(width) {
      const parts = [];
      const cwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
      parts.push(cwd);

      const branch = footerData.getGitBranch();
      if (branch) {
        parts.push(branch);
      }

      const sessionName = ctx.sessionManager.getSessionName();
      if (sessionName) {
        parts.push(sessionName);
      }

      const model = ctx.model?.id || "no-model";
      const left = parts.join(" · ");
      const right = model;
      const gap = Math.max(1, width - left.length - right.length);
      const line = `${left}${" ".repeat(gap)}${right}`;

      return [truncateToWidth(line, width)];
    },
    invalidate() {},
    dispose() {},
  }));
}

export default function (pi) {
  pi.on("session_start", (_event, ctx) => {
    setCompactFooter(ctx);
  });

  pi.registerCommand("compact-footer", {
    description: "Use a compact footer without token usage stats or cost",
    handler: async (_args, ctx) => {
      setCompactFooter(ctx);
      ctx.ui.notify("Compact footer enabled", "info");
    },
  });

  pi.registerCommand("default-footer", {
    description: "Restore the default footer",
    handler: async (_args, ctx) => {
      ctx.ui.setFooter(undefined);
      ctx.ui.notify("Default footer restored", "info");
    },
  });
}
