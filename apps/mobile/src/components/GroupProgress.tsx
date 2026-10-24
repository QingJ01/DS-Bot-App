import React, { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { MobileClient } from "@ds-bot/mobile-sdk";
import { Room, TeamState, WorkStatus, errorText } from "../types";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import { BotAvatar } from "./BotAvatar";
import { Button, Notice } from "./UI";
import { type GroupRound, groupWorkMembers, waitingNames, workDescription } from "../logic/group-work";
import { WorkCapsule } from "./WorkCapsule";

/** Round progress and the host's current work/approval evidence for these members. */
export function GroupProgress({
  client,
  room,
  team,
  running,
  online,
  allowStop = false,
  onChanged,
  onOpenDetails,
  onProgress,
}: {
  client: MobileClient;
  room: Room;
  team: TeamState;
  running: boolean;
  online: boolean;
  allowStop?: boolean;
  onChanged?: () => Promise<void>;
  onOpenDetails?: () => void;
  onProgress?: (rounds: GroupRound[]) => void;
}) {
  const t = useTheme();
  const { tr, locale } = useI18n();
  const [rounds, setRounds] = useState<GroupRound[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [stopping, setStopping] = useState("");
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState("");
  const membersWork = team.work?.rooms?.[room.id];
  const workOf = (id: string) => membersWork?.find(work => work.botId === id) || (team.work?.bots[id]?.roomId === room.id ? team.work.bots[id] : undefined);
  const waits = (id: string) => team.work?.approvals.some(approval => approval.botId === id && approval.roomId === room.id);
  const busyMembers = groupWorkMembers(room, team);
  const waitingStatus = (work: WorkStatus | undefined) => {
    const names = waitingNames(work);
    return names.length ? tr("Waiting for {p0}", { p0: names.join(locale === "zh" ? "、" : ", ") }) : "";
  };
  async function stop(botId: string) {
    if (stopping || !online || team.readOnly) return;
    setStopping(botId); setError("");
    try {
      await client.action("stop-member-work", { roomId: room.id, botId });
      await onChanged?.();
    } catch (cause) { setError(tr("Could not stop member work.") + " " + errorText(cause)); }
    finally { setStopping(""); }
  }
  async function resume() {
    if (resuming || !online || team.readOnly) return;
    setResuming(true); setError("");
    try {
      await client.action("room-continue", { roomId: room.id });
      await onChanged?.();
    } catch (cause) { setError(errorText(cause)); }
    finally { setResuming(false); }
  }
  useEffect(() => {
    let alive = true;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let foreground = AppState.currentState === "active";
    setRounds([]);
    setUnavailable(false);
    if (!running || !online) return;
    const poll = async (run: number) => {
      if (!alive || !foreground || run !== generation) return;
      try {
        const result = await client.action<GroupRound[]>("room-progress", {
          roomId: room.id,
        });
        if (!alive || !foreground || run !== generation) return;
        const current = Array.isArray(result) ? result.filter(round => round && Array.isArray(round.replies)) : [];
        setRounds(current);
        if (current.length) onProgress?.(current);
        setUnavailable(false);
      } catch {
        if (!alive || !foreground || run !== generation) return;
        setRounds([]);
        setUnavailable(true);
      }
      if (alive && foreground && run === generation)
        timer = setTimeout(() => void poll(run), 1000);
    };
    const start = () => {
      generation++;
      clearTimeout(timer);
      if (foreground) void poll(generation);
    };
    start();
    const subscription = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      setRounds([]);
      setUnavailable(false);
      start();
    });
    return () => {
      alive = false;
      generation++;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [client, room.id, running, online, onProgress]);
  if (!online) return null;
  if (Array.isArray(room.paused) && room.paused.length) return (
    <View style={{gap:8,paddingHorizontal:12,paddingBottom:8}}>
      <Notice text={tr("Group relays are paused. Continue or send a message to resume.")} />
      <Notice error text={error} />
      <Button title={tr("Continue group")} secondary disabled={resuming || !!team.readOnly} onPress={() => void resume()} />
    </View>
  );
  if ((!running && !busyMembers.length) || (!rounds.length && !unavailable && !busyMembers.length)) return null;
  if (unavailable && !busyMembers.length)
    return (
      <Text
        style={{
          fontSize: 11,
          color: t.muted,
          paddingHorizontal: 12,
          paddingBottom: 6,
        }}
      >
        {tr("Group activity is temporarily unavailable.")}
      </Text>
    );
  if (!allowStop) {
    const waiting = busyMembers.filter(item => item.waiting);
    const active = waiting[0] || busyMembers[0];
    const status = active ? active.waiting ? tr("Waiting for approval") : waitingStatus(active.work) || (active.work?.switching ? tr("Moving to a fresh conversation") : workDescription(active.work) || tr("Working")) : "";
    const summary = active ? `${active.bot.name} · ${status}${busyMembers.length > 1 ? ` +${busyMembers.length - 1}` : ""}` : tr("Group is responding");
    return <WorkCapsule bot={active?.bot} label={summary} onPress={onOpenDetails}/>;
  }
  return (
    <View><Notice error text={error} /><View style={{gap:8,paddingHorizontal:12,paddingBottom:8}}>
      {(running && rounds.length ? room.members : busyMembers.map(item => item.bot.id)).map((id) => {
        const bot = team.bots.find((item) => item.id === id);
        if (!bot) return null;
        const speaking = rounds.some((round) => round.speaking === id) || membersWork?.some(work => work.botId === id && work.speaking);
        const replies = rounds
          .flatMap((round) => round.replies)
          .filter((reply) => reply.botId === id);
        const reply = replies[replies.length - 1];
        const waiting = waits(id);
        const doing = workOf(id);
        const status = waiting ? tr("Waiting for approval") : waitingStatus(doing) || (doing?.switching ? tr("Moving to a fresh conversation") : workDescription(doing) || (speaking
          ? tr("Typing…")
          : reply?.kind === "failed"
            ? tr("Could not answer")
            : reply?.kind === "lookup"
              ? tr("Looking back through the chat")
              : reply
                ? tr("Replied")
                : doing ? tr("Working") : ""));
        return (
          <View
            key={id}
            accessibilityLabel={`${bot.name}${status ? ` · ${status}` : ""}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 16,
              minHeight: 44,
              paddingVertical: 7,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: speaking ? t.accent : t.line,
              backgroundColor: speaking ? t.soft : t.surface,
            }}
          >
            <BotAvatar bot={bot} size={22} live={speaking} />
            <View style={{flex:1,minWidth:0}}>
              <Text style={{ fontSize: 12, color: t.ink }}>{bot.name}{room.admin === id ? ` · ${tr("Admin")}` : ""}</Text>
              {!!status && (
                <Text
                  numberOfLines={2} style={{
                    fontSize: 10,
                    color:
                      reply?.kind === "failed" && !speaking ? t.error : t.muted,
                  }}
                >
                  {status}
                </Text>
              )}
            </View>
            {allowStop && doing && <Button title={tr("Stop member work")} compact secondary disabled={!!stopping || !!team.readOnly}
              onPress={() => void stop(id)} />}
          </View>
        );
      })}
    </View></View>
  );
}
