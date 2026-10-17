import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button, Busy, Card, Field, Notice, Tag } from "../components/UI";
import { dateLocale, tr } from "../i18n";
import { errorText } from "../types";
import { ChoiceChips, FeatureTitle, SmallText, useRemoteView } from "./common";
import type { FeatureProps, WebhookItem, WebhookView } from "./contracts";
import {
  confirmKey,
  deliveryCount,
  hookPayload,
  hookTarget,
  initialHook,
  ROOM_MARK,
} from "./hooks-model";

export function WebhooksPanel({ client, team, online }: FeatureProps) {
  const loader = useCallback(
    () => client.action<WebhookView>("hooks-list"),
    [client],
  );
  const remote = useRemoteView(loader, online, 30_000);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => initialHook(team.bots[0]?.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(
    null,
  );
  const [copied, setCopied] = useState("");
  const alive = useRef(true);
  const editable = online && !team.readOnly;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(""), 5000);
    return () => clearTimeout(timer);
  }, [confirm]);
  // Every change answers with a small object, so the list is reloaded to stay the one
  // source of what the host holds.
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setCopied("");
    try {
      await work();
      if (!alive.current) return;
      await remote.load();
      if (!alive.current) return;
      setAdding(false);
      setConfirm("");
    } catch (failure) {
      if (alive.current) setError(errorText(failure));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function create() {
    let payload;
    try {
      payload = hookPayload(form);
    } catch (failure) {
      setError(errorText(failure));
      return;
    }
    void run(async () => {
      const made = await client.action<{ hook: WebhookItem; secret: string }>(
        "hook-create",
        payload,
      );
      if (made?.secret)
        setSecret({ name: made.hook?.name ?? payload.name, value: made.secret });
    });
  }
  function rotate(item: WebhookItem) {
    const key = confirmKey("rotate", item.id);
    if (confirm !== key) {
      setConfirm(key);
      return;
    }
    void run(async () => {
      const rotated = await client.action<{ hook: WebhookItem; secret: string }>(
        "hook-rotate",
        { id: item.id },
      );
      if (rotated?.secret) setSecret({ name: item.name, value: rotated.secret });
    });
  }
  function remove(item: WebhookItem) {
    const key = confirmKey("delete", item.id);
    if (confirm !== key) {
      setConfirm(key);
      return;
    }
    void run(async () => {
      await client.action("hook-delete", { id: item.id });
    });
  }
  function toggle(item: WebhookItem) {
    void run(async () => {
      await client.action("hook-update", { id: item.id, enabled: !item.enabled });
    });
  }
  async function copy(value: string, key: string) {
    try {
      await Clipboard.setStringAsync(value);
      if (alive.current) setCopied(key);
    } catch (failure) {
      if (alive.current) setError(errorText(failure));
    }
  }
  const value = remote.value;
  const hooks = value?.hooks ?? [];
  const options = [
    ...team.bots.map((bot) => ({ value: bot.id, label: bot.name })),
    ...team.rooms.map((room) => ({
      value: `${ROOM_MARK}${room.id}`,
      label: `${room.name} · ${tr("Group")}`,
    })),
  ];
  const targetLabel = (item: WebhookItem) => {
    const target = hookTarget(item, team.bots, team.rooms);
    return target.kind === "room"
      ? `${target.name} · ${tr("Group")}`
      : target.name;
  };
  return (
    <View style={{ gap: 16 }}>
      <FeatureTitle
        title={tr("Webhooks")}
        hint={tr("An external service POSTs to a webhook URL, and what it sends arrives in the chosen conversation as a message.")}
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
            ? tr("Connect to your host to view and manage webhooks.")
            : team.readOnly
        }
      />
      {value && !value.enabled ? (
        <Notice text={tr("Webhooks are off on this host. Set config.hooks.enabled to true in the plugin config, then reconnect.")} />
      ) : null}
      {value?.error ? <Notice text={value.error} error /> : null}
      {!value && remote.loading ? <Busy /> : null}
      {secret ? (
        <Card>
          <FeatureTitle
            title={tr("Copy this secret now; it is not shown again.")}
            hint={secret.name}
          />
          <SmallText>{secret.value}</SmallText>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Button
              compact
              secondary
              title={copied === "secret" ? tr("Copied") : tr("Copy secret")}
              onPress={() => void copy(secret.value, "secret")}
            />
            <Button compact secondary title={tr("Done")} onPress={() => setSecret(null)} />
          </View>
        </Card>
      ) : null}
      {value && !adding ? (
        <Button
          title={tr("＋ New webhook")}
          secondary
          disabled={!editable}
          onPress={() => {
            setForm(initialHook(team.bots[0]?.id));
            setError("");
            setAdding(true);
          }}
        />
      ) : null}
      {adding ? (
        <Card>
          <FeatureTitle title={tr("New webhook")} />
          <Field
            label={tr("Name")}
            value={form.name}
            maxLength={60}
            placeholder={tr("Deploy notifications")}
            editable={!busy}
            onChangeText={(next) =>
              setForm((current) => ({ ...current, name: next }))
            }
          />
          <ChoiceChips
            label={tr("Reaches")}
            options={options}
            value={form.target}
            onChange={(next) =>
              setForm((current) => ({ ...current, target: next }))
            }
            disabled={busy}
          />
          <Field
            label={tr("Message template")}
            value={form.template}
            maxLength={500}
            multiline
            numberOfLines={2}
            placeholder={tr("Optional: {{text}} is what the service sends, {{name}} is the webhook name.")}
            editable={!busy}
            onChangeText={(next) =>
              setForm((current) => ({ ...current, template: next }))
            }
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Button
              title={tr("Cancel")}
              secondary
              compact
              disabled={busy}
              onPress={() => setAdding(false)}
            />
            <Button
              title={busy ? tr("Creating…") : tr("Create webhook")}
              compact
              disabled={!editable || busy || !form.name.trim() || !form.target}
              onPress={create}
            />
          </View>
        </Card>
      ) : null}
      {value && !hooks.length && !adding ? (
        <Card>
          <SmallText>{tr("No webhooks yet.")}</SmallText>
        </Card>
      ) : null}
      {hooks.map((item) => (
        <Card key={item.id}>
          <FeatureTitle title={item.name} hint={targetLabel(item)}>
            <Tag>{item.enabled ? tr("Enabled") : tr("Disabled")}</Tag>
          </FeatureTitle>
          {item.url ? <SmallText>{item.url}</SmallText> : null}
          {item.template ? <SmallText>{item.template}</SmallText> : null}
          <SmallText>
            {deliveryCount(item)
              ? tr("Deliveries: {count}", { count: deliveryCount(item) })
              : tr("Never delivered")}
          </SmallText>
          {item.lastDeliveryAt ? (
            <SmallText>
              {tr("Last delivery {when}", {
                when: new Date(item.lastDeliveryAt).toLocaleString(dateLocale()),
              })}
            </SmallText>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {item.url ? (
              <Button
                compact
                secondary
                title={copied === item.id ? tr("Copied") : tr("Copy URL")}
                onPress={() => void copy(item.url ?? "", item.id)}
              />
            ) : null}
            <Button
              compact
              secondary
              title={item.enabled ? tr("Disable") : tr("Enable")}
              disabled={!editable || busy}
              onPress={() => toggle(item)}
            />
            <Button
              compact
              secondary
              title={
                confirm === confirmKey("rotate", item.id)
                  ? tr("Confirm rotation")
                  : tr("Rotate secret")
              }
              disabled={!editable || busy}
              onPress={() => rotate(item)}
            />
            <Button
              compact
              secondary
              danger
              title={
                confirm === confirmKey("delete", item.id)
                  ? tr("Delete webhook")
                  : tr("Delete")
              }
              disabled={!editable || busy}
              onPress={() => remove(item)}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}
