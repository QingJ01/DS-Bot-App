import { AboutPanel } from "../host-settings/AboutPanel";
import { PluginUpdateCard } from "../host-settings/PluginUpdateCard";
import { CapabilitiesPanel } from "../host-settings/CapabilitiesPanel";
import { SkillsPanel } from "../host-settings/SkillsPanel";
import { PluginsPanel } from "../host-settings/PluginsPanel";
import { NotificationsPanel } from "../components/NotificationsPanel";
import { tr } from "../i18n";
import React, { useEffect, useState } from "react";
import { Platform, ScrollView, Switch, Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { Device, MobileClient } from "@ds-bot/mobile-sdk";
import {
  Button,
  Field,
  Icon,
  IconName,
  Label,
  Notice,
  PageHeader,
  Section,
  SettingRow,
  Sheet,
  Tag,
  styles,
} from "../components/UI";
import { inks } from "../components/BotAvatar";
import { SchedulesPanel, UsagePanel, WebhooksPanel } from "../features";
import { HostSettingsPanel } from "../host-settings/HostSettingsPanel";
import { Host, tokenStore } from "../storage";
import { errorText, TeamState } from "../types";
import { THEMES, useTheme } from "../theme";
import { PageTransition } from "../components/Motion";
import { LocalePreference, useI18n } from "../i18n";
export type SettingsPage =
  | "tools"
  | "capabilities"
  | "skills"
  | "plugins"
  | "notifications"
  | "index"
  | "general"
  | "mobile"
  | "schedules"
  | "webhooks"
  | "usage"
  | "connectors"
  | "secrets"
  | "feedback"
  | "about"
  | "updates"
  | "harness";
const pages: {
  id: SettingsPage | "bots" | "groups";
  title: string;
  icon: IconName;
}[] = [
  { id: "notifications", title: "Notifications", icon: "bell" },
  { id: "general", title: "General", icon: "settings" },
  { id: "bots", title: "Bots", icon: "bots" },
  { id: "groups", title: "Group chats", icon: "groups" },
  { id: "mobile", title: "Mobile devices", icon: "devices" },
  { id: "connectors", title: "Connectors", icon: "connectors" },
  { id: "schedules", title: "Scheduled tasks", icon: "schedules" },
  { id: "webhooks", title: "Webhooks", icon: "connectors" },
  { id: "usage", title: "Usage", icon: "usage" },
  { id: "secrets", title: "Secrets", icon: "secrets" },
  { id: "feedback", title: "Feedback", icon: "feedback" },
  { id: "about", title: "About DS Bot", icon: "feedback" },
  { id: "updates", title: "Plugin updates", icon: "download" },
  { id: "harness", title: "Harness settings", icon: "settings" },
];
export function SettingsScreen({
  client,
  host,
  team,
  disconnect,
  online,
  refresh,
  initialPage = "index",
  openTeam,
  openConversation,
  onOpenNavigation,
  onBack,
  classic = false,
  onClassicChange,
  onLocaleChange,
}: {
  client: MobileClient;
  host: Host;
  team: TeamState;
  disconnect: () => Promise<void>;
  online: boolean;
  refresh: () => Promise<void>;
  initialPage?: SettingsPage;
  openConversation?: (id: string) => void;
  openTeam?: (section: "bots" | "groups") => void;
  onOpenNavigation?: () => void;
  onBack?: () => void;
  classic?: boolean;
  onClassicChange?: (value: boolean) => void;
  onLocaleChange?: (value: LocalePreference) => void;
}) {
  const t = useTheme();
  const { tr, preference } = useI18n();
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [toolsChild,setToolsChild] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [customAccent, setCustomAccent] = useState("");
  const [confirm, setConfirm] = useState<{
    text: string;
    run: () => Promise<void>;
  } | null>(null);
  const locked = busy || !online || !!team.readOnly;
  async function loadDevices() {
    setError("");
    try {
      const [result, session] = await Promise.all([
        client.devices(),
        tokenStore.get(),
      ]);
      setDevices(result.devices.filter((d) => !d.revokedAt));
      setDeviceId(session?.deviceId || "");
    } catch (err) {
      setError(errorText(err));
    }
  }
  useEffect(() => {
    if (page === "mobile") void loadDevices();
  }, [client, page]);
  async function perform(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  function prefs(patch: Record<string, unknown>) {
    void perform(async () => {
      await client.action("set-prefs", patch);
      await refresh();
    });
  }
  function back() {
    setError("");
    setNotice("");
    if (toolsChild && ["skills","plugins","connectors","capabilities"].includes(page)) {setPage("tools");setToolsChild(false);}
    else if (page !== "index") setPage("index");
    else onBack?.();
  }
  return (
    <View style={{ flex: 1 }}>
      <PageHeader
        title={tr(
          page === "index"
            ? ""
            : ({tools:"Tools & skills",skills:"Skills",plugins:"Plugins",capabilities:"Capabilities"}[page as "tools"|"skills"|"plugins"|"capabilities"] || pages.find((p) => p.id === page)?.title || "Settings"),
        )}
        onBack={page !== "index" || onBack ? back : undefined}
        close
        floating
      />
      <PageTransition key={page}>
      <ScrollView
        key={page}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.page, {paddingTop:92}, page === "index" ? {paddingHorizontal:18,paddingTop:108,gap:32} : undefined]}
      >
        <Notice error text={error} />
        <Notice text={notice} />
        {page === "index" && (
          <>
            <View style={{backgroundColor:t.hover,borderRadius:22,overflow:"hidden"}}>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("Connected host")} onPress={() => setPage("mobile")} style={{flexDirection:"row",alignItems:"center",gap:14,minHeight:80,paddingHorizontal:20,paddingVertical:16}}>
                <View style={{width:46,height:46,borderRadius:23,backgroundColor:t.line,alignItems:"center",justifyContent:"center"}}><Text style={{fontSize:18,color:t.muted,fontWeight:"600"}}>DS</Text></View>
                <View style={{flex:1,gap:3}}><Text numberOfLines={1} style={{fontSize:21,color:t.ink}}>{host.name || "DS Bot"}</Text><Text numberOfLines={1} style={{fontSize:16,color:t.muted}}>{new URL(host.url).host}</Text></View><Icon name="chevron" color={t.muted}/>
              </Pressable>
              <SettingRow title={tr("Usage")} compact onPress={() => setPage("usage")} last/>
            </View>
            <View style={{backgroundColor:t.hover,borderRadius:22,overflow:"hidden"}}><SettingRow title={tr("Tools & skills")} hint={tr("DS Bot tools, skills and plugins")} onPress={() => setPage("tools")} last/></View>
            <Section title={tr("Bot")}>
              <SettingRow title={tr("Bots & groups")} onPress={() => openTeam?.("bots")}/>
              <SettingRow title={tr("Scheduled tasks")} onPress={() => setPage("schedules")}/>
              <SettingRow title={tr("Webhooks")} onPress={() => setPage("webhooks")}/>
              <SettingRow title={tr("Classic Agent mode")} hint={tr("Show DSH Agent conversations on the home screen.")}><Switch accessibilityLabel={tr("Classic Agent mode")} value={classic} disabled={locked} onValueChange={onClassicChange} trackColor={{false:t.lineStrong,true:t.ink}} thumbColor={t.bg}/></SettingRow>
              <SettingRow title={tr("Bot computer")} onPress={() => setPage("mobile")} last/>
            </Section>
            <Section title={tr("Preferences")}>
              <SettingRow title={tr("Notifications")} onPress={() => setPage("notifications")}/>
              <SettingRow title={tr("Appearance")} onPress={() => setPage("general")}/>
              <SettingRow title={tr("Language")} onPress={() => setPage("general")}/>
              <SettingRow title={tr("Plugin updates")} onPress={() => setPage("updates")}/>
              <SettingRow title={tr("About DS Bot")} onPress={() => setPage("about")} last/>
            </Section>
            <Section title={tr("Host")}>
              {pages.filter(item => ["connectors","secrets","feedback","harness"].includes(item.id)).map((item,index)=><SettingRow key={item.id} title={tr(item.title)} onPress={() => setPage(item.id as SettingsPage)} last={index===3}/>)}
            </Section>
            <Text style={{ textAlign: "center", fontSize: 12, color: t.faint }}>
              {tr("DS Bot · Mobile")}</Text>
          </>
        )}
        {page === "tools" && <Section title={tr("Tools & skills")}><SettingRow title={tr("Skills")} onPress={() => {setToolsChild(true);setPage("skills");}}/><SettingRow title={tr("Plugins")} onPress={() => {setToolsChild(true);setPage("plugins");}}/><SettingRow title={tr("Connectors")} onPress={() => {setToolsChild(true);setPage("connectors");}}/><SettingRow title={tr("Capabilities")} onPress={() => {setToolsChild(true);setPage("capabilities");}} last/></Section>}
        {page === "capabilities" && <CapabilitiesPanel client={client} team={team} online={online} refresh={refresh}/>}
        {page === "skills" && <SkillsPanel client={client} team={team} online={online} refresh={refresh}/>}
        {page === "plugins" && <PluginsPanel client={client} team={team} online={online} refresh={refresh}/>}
        {page === "notifications" && <NotificationsPanel serverId={host.serverId} client={client} online={online} open={openConversation} />}
        {page === "general" && (
          <>
            <Section
              title={tr("Appearance")}
              footer={tr(
                "The phone follows your system’s light or dark appearance.",
              )}
            >
              <SettingRow
                title={tr("Theme")}
                hint={tr("Colors for the whole team, on every device.")}
              />
              <View style={{ padding: 12, gap: 10 }}>
                {Object.entries(THEMES).map(([key, theme]) => (
                  <SettingRow
                    key={key}
                    title={tr(theme.name)}
                    onPress={() => prefs({ theme: key })}
                    disabled={locked}
                    last
                  >
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      {[
                        theme.light[0],
                        theme.light[2],
                        theme.light[5],
                        theme.light[7],
                      ].map((color, i) => (
                        <View
                          key={i}
                          style={{
                            width: 15,
                            height: 20,
                            borderRadius: 4,
                            backgroundColor: color,
                            borderWidth: 1,
                            borderColor: t.lineStrong,
                          }}
                        />
                      ))}
                    </View>
                    {(team.prefs?.theme || "deepseek") === key && (
                      <Tag>{tr("Selected")}</Tag>
                    )}
                  </SettingRow>
                ))}
              </View>
              <SettingRow
                title={tr("Accent")}
                hint={tr("Unread marks, badges, and the brand.")}
              />
              <View style={{ padding: 12, gap: 12 }}>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
                >
                  {[
                    null,
                    "deepseek",
                    "charcoal",
                    "graphite",
                    "rose",
                    "sky",
                    "tangerine",
                    "cobalt",
                  ].map((name) => {
                    const color = name ? inks[name][t.dark ? 1 : 0] : null;
                    const selected = color
                      ? team.prefs?.accent === color
                      : !team.prefs?.accent;
                    return (
                      <Pressable
                        key={name || "default"}
                        accessibilityRole="button"
                        accessibilityLabel={tr("Accent {p0}", { p0: String(name || tr("Default")) })}
                        accessibilityState={{ selected }}
                        disabled={locked}
                        onPress={() => prefs({ accent: color })}
                        style={{
                          width: 44,
                          height: 44,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 9,
                            backgroundColor: color || t.surface,
                            borderWidth: selected ? 3 : 1,
                            borderColor: selected ? t.ink : t.lineStrong,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {!name && (
                            <Text style={{ color: t.muted, fontSize: 20 }}>
                              ∕
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <Field
                  label={tr("Custom accent")}
                  placeholder="#3964FE"
                  autoCapitalize="none"
                  maxLength={7}
                  value={customAccent}
                  onChangeText={setCustomAccent}
                />
                <Button
                  title={tr("Apply accent")}
                  secondary
                  disabled={locked || !/^#[0-9a-f]{6}$/i.test(customAccent)}
                  onPress={() => prefs({ accent: customAccent })}
                />
              </View>
            </Section>
            <Section title={tr("Language")}>
              {(
                [
                  { value: "host", label: tr("Follow host") },
                  { value: "system", label: tr("Follow system") },
                  { value: "en", label: tr("English") },
                  { value: "zh", label: "简体中文" },
                ] as const
              ).map((item) => (
                <SettingRow
                  key={item.value}
                  title={tr(item.label)}
                  onPress={() => onLocaleChange?.(item.value)}
                  last
                >
                  {preference === item.value && <Tag>{tr("Selected")}</Tag>}
                </SettingRow>
              ))}
            </Section>
            <Section title={tr("Mode")}>
              <SettingRow
                title={tr("Classic Agent mode")}
                hint={tr(
                  "Show DSH Agent conversations on the home screen.",
                )}
                last
              >
                <Button
                  title={tr(classic ? "Bot team" : "Switch")}
                  secondary
                  compact
                  onPress={() => onClassicChange?.(!classic)}
                />
              </SettingRow>
            </Section>
          </>
        )}
        {page === "mobile" && (
          <>
            <Section title={tr("Host")}>
              <SettingRow title={host.name} hint={host.url}>
                <Tag>{tr(online ? "Connected" : "Offline")}</Tag>
              </SettingRow>
              <SettingRow
                title={tr("Keep your host running")}
                hint={tr(
                  "Work accepted by the host can continue while your phone is in the background.",
                )}
                last
              />
            </Section>
            <Section
              title={tr("Paired devices")}
              footer={tr(
                "To pair another device, generate a code in DSH → Settings → Mobile devices.",
              )}
            >
              {devices.map((device) => (
                <SettingRow
                  key={device.id}
                  title={
                    device.name || device.deviceName || tr("Paired device")
                  }
                  hint={device.id === deviceId ? tr("This device") : undefined}
                >
                  <Button
                    title={tr("Revoke access")}
                    danger
                    secondary
                    compact
                    disabled={locked}
                    onPress={() =>
                      setConfirm({
                        text: tr(
                          "Revoke {name}? Its connection will close immediately.",
                          {
                            name:
                              device.name ||
                              device.deviceName ||
                              tr("This device"),
                          },
                        ),
                        run: async () => {
                          await client.revokeDevice(device.id);
                          if (device.id === deviceId) await disconnect();
                          else await loadDevices();
                        },
                      })
                    }
                  />
                </SettingRow>
              ))}
              <SettingRow
                title={tr("Refresh devices")}
                onPress={loadDevices}
                disabled={!online || busy}
                last
              />
            </Section>
            <Section
              title={tr("On this device")}
              footer={tr(
                "History and drafts are stored separately for this server. Credentials use {storage}.",
                {
                  storage:
                    Platform.OS === "web"
                      ? tr("this browser tab’s memory")
                      : tr("the system secure store"),
                },
              )}
            >
              <SettingRow
                title={tr("Clear cached history and drafts")}
                disabled={busy}
                onPress={() =>
                  setConfirm({
                    text: tr(
                      "Clear cached messages and drafts on this device? Unresolved sends and their drafts are retained until the host confirms their outcome.",
                    ),
                    run: async () => {
                      await client.clearCachedData();
                      setNotice(
                        tr(
                          "Local cache cleared. Reopening a conversation downloads its history again.",
                        ),
                      );
                    },
                  })
                }
              />
              <SettingRow
                title={tr("Disconnect this device")}
                onPress={() =>
                  setConfirm({
                    text: tr(
                      "Remove the saved connection from this device? To invalidate its credentials on the host, use Revoke access instead.",
                    ),
                    run: disconnect,
                  })
                }
                disabled={busy}
                last
              />
            </Section>
            {Platform.OS === "web" && (
              <Notice
                text={tr(
                  "Development preview. Native camera, microphone, secure storage, and background behavior require iOS and Android device verification.",
                )}
              />
            )}
          </>
        )}
        {page === "about" && <AboutPanel client={client} team={team} online={online} refresh={refresh}/>}
        {page === "updates" && <PluginUpdateCard client={client} team={team} online={online} refresh={refresh}/>}
        {page === "schedules" && (
          <SchedulesPanel client={client} team={team} online={online} />
        )}
        {page === "webhooks" && (
          <WebhooksPanel client={client} team={team} online={online} />
        )}
        {page === "usage" && (
          <UsagePanel client={client} team={team} online={online} />
        )}
        {(
          ["connectors", "secrets", "feedback", "harness"] as SettingsPage[]
        ).includes(page) && (
          <HostSettingsPanel
            client={client}
            team={team}
            online={online}
            refresh={refresh}
            page={page as "connectors" | "secrets" | "feedback" | "harness"}
          />
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
          title={tr("Confirm")}
          disabled={busy}
          onPress={() =>
            perform(async () => {
              await confirm?.run();
              setConfirm(null);
            })
          }
        />
      </Sheet>
    </View>
  );
}
