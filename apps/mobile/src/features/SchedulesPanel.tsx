import { Text } from "../components/Typography";
import { dateLocale } from "../i18n";
import { tr } from "../i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { Button, Busy, Card, Field, Notice } from "../components/UI";
import { useTheme } from "../theme";
import { errorText } from "../types";
import type { FeatureProps, ScheduleView } from "./contracts";
import { ChoiceChips, FeatureTitle, SmallText, useRemoteView } from "./common";
import { initialSchedule, schedulePayload, timingText } from "./schedule-model";

export function SchedulesPanel({
  client,
  team,
  online,
  botId,
}: FeatureProps & { botId?: string }) {
  const theme = useTheme();
  const loader = useCallback(
    () => client.action<ScheduleView>("schedules"),
    [client],
  );
  const remote = useRemoteView(loader, online, 30_000);
  const [adding, setAdding] = useState(false),
    [form, setForm] = useState(() =>
      initialSchedule(botId ?? team.bots[0]?.id),
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<string | null>(null);
  const editable = online && !team.readOnly;
  const owner = useRef({ client, botId });
  owner.current = { client, botId };
  const active = () =>
    owner.current.client === client && owner.current.botId === botId;
  useEffect(() => {
    setAdding(false);
    setBusy(false);
    setError("");
    setConfirm(null);
  }, [client, botId]);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(null), 5000);
    return () => clearTimeout(timer);
  }, [confirm]);
  const field = (name: keyof typeof form, value: string | number[]) =>
    setForm((current) => ({ ...current, [name]: value }));
  async function create() {
    setError("");
    let payload;
    try {
      payload = schedulePayload(form);
    } catch (failure) {
      setError(errorText(failure));
      return;
    }
    setBusy(true);
    try {
      const value = await client.action<ScheduleView>(
        "schedule-create",
        payload,
      );
      if (active()) {
        remote.show(value);
        setAdding(false);
      }
    } catch (failure) {
      if (active()) setError(errorText(failure));
    } finally {
      if (active()) setBusy(false);
    }
  }
  async function remove(sessionId: string, id: string) {
    if (confirm !== id) {
      setConfirm(id);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const value = await client.action<ScheduleView>("schedule-delete", {
        sessionId,
        id,
      });
      if (active()) {
        remote.show(value);
        setConfirm(null);
      }
    } catch (failure) {
      if (active()) setError(errorText(failure));
    } finally {
      if (active()) setBusy(false);
    }
  }
  const tasks = (remote.value?.tasks ?? []).filter(
    (task) => !botId || task.botId === botId,
  );
  const groups = [
    ...team.bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      tasks: tasks.filter((task) => task.botId === bot.id),
    })),
    ...team.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      tasks: tasks.filter((task) => !task.botId && task.roomId === room.id),
    })),
  ].filter((group) => group.tasks.length);
  return (
    <View style={{ gap: 16 }}>
      <FeatureTitle
        title={tr("Scheduled tasks")}
        hint={tr("A task sends its prompt to the selected conversation when it is due.")}
      >
        <Button
          title={tr("Refresh")}
          secondary
          compact
          disabled={!online || remote.loading}
          onPress={() => void remote.load()}
        />
      </FeatureTitle>
      <Notice text={error || remote.error} error />
      <Notice
        text={
          !online
            ? tr("Connect to your host to view and manage scheduled tasks.")
            : team.readOnly
        }
      />
      {!remote.value && remote.loading ? <Busy /> : null}
      {remote.value?.available === false ? (
        <Card>
          <FeatureTitle
            title={tr("Scheduled tasks are unavailable")}
            hint={tr("Enable the Schedule service in your host’s Harness profile, then reconnect.")}
          />
        </Card>
      ) : null}
      {remote.value?.available && !adding ? (
        <Button
          title={tr("＋ New task")}
          secondary
          disabled={!editable}
          onPress={() => {
            setForm(initialSchedule(botId ?? team.bots[0]?.id));
            setError("");
            setAdding(true);
          }}
        />
      ) : null}
      {adding ? (
        <Card>
          <FeatureTitle title={tr("New task")} />
          <ChoiceChips
            label={tr("Send to")}
            options={[
              ...team.bots.map((bot) => ({ value: bot.id, label: bot.name })),
              ...team.rooms.map((room) => ({
                value: room.id,
                label: `${room.name} · Group`,
              })),
            ]}
            value={form.target}
            onChange={(value) => field("target", value)}
            disabled={busy}
          />
          <Field
            label={tr("Name")}
            value={form.title}
            maxLength={120}
            placeholder={tr("Morning briefing")}
            editable={!busy}
            onChangeText={(value) => field("title", value)}
          />
          <Field
            label={tr("What to do")}
            value={form.prompt}
            multiline
            numberOfLines={3}
            placeholder={tr("Sum up what changed since yesterday and what needs me today.")}
            editable={!busy}
            onChangeText={(value) => field("prompt", value)}
          />
          <ChoiceChips
            label={tr("When")}
            options={[
              { value: "at", label: tr("Once") },
              { value: "daily", label: tr("Every day") },
              { value: "weekly", label: tr("Every week") },
              { value: "every", label: tr("Repeat") },
            ]}
            value={form.kind}
            onChange={(value) => field("kind", value)}
            disabled={busy}
          />
          {form.kind === "at" ? (
            <>
              <Field
                label={tr("Date (YYYY-MM-DD)")}
                value={form.date}
                placeholder="2026-10-12"
                onChangeText={(value) => field("date", value)}
                editable={!busy}
              />
              <SmallText>
                {tr("The date and time use your phone’s time zone.")}</SmallText>
            </>
          ) : null}
          {form.kind !== "every" ? (
            <Field
              label={tr("Time (HH:MM)")}
              value={form.time}
              keyboardType="numbers-and-punctuation"
              placeholder="09:00"
              onChangeText={(value) => field("time", value)}
              editable={!busy}
            />
          ) : null}
          {form.kind === "weekly" ? (
            <View style={{ gap: 7 }}>
              <SmallText>{tr("Days")}</SmallText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                  (name, index) => (
                    <Pressable
                      key={name}
                      accessibilityRole="checkbox"
                      accessibilityLabel={tr(name)}
                      accessibilityState={{
                        checked: form.weekdays.includes(index + 1),
                      }}
                      disabled={busy}
                      onPress={() =>
                        field(
                          "weekdays",
                          form.weekdays.includes(index + 1)
                            ? form.weekdays.filter((day) => day !== index + 1)
                            : [...form.weekdays, index + 1].sort(),
                        )
                      }
                      style={{
                        width: 38,
                        minHeight: 38,
                        borderRadius: 19,
                        justifyContent: "center",
                        alignItems: "center",
                        backgroundColor: form.weekdays.includes(index + 1)
                          ? theme.accent
                          : theme.surface,
                        borderWidth: 1,
                        borderColor: theme.line,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          color: form.weekdays.includes(index + 1)
                            ? theme.accentText
                            : theme.ink,
                        }}
                      >
                        {tr(name)}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
            </View>
          ) : null}
          {["daily", "weekly"].includes(form.kind) ? (
            <Field
              label={tr("Time zone")}
              value={form.timeZone}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(value) => field("timeZone", value)}
            />
          ) : null}
          {form.kind === "every" ? (
            <>
              <Field
                label={tr("Repeat every")}
                value={form.count}
                keyboardType="number-pad"
                editable={!busy}
                onChangeText={(value) => field("count", value)}
              />
              <ChoiceChips
                label={tr("Unit")}
                options={["minutes", "hours", "days"].map((value) => ({
                  value,
                  label: tr(value),
                }))}
                value={form.unit}
                onChange={(value) => field("unit", value)}
                disabled={busy}
              />
            </>
          ) : null}
          <View
            style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}
          >
            <Button
              title={tr("Cancel")}
              secondary
              compact
              disabled={busy}
              onPress={() => setAdding(false)}
            />
            <Button
              title={busy ? tr("Creating…") : tr("Create task")}
              compact
              disabled={
                !editable || busy || !form.title.trim() || !form.prompt.trim()
              }
              onPress={() => void create()}
            />
          </View>
        </Card>
      ) : null}
      {remote.value?.available && !tasks.length && !adding ? (
        <Card>
          <SmallText>{tr("No scheduled tasks yet.")}</SmallText>
        </Card>
      ) : null}
      {groups.map((group) => (
        <View key={group.id} style={{ gap: 8 }}>
          <FeatureTitle title={group.name} />
          <Card>
            {group.tasks.map((task) => (
              <View
                key={task.id}
                style={{
                  gap: 5,
                  borderBottomWidth: 1,
                  borderColor: theme.line,
                  paddingVertical: 9,
                  opacity: task.status === "active" ? 1 : 0.6,
                }}
              >
                <FeatureTitle title={task.title} hint={timingText(task,tr,dateLocale())} />
                <Text
                  selectable
                  style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}
                >
                  {task.prompt}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <SmallText>
                      {task.status === "active"
                        ? tr("Next: {p0}", { p0: String(new Date(task.scheduledAt).toLocaleString(dateLocale())) })
                        : tr("Finished")}
                    </SmallText>
                  </View>
                  <Button
                    title={confirm === task.id ? tr("Delete task") : tr("Delete")}
                    secondary
                    compact
                    danger
                    disabled={!editable || busy}
                    onPress={() => void remove(task.sessionId, task.id)}
                  />
                </View>
              </View>
            ))}
          </Card>
        </View>
      ))}
    </View>
  );
}
