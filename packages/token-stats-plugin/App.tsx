import { effect, host, locale, mount, setColorScheme, signal, Text, View, type JSX } from "nsh";
import { Button } from "nsh/base";

const params = (host as any).params.plugin;

function responseValue(response: any): any {
  if (response?.result?.Err) throw new Error(response.result.Err.message);
  if (response?.result && "Ok" in response.result) return response.result.Ok;
  throw new Error("Invalid Host API response");
}

function call(method: string, payload: unknown, requestId: string): Promise<any> {
  return (host as any).call("pig.host", {
    apiVersion: 1,
    instance: params.instance,
    surface: params.surface,
    contribution: params.contribution,
    revision: params.revision,
    requestId,
    method,
    payload,
  });
}

function StatsSurface(props: { render: (session: any) => JSX.Element }): JSX.Element {
  const appearance = signal(params.appearance ?? "system");
  const snapshot = signal<any>(null);
  const failure = signal("");
  let subscription = "";
  let snapshotRevision = 0;
  let disposed = false;
  host.on("pig.host.environment", (message: any) => appearance.set(message.appearance));
  host.on("pig.host", (message: any) => {
    if (message?.surface !== params.surface || message.subscriptionId !== subscription) return;
    if (message.kind === "session.snapshot" && message.revision > snapshotRevision) {
      snapshotRevision = message.revision;
      snapshot.set(message.session);
    } else if (message.kind === "session.error") {
      failure.set(message.error?.message ?? "Session subscription failed");
    } else if (message.kind === "surface.disposed") {
      failure.set("Surface disposed");
    }
  });
  effect(() => setColorScheme(appearance()));
  effect(() => {
    disposed = false;
    const start = async () => {
      try {
        const response = await call("session.subscribe", {}, "stats-session-subscribe");
        const initial = responseValue(response);
        if (disposed) {
          await call("session.unsubscribe", { subscriptionId: initial.subscriptionId }, "stats-session-unsubscribe");
          return;
        }
        subscription = initial.subscriptionId;
        snapshotRevision = initial.revision;
        snapshot.set(initial.session);
      } catch (error) {
        if (!disposed) failure.set(String(error));
      }
    };
    void start();
    return () => {
      disposed = true;
      if (subscription) {
        void call("session.unsubscribe", { subscriptionId: subscription }, "stats-session-unsubscribe").catch(() => {});
      }
    };
  });
  return (
    <View class="text-foreground">
      {failure() ? <Text role="alert" class="text-xs text-destructive">{failure()}</Text> : props.render(snapshot())}
    </View>
  );
}

function zh(): boolean {
  return locale().toLowerCase().startsWith("zh");
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

function currentTurn(session: any): any {
  const index = params.context?.turnIndex;
  return session?.turns?.find((turn: any) => turn.index === index) ?? null;
}

function openDetail(contribution: string): void {
  const anchor = params.contribution === "stats-turn" ? "message.turnStats" : params.contribution.replace("stats-", "status.");
  void call("navigation.open", {
    pageId: "overlay",
    contribution,
    anchor,
    turnId: params.context?.turnId ?? null,
    turnIndex: params.context?.turnIndex ?? null,
  }, `stats-overlay-${contribution}`).catch((error: unknown) => console.error(error));
}

function SummaryPill(props: { id: string; icon: string; text: string; detail: string; mode?: string }): JSX.Element {
  if (props.mode === "compact") {
    return <Text testID={props.id} class="px-1 text-xs text-muted-foreground">{`${props.icon} ${props.text}`}</Text>;
  }
  return (
    <Button
      testID={props.id}
      class="h-6 gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-accent"
      onPress={() => openDetail(props.detail)}
    >
      <Text>{props.icon}</Text>
      <Text>{props.text}</Text>
    </Button>
  );
}

function ActivitySummary({ session }: { session: any }): JSX.Element {
  const stats = session?.stats;
  if (!stats) return <View />;
  const rate = stats.decodeMs > 0 ? stats.output / (stats.decodeMs / 1000) : null;
  if (params.context?.displayMode === "compact") {
    return rate ? <SummaryPill id="stats-summary-SessionActivity" icon="↶" text={`${Math.round(rate)} tok/s`} detail="stats-activity-detail" mode="compact" /> : <View />;
  }
  const turnsSteps = zh() ? `${stats.turns} 回合 · ${stats.steps} 步` : `${stats.turns} turns · ${stats.steps} steps`;
  const summary = `${turnsSteps}${rate ? ` · ${Math.round(rate)} tok/s` : ""}`;
  return (
    <View class="flex-row items-center gap-2">
      {stats.turns > 0 ? <SummaryPill id="stats-summary-SessionActivity" icon="↶" text={summary} detail="stats-activity-detail" /> : null}
      {stats.running ? <Text class="text-xs text-success">{zh() ? "正在生成" : "Generating"}</Text> : null}
      {stats.running && stats.outputRate > 0 ? <Text class="text-xs text-muted-foreground">{`≈ ${stats.outputRate} token/s`}</Text> : null}
    </View>
  );
}

function UsageSummary({ session }: { session: any }): JSX.Element {
  const usage = session?.stats?.usage;
  if (!usage) return <View />;
  const output = session.stats.output;
  const totalInput = usage.inputTotal + usage.cacheReadTotal + output;
  const hit = cacheHit(usage.inputTotal, usage.cacheReadTotal);
  if (params.context?.displayMode === "compact") {
    return hit == null ? <View /> : <SummaryPill id="stats-summary-SessionUsage" icon="▤" text={`${zh() ? "缓存" : "cache"} ${hit.toFixed(1)}%`} detail="stats-usage-detail" mode="compact" />;
  }
  const cache = hit == null ? "" : ` · ${zh() ? "缓存" : "cache"} ${hit.toFixed(1)}%`;
  return <SummaryPill id="stats-summary-SessionUsage" icon="▤" text={`${formatTokens(totalInput)} tokens${cache}`} detail="stats-usage-detail" />;
}

function ContextSummary({ session }: { session: any }): JSX.Element {
  const usage = session?.stats?.usage;
  if (!usage) return <View />;
  const ratio = Math.min(1, usage.used / Math.max(1, usage.total));
  const percent = Math.round(ratio * 100);
  return <SummaryPill id="stats-summary-SessionContext" icon="◯" text={`${percent}%`} detail="stats-context-detail" mode={params.context?.displayMode} />;
}

function TurnSummary({ session }: { session: any }): JSX.Element {
  const turn = currentTurn(session);
  if (!turn?.stats) return <View />;
  const rate = speed(turn.stats);
  const speedSummary = rate ? `${rate.toFixed(1)} tok/s` : compactDuration(turn.durationMs);
  const tokenSummary = `${formatTokens(turn.stats.input + turn.stats.cache_read + turn.stats.output)} tok`;
  return (
    <View class="flex-row items-center gap-1">
      <SummaryPill id={`stats-summary-TurnStats:${turn.index}:speed`} icon="↶" text={speedSummary} detail="stats-turn-speed-detail" />
      <SummaryPill id={`stats-summary-TurnStats:${turn.index}:usage`} icon="▤" text={tokenSummary} detail="stats-turn-usage-detail" />
    </View>
  );
}

function StatLine(props: { id: string; label: string; value: string }): JSX.Element {
  return (
    <View testID={`${props.id}-line`} class="flex-row items-center gap-3">
      <Text testID={`${props.id}-label`} class="flex-1 text-xs text-muted-foreground">{props.label}</Text>
      <Text testID={`${props.id}-value`} class="font-mono text-xs text-foreground">{props.value}</Text>
    </View>
  );
}

function DetailPanel(props: { id: string; icon: string; title: string; value?: string; children: JSX.Element }): JSX.Element {
  return (
    <View class="gap-2 bg-popover p-3 text-foreground">
      <View class="flex-row items-center gap-2">
        <Text class="text-muted-foreground">{props.icon}</Text>
        <Text class="text-sm font-medium">{props.title}</Text>
        <View class="flex-1" />
        {props.value ? <Text class="font-mono text-sm font-medium">{props.value}</Text> : null}
      </View>
      <View class="h-px bg-border" />
      <View class="gap-2">{props.children}</View>
    </View>
  );
}

function ActivityDetail({ session }: { session: any }): JSX.Element {
  const stats = session?.stats;
  if (!stats) return <View />;
  const rate = stats.decodeMs > 0 ? stats.output / (stats.decodeMs / 1000) : null;
  return (
    <DetailPanel id="composer-activity-popup" icon="↶" title={zh() ? "会话活动" : "Session activity"}>
      <StatLine id="session-activity-turns" label={zh() ? "完成回合" : "Completed turns"} value={String(stats.turns)} />
      <StatLine id="session-activity-steps" label={zh() ? "API 步数" : "API steps"} value={String(stats.steps)} />
      <StatLine id="session-activity-model" label={zh() ? "模型耗时" : "Model time"} value={compactDuration(stats.apiMs)} />
      <StatLine id="session-activity-tool" label={zh() ? "工具耗时" : "Tool time"} value={compactDuration(stats.toolMs)} />
      <StatLine id="session-activity-first" label={zh() ? "平均首个 token" : "Average first token"} value={stats.ttftSteps ? compactDuration(stats.ttftMs / stats.ttftSteps) : "—"} />
      <StatLine id="session-activity-rate" label={zh() ? "解码速度" : "Decode speed"} value={rate ? `${rate.toFixed(1)} tok/s` : "—"} />
    </DetailPanel>
  );
}

function UsageDetail({ session }: { session: any }): JSX.Element {
  const usage = session?.stats?.usage;
  if (!usage) return <View />;
  const output = session.stats.output;
  const total = usage.inputTotal + usage.cacheReadTotal + output;
  const hit = cacheHit(usage.inputTotal, usage.cacheReadTotal);
  return (
    <DetailPanel id="composer-usage-popup" icon="▤" title={zh() ? "Token 用量" : "Token usage"} value={`${total.toLocaleString()} tokens`}>
      <StatLine id="session-usage-hit" label={zh() ? "缓存命中" : "Cache hit"} value={hit == null ? "—" : `${hit.toFixed(1)}%`} />
      <StatLine id="session-usage-input" label={zh() ? "输入" : "Input"} value={usage.inputTotal.toLocaleString()} />
      <StatLine id="session-usage-cache" label={zh() ? "缓存读取" : "Cache read"} value={usage.cacheReadTotal.toLocaleString()} />
      <StatLine id="session-usage-output" label={zh() ? "输出" : "Output"} value={output.toLocaleString()} />
    </DetailPanel>
  );
}

function ContextDetail({ session }: { session: any }): JSX.Element {
  const usage = session?.stats?.usage;
  if (!usage) return <View />;
  const ratio = Math.min(1, usage.used / Math.max(1, usage.total));
  const filled = Math.round(ratio * 10);
  const progress = `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}`;
  const breakdown = session.stats.breakdown;
  return (
    <DetailPanel id="composer-context-popup" icon="◯" title={zh() ? "上下文已用" : "Context used"}>
      <StatLine id="session-context-total" label={zh() ? "总量" : "Total"} value={`~${formatTokens(usage.used)} / ${formatTokens(usage.total)}`} />
      <Text testID="session-context-progress" class={ratio > 0.8 ? "text-warning" : "text-muted-foreground"}>{progress}</Text>
      {breakdown ? (
        <View class="gap-2">
          <StatLine id="session-context-system" label={zh() ? "系统提示" : "System prompt"} value={`~${formatTokens(breakdown.system)}`} />
          <StatLine id="session-context-tools" label={zh() ? "工具定义" : "Tool schemas"} value={`~${formatTokens(breakdown.tools)}`} />
          <StatLine id="session-context-messages" label={zh() ? "消息" : "Messages"} value={`~${formatTokens(breakdown.messages)}`} />
        </View>
      ) : null}
    </DetailPanel>
  );
}

function TurnDetail({ session, usage }: { session: any; usage: boolean }): JSX.Element {
  const turn = currentTurn(session);
  if (!turn?.stats) return <View />;
  const stats = turn.stats;
  const rate = speed(stats);
  const hit = cacheHit(stats.input, stats.cache_read);
  if (usage) {
    const total = stats.input + stats.cache_read + stats.output;
    return (
      <DetailPanel id={`turn-usage-panel-${turn.index}`} icon="▤" title={zh() ? "Token 用量" : "Token usage"} value={`${total.toLocaleString()} tokens`}>
        <StatLine id={`turn-${turn.index}-usage-hit`} label={zh() ? "缓存命中" : "Cache hit"} value={hit == null ? "—" : `${hit.toFixed(1)}%`} />
        <StatLine id={`turn-${turn.index}-usage-input`} label={zh() ? "输入" : "Input"} value={stats.input.toLocaleString()} />
        <StatLine id={`turn-${turn.index}-usage-cache`} label={zh() ? "缓存读取" : "Cache read"} value={stats.cache_read.toLocaleString()} />
        <StatLine id={`turn-${turn.index}-usage-output`} label={zh() ? "输出" : "Output"} value={stats.output.toLocaleString()} />
      </DetailPanel>
    );
  }
  return (
    <DetailPanel id={`turn-speed-panel-${turn.index}`} icon="↶" title={zh() ? "解码速度" : "Decode speed"}>
      <StatLine id={`turn-${turn.index}-speed-duration`} label={zh() ? "耗时" : "Duration"} value={duration(turn.durationMs)} />
      <StatLine id={`turn-${turn.index}-speed-steps`} label={zh() ? "API 步数" : "API steps"} value={String(stats.api_steps)} />
      <StatLine id={`turn-${turn.index}-speed-model`} label={zh() ? "模型耗时" : "Model time"} value={compactDuration(stats.api_ms)} />
      <StatLine id={`turn-${turn.index}-speed-first`} label={zh() ? "首个 token" : "First token"} value={stats.ttft_steps ? compactDuration(stats.ttft_ms / stats.ttft_steps) : "—"} />
      <StatLine id={`turn-${turn.index}-speed-tool`} label={zh() ? "工具耗时" : "Tool time"} value={compactDuration(stats.tool_ms)} />
      <StatLine id={`turn-${turn.index}-speed-rate`} label={zh() ? "解码速度" : "Decode speed"} value={rate ? `${rate.toFixed(1)} tok/s` : "—"} />
    </DetailPanel>
  );
}

export default function App() {
  switch (params.contribution) {
    case "stats-activity": return <StatsSurface render={(session) => <ActivitySummary session={session} />} />;
    case "stats-usage": return <StatsSurface render={(session) => <UsageSummary session={session} />} />;
    case "stats-context": return <StatsSurface render={(session) => <ContextSummary session={session} />} />;
    case "stats-turn": return <StatsSurface render={(session) => <TurnSummary session={session} />} />;
    case "stats-activity-detail": return <StatsSurface render={(session) => <ActivityDetail session={session} />} />;
    case "stats-usage-detail": return <StatsSurface render={(session) => <UsageDetail session={session} />} />;
    case "stats-context-detail": return <StatsSurface render={(session) => <ContextDetail session={session} />} />;
    case "stats-turn-speed-detail": return <StatsSurface render={(session) => <TurnDetail session={session} usage={false} />} />;
    case "stats-turn-usage-detail": return <StatsSurface render={(session) => <TurnDetail session={session} usage={true} />} />;
    default: return <Text>Unknown Surface contribution</Text>;
  }
}

mount(App);
