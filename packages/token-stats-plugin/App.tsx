import { host } from "nsh";

const params = (host as any).params.plugin;
const sequences: Record<string, number> = {};
const openState: Record<string, boolean> = {};
const modes: Record<string, string> = { activity: "detailed", usage: "detailed", context: "detailed" };
const MUTED = "#a1a1aa";
let nodeRegistry: Record<string, any> = {};
let sessionId = "";
let locale = params.locale ?? "en";
let snapshot: any = null;
let refreshing = false;
let request = 0;

function send(kind: string, stream: string, body: unknown, requestId?: string): void {
  sequences[stream] = (sequences[stream] ?? 0) + 1;
  host.post("plugin.protocol", {
    protocol: 1,
    kind,
    instance: params.instance,
    epoch: params.epoch,
    stream,
    sequence: sequences[stream],
    requestId: requestId ?? null,
    generation: params.generation,
    body,
  });
}

function current(message: any): boolean {
  return message?.protocol === 1 &&
    message.instance === params.instance &&
    message.epoch === params.epoch &&
    message.generation === params.generation;
}

function node(id: string, kind: string, extra: Record<string, unknown> = {}): any {
  const value = {
    id,
    kind,
    text: null,
    exportName: null,
    testId: null,
    press: false,
    children: [],
    style: {},
    events: [],
    props: {},
    accessibility: {},
    source: null,
    ...extra,
  };
  nodeRegistry[id] = value;
  return value;
}

function text(id: string, value: string, style: Record<string, unknown> = {}, testId?: string): any {
  return node(id, "text", {
    text: value,
    testId,
    style: { fontSize: 12, color: MUTED, ...style },
  });
}

function view(id: string, children: string[], extra: Record<string, unknown> = {}): any {
  return node(id, "view", { children, ...extra });
}

function line(prefix: string, label: string, value: string): any {
  return view(`${prefix}-line`, [
    text(`${prefix}-label`, label, { flex: 1 }).id,
    text(`${prefix}-value`, value, { fontFamily: "monospace" }).id,
  ], { style: { flexDirection: "row", gap: 12 } });
}

function detailTitle(prefix: string, title: string): any {
  return text(`${prefix}-title`, title, { fontSize: 14, fontWeight: "600" });
}

function emptyExport(name: string): any {
  return view(name, [], { exportName: name, style: { width: 0, height: 0 } });
}

function summaryView(name: string, summary: string): any {
  return view(name, [text(`${name}-summary`, summary, {}, `stats-summary-${name}`).id], {
    exportName: name,
    style: { flexDirection: "row", gap: 4 },
  });
}

function popover(name: string, summary: string, details: any[], align = "start"): any {
  const trigger = view(`${name}-trigger`, [
    text(`${name}-summary`, summary, {}, `stats-summary-${name}`).id,
  ], {
    accessibility: { role: "button" },
    style: { flexDirection: "row", gap: 4, paddingHorizontal: 4 },
  });
  const content = view(`${name}-content`, details.map((item) => item.id), { style: { gap: 8 } });
  return node(name, "popover", {
    exportName: name,
    testId: `stats-popover-${name}`,
    events: ["openChange"],
    props: { open: openState[name] === true, placement: "top", align },
    children: [trigger.id, content.id],
  });
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(value));
}

function compactDuration(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function duration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function speed(stats: any): number | null {
  const decodeMs = stats.api_ms - stats.ttft_ms;
  return stats.ttft_ms > 0 && decodeMs > 0 && stats.output > 0 ? stats.output / (decodeMs / 1000) : null;
}

function cacheHit(input: number, cacheRead: number): number | null {
  return input + cacheRead > 0 ? cacheRead / (input + cacheRead) * 100 : null;
}

function zh(): boolean {
  return locale.toLowerCase().startsWith("zh");
}

function turnStats(turn: any): any[] {
  const index = turn.index;
  const stats = turn.stats;
  if (!stats) return [emptyExport(`TurnStats:${index}`)];
  const rate = speed(stats);
  const speedSummary = rate ? `${rate.toFixed(1)} tok/s` : compactDuration(turn.durationMs);
  const tokenSummary = `${formatTokens(stats.input + stats.cache_read + stats.output)} tok`;
  const speedDetails = [
    detailTitle(`turn-${index}-speed`, zh() ? "解码速度" : "Decode speed"),
    line(`turn-${index}-speed-duration`, zh() ? "耗时" : "Duration", duration(turn.durationMs)),
    line(`turn-${index}-speed-steps`, zh() ? "API 步数" : "API steps", String(stats.api_steps)),
    line(`turn-${index}-speed-model`, zh() ? "模型耗时" : "Model time", compactDuration(stats.api_ms)),
    line(`turn-${index}-speed-first`, zh() ? "首个 token" : "First token", stats.ttft_steps ? compactDuration(stats.ttft_ms / stats.ttft_steps) : "—"),
    line(`turn-${index}-speed-tool`, zh() ? "工具耗时" : "Tool time", compactDuration(stats.tool_ms)),
    line(`turn-${index}-speed-rate`, zh() ? "解码速度" : "Decode speed", rate ? `${rate.toFixed(1)} tok/s` : "—"),
  ];
  const hit = cacheHit(stats.input, stats.cache_read);
  const usageDetails = [
    detailTitle(`turn-${index}-usage`, zh() ? "Token 用量" : "Token usage"),
    line(`turn-${index}-usage-input`, zh() ? "输入" : "Input", stats.input.toLocaleString()),
    line(`turn-${index}-usage-cache`, zh() ? "缓存读取" : "Cache read", stats.cache_read.toLocaleString()),
    line(`turn-${index}-usage-output`, zh() ? "输出" : "Output", stats.output.toLocaleString()),
    line(`turn-${index}-usage-hit`, zh() ? "缓存命中" : "Cache hit", hit == null ? "—" : `${hit.toFixed(1)}%`),
  ];
  return [
    popover(`TurnStats:${index}:speed`, `↶ ${speedSummary}`, speedDetails),
    popover(`TurnStats:${index}:usage`, `▤ ${tokenSummary}`, usageDetails),
  ];
}

function turnExport(turn: any): any {
  return view(`TurnStats:${turn.index}`, turnStats(turn).map((item) => item.id), {
    exportName: `TurnStats:${turn.index}`,
    style: { flexDirection: "row", gap: 8 },
  });
}

function sessionActivity(stats: any): any {
  if (modes.activity === "hidden") return emptyExport("SessionActivity");
  const rate = stats.decodeMs > 0 ? stats.output / (stats.decodeMs / 1000) : null;
  const turnsSteps = zh() ? `${stats.turns} 回合 · ${stats.steps} 步` : `${stats.turns} turns · ${stats.steps} steps`;
  const summary = `↶ ${turnsSteps}${rate ? ` · ${Math.round(rate)} tok/s` : ""}`;
  if (modes.activity === "compact") return summaryView("SessionActivity", summary);
  const details = [
    detailTitle("session-activity", zh() ? "会话活动" : "Session activity"),
    line("session-activity-turns", zh() ? "完成回合" : "Completed turns", String(stats.turns)),
    line("session-activity-steps", zh() ? "API 步数" : "API steps", String(stats.steps)),
    line("session-activity-model", zh() ? "模型耗时" : "Model time", compactDuration(stats.apiMs)),
    line("session-activity-tool", zh() ? "工具耗时" : "Tool time", compactDuration(stats.toolMs)),
    line("session-activity-first", zh() ? "平均首个 token" : "Average first token", stats.ttftSteps ? compactDuration(stats.ttftMs / stats.ttftSteps) : "—"),
    line("session-activity-rate", zh() ? "解码速度" : "Decode speed", rate ? `${rate.toFixed(1)} tok/s` : "—"),
  ];
  const children: string[] = [];
  if (stats.running) {
    children.push(text("session-running", zh() ? "正在生成" : "Generating", { color: "#30a46c" }).id);
    if (stats.outputRate > 0) children.push(text("session-running-rate", `≈ ${stats.outputRate} token/s`).id);
  }
  if (stats.turns > 0) children.push(popover("SessionActivity", summary, details, "center").id);
  return view("SessionActivityRoot", children, {
    exportName: "SessionActivity",
    style: { flexDirection: "row", gap: 8, alignItems: "center" },
  });
}

function sessionUsage(stats: any): any {
  const usage = stats.usage;
  if (!usage || modes.usage === "hidden") return emptyExport("SessionUsage");
  const totalInput = usage.inputTotal + usage.cacheReadTotal + stats.output;
  const hit = cacheHit(usage.inputTotal, usage.cacheReadTotal);
  const cache = hit == null ? "" : ` · ${zh() ? "缓存" : "cache"} ${hit.toFixed(1)}%`;
  const summary = `▤ ${formatTokens(totalInput)} tokens${cache}`;
  if (modes.usage === "compact") return summaryView("SessionUsage", summary);
  return popover("SessionUsage", summary, [
    detailTitle("session-usage", zh() ? "Token 用量" : "Token usage"),
    line("session-usage-input", zh() ? "输入" : "Input", usage.inputTotal.toLocaleString()),
    line("session-usage-cache", zh() ? "缓存读取" : "Cache read", usage.cacheReadTotal.toLocaleString()),
    line("session-usage-output", zh() ? "输出" : "Output", stats.output.toLocaleString()),
    line("session-usage-hit", zh() ? "缓存命中" : "Cache hit", hit == null ? "—" : `${hit.toFixed(1)}%`),
  ], "center");
}

function sessionContext(stats: any): any {
  const usage = stats.usage;
  if (!usage || modes.context === "hidden") return emptyExport("SessionContext");
  const ratio = Math.min(1, usage.used / Math.max(1, usage.total));
  const percent = Math.round(ratio * 100);
  const summary = `◯ ${percent}%`;
  if (modes.context === "compact") return summaryView("SessionContext", summary);
  const filled = Math.round(ratio * 10);
  const progress = `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}`;
  const details = [
    detailTitle("session-context", zh() ? "上下文已用" : "Context used") ,
    line("session-context-total", zh() ? "总量" : "Total", `~${formatTokens(usage.used)} / ${formatTokens(usage.total)}`),
    text("session-context-progress", progress),
  ];
  const breakdown = stats.breakdown;
  if (breakdown) {
    details.push(
      line("session-context-system", zh() ? "系统提示" : "System prompt", `~${formatTokens(breakdown.system)}`),
      line("session-context-tools", zh() ? "工具定义" : "Tool schemas", `~${formatTokens(breakdown.tools)}`),
      line("session-context-messages", zh() ? "消息" : "Messages", `~${formatTokens(breakdown.messages)}`),
    );
  }
  return popover("SessionContext", summary, details, "center");
}

function buildNodes(): any[] {
  nodeRegistry = {};
  if (!snapshot?.session) return [];
  const stats = snapshot.session.stats;
  sessionActivity(stats);
  sessionUsage(stats);
  sessionContext(stats);
  for (const turn of snapshot.session.turns) turnExport(turn);
  return Object.values(nodeRegistry);
}

function commit(): void {
  const nodes = buildNodes();
  const parents = new Set(nodes.flatMap((item) => item.children));
  const roots = nodes.filter((item) => !parents.has(item.id)).map((item) => item.id).sort();
  send("ui.commit", "ui", {
    instance: params.instance,
    epoch: params.epoch,
    generation: params.generation,
    sequence: 1,
    baseRevision: 0,
    nodes,
    roots,
    warnings: [],
  });
}

function refresh(): void {
  if (!sessionId || refreshing) return;
  refreshing = true;
  request += 1;
  send("service.request", "services", {
    service: "session_read",
    sessionId,
    payload: {},
  }, `stats-${request}`);
}

host.on("plugin.protocol", (message: any) => {
  if (!current(message)) return;
  if (message.kind === "lifecycle.start") {
    send("lifecycle.ready", "lifecycle", { accepted: true });
    commit();
    refresh();
  } else if (message.kind === "lifecycle.health") {
    send("lifecycle.health", "lifecycle", { token: message.body.token });
  } else if (message.kind === "ui.event") {
    const body = message.body;
    if (body.kind === "context") {
      const nextSession = String(body.payload?.sessionId ?? "");
      const contribution = String(body.contribution ?? "");
      const mode = contribution === "stats-activity" ? "activity"
        : contribution === "stats-usage" ? "usage"
        : contribution === "stats-context" ? "context"
        : null;
      const nextMode = mode ? String(body.payload?.mode ?? "detailed") : null;
      const modeChanged = mode && nextMode && modes[mode] !== nextMode;
      if (mode && nextMode) modes[mode] = nextMode;
      if (nextSession !== sessionId) {
        sessionId = nextSession;
        snapshot = null;
        commit();
        refresh();
      } else if (modeChanged) {
        commit();
      }
    } else if (body.kind === "openChange") {
      openState[body.node] = body.payload?.open === true;
      commit();
    }
  } else if (message.kind === "service.response" && String(message.requestId ?? "").startsWith("stats-")) {
    refreshing = false;
    const result = message.body.result;
    const value = result?.Ok ?? result;
    if (value?.session?.id === sessionId) {
      snapshot = value;
      commit();
    }
  } else if (message.kind === "service.event" && message.body.name === "locale.changed") {
    locale = message.body.locale;
    commit();
  }
});

send("lifecycle.hello", "lifecycle", {
  uiProtocol: 1,
  servicesProtocol: 1,
  requiredFeatures: (2 ** 0) + (2 ** 10) + (2 ** 15),
  optionalFeatures: (2 ** 6),
});

setInterval(refresh, 500);
