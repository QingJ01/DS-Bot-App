import { Text } from "../components/Typography";
import React, { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { MobileClient } from "@ds-bot/mobile-sdk";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { Button, Icon, Label, Notice, Section } from "../components/UI";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import { Bot, Capability, TeamState, errorText } from "../types";
import { capabilityStatus } from "../logic/capabilities";


export function BotCapabilities({ client, bot, team, online, refresh }: {
  client: MobileClient; bot: Bot; team: TeamState; online: boolean; refresh: () => Promise<void>;
}) {
  const t = useTheme(), { tr } = useI18n();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const working = useRef(false);
  const locked = busy || !online || !!team.readOnly;
  async function toggle(item: Capability) {
    if (working.current || locked) return;
    working.current = true; setBusy(true); setError("");
    try {
      await client.action("bot-capability", { botId: bot.id, name: item.name, attached: !(bot.capabilities || []).includes(item.name) });
      await refresh();
    } catch (cause) { setError(tr("Could not update capabilities.") + " " + errorText(cause)); }
    finally { working.current = false; setBusy(false); }
  }
  if (!team.capabilities) return <Notice text={tr("Update your host plugin to manage capabilities.")} />;
  return <View style={{ gap: 12 }}>
    <Notice error text={error} />
    {!team.capabilities.length && <Label muted>{tr("No capabilities yet. Add them in DS Bot settings on your computer.")}</Label>}
    {team.capabilities.map(item => {
      const attached = (bot.capabilities || []).includes(item.name);
      const status = attached ? capabilityStatus(item, team.capabilityStatuses?.[bot.id] || {}) : undefined;
      const state = status?.state || (attached && item.kind === "mcp" && item.approved === false ? "needs-approval" : undefined);
      const stateText = state ? tr({ ready: "Ready", connecting: "Connecting…", "needs-approval": "Needs approval", error: "Could not connect" }[state]) : "";
      return <View key={item.name} style={{ borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, borderRadius: 18, overflow: "hidden" }}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={tr("Use capability {name}", { name: item.name })}
          accessibilityState={{ checked: attached, disabled: locked }} disabled={locked} onPress={() => void toggle(item)}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 64, opacity: locked ? .55 : 1 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>{item.name}</Text>
            <Text style={{ fontSize: 13, color: t.muted }}>{tr(item.kind === "mcp" ? "MCP server" : item.kind === "skill" ? "Skill" : "Pack")}{stateText ? " · " + stateText : ""}</Text>
            {!!item.description && <Text style={{ fontSize: 13, color: t.muted }}>{item.description}</Text>}
            {!!status?.error && <Text style={{ fontSize: 12, color: t.error }}>{status.error}</Text>}
            {state === "needs-approval" && <Text style={{ fontSize: 12, color: t.muted }}>{tr("Approve this MCP command on your computer.")}</Text>}
          </View>
          <Icon name={attached ? "check" : "plus"} size={20} color={attached ? t.accent : t.muted} />
        </Pressable>
      </View>;
    })}
  </View>;
}

export function CapabilitiesPanel({ client, team, online, refresh }: {
  client: MobileClient; team: TeamState; online: boolean; refresh: () => Promise<void>;
}) {
  const { tr } = useI18n();
  const [selected, setSelected] = useState(team.mainBotId || team.bots[0]?.id || "");
  const bot = team.bots.find(item => item.id === selected) || team.bots[0];
  return <Section title={tr("Capabilities")} footer={tr("Configure MCP servers, skills and packs on your computer. Choose what each Bot can use here.")}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
      {team.bots.map(item => <Button key={item.id} title={item.name} compact secondary={item.id !== bot?.id} onPress={() => setSelected(item.id)} />)}
    </ScrollView>
    {bot ? <BotCapabilities key={bot.id} client={client} bot={bot} team={team} online={online} refresh={refresh} /> : <Label muted>{tr("No Bots found.")}</Label>}
  </Section>;
}
