import { BotCapabilities } from "../host-settings/CapabilitiesPanel";
import { WorkingFolderPicker } from "../components/WorkingFolderPicker";
import { useI18n } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { PageTransition, AnimatedPressable as Pressable } from "../components/Motion";
import { MobileClient } from "@ds-bot/mobile-sdk";
import {
  Button,
  Field,
  IconButton,
  Label,
  Notice,
  PageHeader,
  Section,
  SettingRow,
  Sheet,
  Tag,
  ToggleRow,
  styles,
} from "../components/UI";
import {
  BotAvatar,
  RoomAvatar,
  defaultColor,
  defaultShape,
} from "../components/BotAvatar";
import { AvatarEditor } from "../components/AvatarEditor";
import { ThinkingLevelPicker } from "../components/ThinkingLevelPicker";
import { ApprovalCards } from "../components/ApprovalCards";
import { GroupProgress } from "../components/GroupProgress";
import { MemoryPanel, SchedulesPanel } from "../features";
import { Bot, errorText, Room, TeamState } from "../types";
import { useTheme } from "../theme";
type Page =
  | "list"
  | "bot"
  | "group"
  | "character"
  | "model"
  | "memory"
  | "schedules"
  | "primary"
  | "add-main";
export function TeamScreen({
  client,
  team,
  refresh,
  openConversation,
  online,
  initialSection = "bots",
  initialId,
  create,
  onOpenNavigation,
  onBack,
  onCreate,
}: {
  client: MobileClient;
  team: TeamState;
  refresh: () => Promise<void>;
  openConversation: (id: string) => void;
  online: boolean;
  initialSection?: "bots" | "groups";
  initialId?: string;
  create?: "bot" | "group";
  onOpenNavigation?: () => void;
  onBack?: () => void;
  onCreate?: (kind: "bot" | "group") => void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const focusedField = useRef(false);
  const [section, setSection] = useState(initialSection);
  const [page, setPage] = useState<Page>(
    initialId
      ? initialSection === "groups"
        ? "group"
        : "bot"
      : create || "list",
  );
  const [botId, setBotId] = useState(
    initialSection === "bots" ? initialId || "" : "",
  );
  const [roomId, setRoomId] = useState(
    initialSection === "groups" ? initialId || "" : "",
  );
  const [bot, setBot] = useState<Bot>(
    () => team.bots.find((b) => b.id === initialId) || newBot(),
  );
  const [room, setRoom] = useState<Room>(() => {
    const r = team.rooms.find((r) => r.id === initialId);
    return r
      ? { ...r, name: r.named ? r.name : "" }
      : {
          id: "",
          name: "",
          members: [],
          admin: null,
          mode: "admin",
          notice: "",
        };
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    text: string;
    run: () => Promise<void>;
  } | null>(null);
  const locked = busy || !online || !!team.readOnly;
  const permissionOptions = team.permissions?.options.filter(option => option.value !== "auto") || [];
  const groupPermissionDefault = permissionOptions.find(option => option.value === team.permissions?.defaultPreset)?.value || permissionOptions[0]?.value;
  const mainIds = team.mainBotIds?.length
    ? team.mainBotIds
    : team.mainBotId
      ? [team.mainBotId]
      : [];
  const isMain = mainIds.includes(botId);
  const primary = mainIds[0] === botId;
  function newBot(): Bot {
    const id = String(Math.random());
    return {
      id: "",
      name: "",
      role: "",
      instructions: "",
      color: defaultColor(id),
      avatar: { shape: defaultShape(id) },
      model: team.models.some((m) => m.ref === team.defaultModel)
        ? team.defaultModel
        : team.models[0]?.ref,
    };
  }
  useEffect(() => {
    const updated = team.bots.find((b) => b.id === botId);
    if (updated && !focusedField.current) setBot(updated);
  }, [team.bots, botId]);
  useEffect(() => {
    const updated = team.rooms.find((r) => r.id === roomId);
    if (updated && !focusedField.current)
      setRoom({ ...updated, name: updated.named ? updated.name : "" });
  }, [team.rooms, roomId]);
  async function action<T = unknown>(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      const result = await client.action<T>(endpoint, payload);
      await refresh();
      return result;
    } catch (err) {
      setError(errorText(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function saveBot(patch: Record<string, unknown>) {
    if (!botId) {
      setBot({ ...bot, ...patch } as Bot);
      return;
    }
    await action("update-bot", { id: botId, ...patch });
  }
  async function saveRoom(patch: Record<string, unknown>) {
    if (!roomId) {
      setRoom({ ...room, ...patch } as Room);
      return;
    }
    await action("update-room", { id: roomId, ...patch });
  }
  function editBot(item: Bot) {
    setBotId(item.id);
    setBot({ ...item });
    setPage("bot");
    setError("");
  }
  function editRoom(item: Room) {
    setRoomId(item.id);
    setRoom({ ...item, name: item.named ? item.name : "" });
    setPage("group");
    setError("");
  }
  function back() {
    setError("");
    if (["character", "model", "memory", "schedules"].includes(page))
      setPage("bot");
    else if (page !== "list") {
      setPage("list");
      setBotId("");
      setRoomId("");
    } else onBack?.();
  }
  const title =
    page === "list"
      ? section === "bots"
        ? tr("Bots")
        : tr("Group chats")
      : page === "bot"
        ? botId
          ? bot.name
          : tr("New Bot")
        : page === "group"
          ? roomId
            ? team.rooms.find((r) => r.id === roomId)?.name || tr("Group chat")
            : tr("New group chat")
          : page === "character"
            ? tr("Character")
            : page === "model"
              ? tr("Model")
              : page === "memory"
                ? `${bot.name} · ${tr("Memory")}`
                : page === "schedules"
                  ? `${bot.name} · ${tr("Scheduled tasks")}`
                  : page === "primary"
                    ? tr("Main Bot")
                    : tr("Add a Main Bot");
  function flags(id: string, patch: Record<string, unknown>) {
    void action("set-flags", { id, ...patch });
  }
  const rowBot = (item: Bot, onPress: () => void, extra?: React.ReactNode) => (
    <SettingRow
      key={item.id}
      title={item.name}
      accessibilityLabel={tr(page === "primary" ? "Choose Main Bot: {name}" : "Edit Bot: {name}", {name:item.name})}
      hint={item.role || undefined}
      leading={
        <BotAvatar bot={item} size={32} main={mainIds.includes(item.id)} />
      }
      onPress={onPress}
    >
      {extra}
    </SettingRow>
  );
  return (
    <View style={{ flex: 1 }}>
      <PageHeader floating
        title={title}
        onBack={page !== "list" || onBack ? back : undefined}
        onOpenNavigation={onOpenNavigation}
        right={
          page === "list" ? (
            <IconButton
              name="plus"
              label={tr(section === "bots" ? "New Bot" : "New group chat")}
              disabled={
                locked || (section === "groups" && team.bots.length < 2)
              }
              onPress={() => {
                setError("");
                if (onCreate) {onCreate(section === "bots" ? "bot" : "group");return;}
                if (section === "bots") {
                  setBotId("");
                  setBot(newBot());
                  setPage("bot");
                } else {
                  setRoomId("");
                  setRoom({
                    id: "",
                    name: "",
                    members: [],
                    admin: null,
                    mode: "admin",
                  });
                  setPage("group");
                }
              }}
            />
          ) : undefined
        }
      />
      <PageTransition key={page}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.page, {paddingTop:92}]}
      >
        <Notice error text={error} />
        <Notice
          text={
            team.readOnly ||
            (!online
              ? tr(
                  "Your host is offline. Settings can be changed when it reconnects.",
                )
              : "")
          }
        />
        {page === "list" && (
          <>
            <View
              style={[
                styles.row,
                { backgroundColor: t.hover, padding: 4, borderRadius: 12 },
              ]}
            >
              {(["bots", "groups"] as const).map((key) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: section === key }}
                  onPress={() => setSection(key)}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 9,
                    backgroundColor: section === key ? t.surface : undefined,
                  }}
                >
                  <Text
                    style={{
                      color: t.ink,
                      fontSize: 13,
                      fontWeight: section === key ? "600" : "400",
                    }}
                  >
                    {tr(key === "bots" ? "Bots" : "Group chats")}
                  </Text>
                </Pressable>
              ))}
            </View>
            {section === "bots" ? (
              <>
                <Section
                  title={tr("Main Bot")}
                  footer={tr(
                    "Your main point of contact. Main Bots can organize the team and keep work moving.",
                  )}
                >
                  <SettingRow
                    title={
                      team.bots.find((b) => b.id === mainIds[0])?.name ||
                      tr("Choose a Main Bot")
                    }
                    accessibilityLabel={tr("Choose Main Bot: {name}",{name:team.bots.find(b=>b.id===mainIds[0])?.name || "Bot"})}
                    hint={tr("Shown first in the conversation list.")}
                    leading={
                      team.bots.find((b) => b.id === mainIds[0]) ? (
                        <BotAvatar
                          bot={team.bots.find((b) => b.id === mainIds[0])!}
                          main
                          size={32}
                        />
                      ) : undefined
                    }
                    onPress={() => setPage("primary")}
                    disabled={locked}
                  />
                  {mainIds.slice(1).map((id) => {
                    const item = team.bots.find((b) => b.id === id);
                    return item ? (
                      <SettingRow
                        key={id}
                        title={item.name}
                        leading={<BotAvatar bot={item} main size={30} />}
                      >
                        <Button
                          title={tr("Move to first")}
                          compact
                          secondary
                          disabled={locked}
                          onPress={() =>
                            action("set-main", {
                              id,
                              main: true,
                              primary: true,
                            })
                          }
                        />
                        <IconButton
                          name="close"
                          label={tr("Remove Main Bot role from {name}", {
                            name: item.name,
                          })}
                          disabled={locked}
                          onPress={() =>
                            action("set-main", { id, main: false })
                          }
                        />
                      </SettingRow>
                    ) : null;
                  })}
                  <SettingRow
                    title={tr("Add a Main Bot")}
                    onPress={() => setPage("add-main")}
                    disabled={locked || mainIds.length === team.bots.length}
                    last
                  />
                </Section>
                <Section title={tr("Character animation")}>
                  <SettingRow
                    title={tr("Motion")}
                    hint={tr("How lively your Bots feel.")}
                    last
                  />
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 6,
                      padding: 12,
                    }}
                  >
                    {["quiet", "normal", "lively"].map((motion) => (
                      <Button
                        key={motion}
                        title={tr(motion[0].toUpperCase() + motion.slice(1))}
                        secondary={(team.prefs?.motion || "normal") !== motion}
                        compact
                        disabled={locked}
                        onPress={() => action("set-prefs", { motion })}
                      />
                    ))}
                  </View>
                </Section>
                <Section title={tr("Bots")}>
                  {team.bots.map((item) =>
                    rowBot(
                      item,
                      () => editBot(item),
                      <View style={{ flexDirection: "row", gap: 4 }}>
                        {mainIds.includes(item.id) && (
                          <Tag>{tr("Main Bot")}</Tag>
                        )}
                        {item.hidden && <Tag>{tr("Hidden")}</Tag>}
                      </View>,
                    ),
                  )}
                  <SettingRow
                    title={tr("New Bot")}
                    onPress={() => {
                      if (onCreate) {onCreate("bot");return;}
                      setBotId("");
                      setBot(newBot());
                      setPage("bot");
                    }}
                    disabled={locked}
                    last
                  />
                </Section>
              </>
            ) : (
              <Section title={tr("Group chats")}>
                {team.rooms.map((item) => (
                  <SettingRow
                    key={item.id}
                    title={item.name}
                    hint={item.members
                      .map(
                        (id) => team.bots.find((b) => b.id === id)?.name || id,
                      )
                      .join(", ")}
                    leading={<RoomAvatar room={item} team={team} />}
                    onPress={() => editRoom(item)}
                  >
                    {item.hidden && <Tag>{tr("Hidden")}</Tag>}
                  </SettingRow>
                ))}
                {!team.rooms.length && (
                  <SettingRow
                    title={tr("No group chats yet")}
                    hint={tr("Bring Bots together in a shared conversation.")}
                  />
                )}
                <SettingRow
                  title={tr("New group chat")}
                  hint={
                    team.bots.length < 2
                      ? tr("Create at least two Bots first.")
                      : undefined
                  }
                  disabled={locked || team.bots.length < 2}
                  onPress={() => {
                    if (onCreate) {onCreate("group");return;}
                    setRoomId("");
                    setRoom({
                      id: "",
                      name: "",
                      members: [],
                      admin: null,
                      mode: "admin",
                    });
                    setPage("group");
                  }}
                  last
                />
              </Section>
            )}
          </>
        )}
        {(page === "primary" || page === "add-main") && (
          <Section
            title={tr(
              page === "primary" ? "Choose a Main Bot" : "Choose a Bot",
            )}
          >
            {team.bots
              .filter((b) => page === "primary" || !mainIds.includes(b.id))
              .map((item) =>
                rowBot(
                  item,
                  async () => {
                    const result = await action(
                      "set-main",
                      page === "primary"
                        ? { id: item.id, main: true, replace: mainIds[0] }
                        : { id: item.id, main: true },
                    );
                    if (result !== undefined) setPage("list");
                  },
                  mainIds[0] === item.id ? <Tag>{tr("First")}</Tag> : undefined,
                ),
              )}
          </Section>
        )}
        {page === "bot" && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("Edit character")}
              disabled={locked}
              onPress={() => setPage("character")}
              style={{ alignItems: "center", gap: 10, padding: 12 }}
            >
              <BotAvatar bot={bot} size={72} main={isMain} />
              <Text style={{ color: t.muted, fontSize: 12 }}>
                {tr("Edit character")}
              </Text>
            </Pressable>
            <Section title={tr("Bot")}>
              <View style={{ padding: 12, gap: 14 }}>
                <Field
                  label={tr("Name")}
                  placeholder={tr("New Bot")}
                  maxLength={40}
                  value={bot.name}
                  editable={!locked}
                  onChangeText={(name) => setBot({ ...bot, name })}
                  onFocus={() => {
                    focusedField.current = true;
                  }}
                  onBlur={() => {
                    focusedField.current = false;
                    if (botId && bot.name.trim())
                      void saveBot({ name: bot.name.trim() });
                  }}
                />
                <Field
                  label={tr("Label")}
                  placeholder={tr("Optional")}
                  maxLength={24}
                  value={bot.role || ""}
                  editable={!locked}
                  onChangeText={(role) => setBot({ ...bot, role })}
                  onFocus={() => {
                    focusedField.current = true;
                  }}
                  onBlur={() => {
                    focusedField.current = false;
                    if (botId) void saveBot({ role: bot.role || "" });
                  }}
                />
              </View>
              <SettingRow
                title={tr("Model")}
                hint={
                  team.models.find((m) => m.ref === bot.model)?.name ||
                  bot.model ||
                  tr("Choose a model")
                }
                disabled={locked}
                onPress={() => setPage("model")}
              />
              <View style={{paddingHorizontal:12}}><ThinkingLevelPicker client={client} model={team.models.find(model=>model.ref===bot.model)} value={bot.effort} disabled={locked} choose={effort=>saveBot({effort})}/></View>
            </Section>
            {botId && <Section title={tr("Capabilities")}><BotCapabilities client={client} bot={team.bots.find(item => item.id === botId) || bot} team={team} online={online} refresh={refresh}/></Section>}
            {botId && <WorkingFolderPicker key={botId} client={client} value={bot.workDir} disabled={locked} choose={async workDir => (await action("update-bot", { id: botId, workDir })) !== undefined} />}
            {botId && !!team.permissions?.options.length && <Section title={tr("Permissions")} footer={tr("Applies to this Bot’s own chat and new parts. Groups can override it with shared permissions.")}>
              <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,padding:12}}>{team.permissions.options.filter(option=>option.value!=="auto").map(option=><Button key={option.value} title={tr(({"read-only":"Read only","workspace-write":"Workspace","danger-full-access":"Full access"} as Record<string,string>)[option.value] || option.name || option.value)} compact danger={option.value==="danger-full-access" && bot.permission===option.value} secondary={(bot.permission || team.permissions?.defaultPreset)!==option.value} disabled={locked} onPress={()=>void saveBot({permission:option.value})}/>)}</View>
            </Section>}
            <Section
              title={tr("Instructions")}
              footer={tr("Instructions are added to this Bot’s system prompt.")}
            >
              <View style={{ padding: 12 }}>
                <Field
                  label={tr("Instructions")}
                  placeholder={tr("How should this Bot work?")}
                  value={bot.instructions || ""}
                  editable={!locked}
                  multiline
                  style={{ minHeight: 128 }}
                  onChangeText={(instructions) =>
                    setBot({ ...bot, instructions })
                  }
                  onFocus={() => {
                    focusedField.current = true;
                  }}
                  onBlur={() => {
                    focusedField.current = false;
                    if (botId)
                      void saveBot({ instructions: bot.instructions || "" });
                  }}
                />
              </View>
            </Section>
            {!botId ? (
              <Button
                title={tr(busy ? "Creating…" : "Create")}
                disabled={locked}
                onPress={async () => {
                  let name = bot.name.trim();
                  if (!name) {
                    name = "New Bot";
                    let suffix = 2;
                    while (
                      team.bots.some(
                        (b) => b.name.toLowerCase() === name.toLowerCase(),
                      )
                    )
                      name = `New Bot ${suffix++}`;
                  }
                  const created = await action<Bot>("create-bot", {
                    name,
                    role: bot.role || "",
                    instructions: bot.instructions || "",
                    model: bot.model,
                    effort: bot.effort,
                    color: bot.color,
                    avatar: bot.avatar,
                  });
                  if (created?.id) {
                    setBotId(created.id);
                    setBot(created);
                    setPage("bot");
                  }
                }}
              />
            ) : (
              <>
                <Button
                  title={tr("Open chat")}
                  secondary
                  onPress={() => openConversation(botId)}
                />
                <Section title={tr("Knowledge and tasks")}>
                  {team.memory !== false && (
                    <SettingRow
                      title={tr("Memory")}
                      hint={tr("What this Bot remembers.")}
                      onPress={() => setPage("memory")}
                      disabled={!online}
                    />
                  )}
                  <SettingRow
                    title={tr("Scheduled tasks")}
                    hint={tr("Tasks this Bot runs on a schedule.")}
                    onPress={() => setPage("schedules")}
                    disabled={!online}
                    last
                  />
                </Section>
                <Section title={tr("Team")}>
                  <ToggleRow
                    title={tr("Main Bot")}
                    hint={tr(
                      isMain && mainIds.length === 1
                        ? "To change the only Main Bot, choose a replacement in Bots settings."
                        : "Let this Bot organize the team.",
                    )}
                    value={isMain}
                    disabled={locked || (isMain && mainIds.length === 1)}
                    onChange={(main) => action("set-main", { id: botId, main })}
                    last
                  />
                </Section>
                {!primary && (
                  <Section title={tr("Conversations")}>
                    <ToggleRow
                      title={tr("Pin")}
                      value={!!bot.pinned}
                      onChange={(pinned) => flags(botId, { pinned })}
                      disabled={locked}
                      last={isMain}
                    />
                    {!isMain && (
                      <ToggleRow
                        title={tr("Hide")}
                        hint={tr(
                          "Hidden Bots remain available in settings and groups.",
                        )}
                        value={!!bot.hidden}
                        onChange={(hidden) => flags(botId, { hidden })}
                        disabled={locked}
                        last
                      />
                    )}
                  </Section>
                )}
                <Section title={tr("Actions")}>
                  <SettingRow
                    title={tr("Duplicate Bot")}
                    hint={tr("A copy with fresh memory and conversation.")}
                    onPress={async () => {
                      const copy = await action<Bot>("duplicate-bot", {
                        id: botId,
                      });
                      if (copy?.id) editBot(copy);
                    }}
                    disabled={locked}
                    last={isMain}
                  />
                  {!isMain && (
                    <SettingRow
                      title={tr("Delete Bot")}
                      danger
                      hint={tr("Its chats are archived.")}
                      disabled={locked}
                      onPress={() =>
                        setConfirm({
                          text: tr(
                            "Delete {name}? Its chats will be archived.",
                            { name: bot.name },
                          ),
                          run: async () => {
                            const result = await action("delete-bot", {
                              id: botId,
                            });
                            if (result !== undefined) {
                              setBotId("");
                              setPage("list");
                            }
                          },
                        })
                      }
                      last
                    />
                  )}
                </Section>
              </>
            )}
          </>
        )}
        {page === "character" && (
          <AvatarEditor
            bot={bot}
            disabled={locked}
            onChange={(patch) => {
              setBot({ ...bot, ...patch });
              void saveBot(patch);
            }}
            onReset={
              botId ? () => saveBot({ avatar: null, color: null }) : undefined
            }
          />
        )}
        {page === "model" && (
          <>
            <Notice
              text={tr(
                botId
                  ? "A new model applies to the next message."
                  : "You can choose a model now or after creating the Bot.",
              )}
            />
            {Array.from(
              new Set(
                team.models.map(
                  (m) => m.providerName || m.provider || "Models",
                ),
              ),
            ).map((provider) => (
              <Section key={provider} title={provider}>
                {team.models
                  .filter(
                    (m) =>
                      (m.providerName || m.provider || "Models") === provider,
                  )
                  .map((model) => (
                    <SettingRow
                      key={model.ref}
                      title={model.name}
                      hint={model.ref}
                      onPress={async () => {
                        setBot({ ...bot, model: model.ref, effort: undefined });
                        await saveBot({ model: model.ref, effort: null });
                        setPage("bot");
                      }}
                      disabled={locked}
                    >
                      {bot.model === model.ref && <Tag>{tr("Selected")}</Tag>}
                      {team.defaultModel === model.ref && (
                        <Tag>{tr("Default")}</Tag>
                      )}
                    </SettingRow>
                  ))}
              </Section>
            ))}
            {!team.models.length && (
              <Notice
                text={tr(
                  "No models available. Configure a model provider in Harness settings.",
                )}
              />
            )}
          </>
        )}
        {page === "memory" && botId && (
          <MemoryPanel
            client={client}
            team={team}
            online={online}
            botId={botId}
            onOpenBot={(id) => {
              const item = team.bots.find((b) => b.id === id);
              if (item) editBot(item);
            }}
          />
        )}
        {page === "schedules" && botId && (
          <SchedulesPanel
            client={client}
            team={team}
            online={online}
            botId={botId}
          />
        )}
        {page === "group" && (
          <>
            {roomId && <><GroupProgress client={client} room={room} team={team} running={false} online={online && !team.readOnly} allowStop onChanged={refresh}/><ApprovalCards client={client} conversationId={room.id} online={online && !team.readOnly} messages={[]}/></>}
            <View style={{ alignItems: "center", padding: 12 }}>
              <RoomAvatar room={room} team={team} size={72} />
            </View>
            <Section title={tr("Group chat")}>
              <View style={{ padding: 12, gap: 14 }}>
                <Field
                  label={tr("Name")}
                  placeholder={tr("Name after members")}
                  value={room.name}
                  maxLength={60}
                  editable={!locked}
                  onChangeText={(name) => setRoom({ ...room, name })}
                  onFocus={() => {
                    focusedField.current = true;
                  }}
                  onBlur={() => {
                    focusedField.current = false;
                    if (roomId) void saveRoom({ name: room.name.trim() });
                  }}
                />
                <Field
                  label={tr("Group notice")}
                  placeholder={tr("Every member reads this before speaking.")}
                  value={room.notice || ""}
                  maxLength={2000}
                  editable={!locked}
                  multiline
                  style={{ minHeight: 100 }}
                  onChangeText={(notice) => setRoom({ ...room, notice })}
                  onFocus={() => {
                    focusedField.current = true;
                  }}
                  onBlur={() => {
                    focusedField.current = false;
                    if (roomId) void saveRoom({ notice: room.notice || "" });
                  }}
                />
              </View>
            </Section>
            {roomId && <WorkingFolderPicker key={roomId} client={client} value={room.workDir} group disabled={locked} choose={async workDir => (await action("update-room", { id: roomId, workDir })) !== undefined} />}
            {roomId && !!permissionOptions.length && <Section title={tr("Permissions")}>
              <ToggleRow title={tr("Same for every member")} hint={tr("Replaces each member's own permissions in this group.")}
                value={!!room.permission} disabled={locked} last={!room.permission}
                onChange={shared => void saveRoom({permission:shared ? groupPermissionDefault : null})}/>
              {!!room.permission && <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,padding:12}}>
                {permissionOptions.map(option => <Button key={option.value}
                  title={tr(({"read-only":"Read only","workspace-write":"Workspace","danger-full-access":"Full access"} as Record<string,string>)[option.value] || option.name || option.value)}
                  compact danger={option.value === "danger-full-access" && room.permission === option.value} secondary={room.permission !== option.value} disabled={locked}
                  onPress={() => void saveRoom({permission:option.value})}/>)}
              </View>}
            </Section>}
            <Section
              title={tr("Who responds")}
              footer={tr("@mentions always pick who answers.")}
            >
              {[
                {
                  id: "admin",
                  name: "Admin leads",
                  hint: "Plain messages go to the admin, who calls others with @Name.",
                },
                {
                  id: "everyone",
                  name: "Everyone",
                  hint: "Every member answers in turn, admin first.",
                },
              ].map((mode) => (
                <SettingRow
                  key={mode.id}
                  title={tr(mode.name)}
                  hint={tr(mode.hint)}
                  disabled={locked || (mode.id === "admin" && !room.admin)}
                  onPress={() => {
                    setRoom({ ...room, mode: mode.id });
                    void saveRoom({ mode: mode.id });
                  }}
                >
                  {(room.admin ? room.mode || "everyone" : "everyone") ===
                    mode.id && <Tag>{tr("Selected")}</Tag>}
                </SettingRow>
              ))}
            </Section>
            <Section
              title={`${tr("Members")}${roomId ? ` · ${room.members.length}` : ""}`}
              footer={tr(
                roomId
                  ? "A group needs at least two members."
                  : "Choose an admin and at least one other Bot.",
              )}
            >
              {team.bots
                .filter((b) => !roomId || room.members.includes(b.id))
                .map((item) => (
                  <SettingRow
                    key={item.id}
                    title={item.name}
                    hint={item.role}
                    leading={
                      <BotAvatar
                        bot={item}
                        size={32}
                        admin={room.admin === item.id}
                      />
                    }
                  >
                    {!room.members.includes(item.id) ? (
                      <Button
                        title={tr(room.admin ? "Add" : "Make admin")}
                        secondary
                        compact
                        disabled={locked}
                        onPress={() =>
                          setRoom({
                            ...room,
                            members: [...room.members, item.id],
                            admin: room.admin || item.id,
                          })
                        }
                      />
                    ) : (
                      <View style={{ gap: 4, alignItems: "flex-end" }}>
                        <Button
                          title={tr(
                            room.admin === item.id
                              ? "Unset admin"
                              : "Make admin",
                          )}
                          secondary
                          compact
                          disabled={locked}
                          onPress={() => {
                            const admin =
                              room.admin === item.id ? null : item.id;
                            const patch = {
                              admin,
                              ...(!admin ? { mode: "everyone" } : {}),
                            };
                            setRoom({ ...room, ...patch });
                            void saveRoom(patch);
                          }}
                        />
                        <Button
                          title={tr("Remove")}
                          secondary
                          danger
                          compact
                          disabled={
                            locked || (!!roomId && room.members.length <= 2)
                          }
                          onPress={() => {
                            const members = room.members.filter(
                              (id) => id !== item.id,
                            );
                            const patch = {
                              members,
                              ...(room.admin === item.id
                                ? { admin: null, mode: "everyone" }
                                : {}),
                            };
                            setRoom({ ...room, ...patch });
                            void saveRoom(patch);
                          }}
                        />
                      </View>
                    )}
                  </SettingRow>
                ))}
            </Section>
            {roomId && team.bots.some((b) => !room.members.includes(b.id)) && (
              <Section title={tr("Add members")}>
                {team.bots
                  .filter((b) => !room.members.includes(b.id))
                  .map((item) =>
                    rowBot(item, () => {
                      void saveRoom({ members: [...room.members, item.id] });
                    }),
                  )}
              </Section>
            )}
            {!roomId ? (
              <Button
                title={tr(busy ? "Creating…" : "Create group")}
                disabled={locked || room.members.length < 2 || !room.admin}
                onPress={async () => {
                  const created = await action<Room>("create-room", {
                    name: room.name.trim(),
                    members: room.members,
                    admin: room.admin,
                    greet: true,
                  });
                  if (created?.id) {
                    if (room.notice || room.mode !== "admin")
                      await action("update-room", {
                        id: created.id,
                        notice: room.notice || "",
                        mode: room.mode,
                      });
                    editRoom(created);
                  }
                }}
              />
            ) : (
              <>
                <Button
                  title={tr("Open chat")}
                  secondary
                  onPress={() => openConversation(roomId)}
                />
                <Section title={tr("Conversations")}>
                  <ToggleRow
                    title={tr("Pin")}
                    value={!!room.pinned}
                    disabled={locked}
                    onChange={(pinned) => flags(roomId, { pinned })}
                  />
                  <ToggleRow
                    title={tr("Hide")}
                    value={!!room.hidden}
                    disabled={locked}
                    onChange={(hidden) => flags(roomId, { hidden })}
                    last
                  />
                </Section>
                <Section title={tr("Actions")}>
                  <SettingRow
                    title={tr("Delete group chat")}
                    hint={tr(
                      "Chat history is archived. The Bots stay in your team.",
                    )}
                    danger
                    disabled={locked}
                    onPress={() =>
                      setConfirm({
                        text: tr(
                          "Delete this group chat? Its history will be archived. The Bots stay in your team.",
                        ),
                        run: async () => {
                          const result = await action("delete-room", {
                            id: roomId,
                          });
                          if (result !== undefined) {
                            setRoomId("");
                            setPage("list");
                          }
                        },
                      })
                    }
                    last
                  />
                </Section>
              </>
            )}
          </>
        )}
      </ScrollView>
      </PageTransition>
      <Sheet
        title={tr("Confirm")}
        visible={!!confirm}
        onClose={() => setConfirm(null)}
      >
        <Label>{confirm?.text}</Label>
        <Button
          title={tr("Delete")}
          danger
          disabled={locked}
          onPress={async () => {
            await confirm?.run();
            setConfirm(null);
          }}
        />
      </Sheet>
    </View>
  );
}
