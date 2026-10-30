import { Text, TextInput, setFontScale, useFontScale, FontScale } from "./components/Typography";
import { createMobileClient } from "./network/client";
import { useNotifications } from "./hooks/useNotifications";
import { stopBackgroundNotifications } from './media/background-notifications';
import { tr } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import {
  BackHandler, Platform, ScrollView, StatusBar, View } from "react-native";
import { AnimatedPressable as Pressable } from "./components/Motion";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Conversation, Message, MobileClient } from "@ds-bot/mobile-sdk";
import {
  Busy,
  Button,
  Icon,
  IconButton,
  Label,
  Notice,
  PageHeader,
  SettingRow,
  Sheet,
  Tag,
} from "./components/UI";
import { BotAvatar, mainLook, RoomAvatar } from "./components/BotAvatar";
import { LaunchIntro } from "./components/LaunchIntro";
import { MotionProvider, PageTransition } from "./components/Motion";
import { AgentDetails } from "./components/AgentDetails";
import { useWorkspace } from "./hooks/useWorkspace";
import { ChatScreen } from "./screens/ChatScreen";
import { PairingScreen } from "./screens/PairingScreen";
import { SettingsPage, SettingsScreen } from "./screens/SettingsScreen";
import { CreationScreen } from "./screens/CreationScreen";
import { TeamScreen } from "./screens/TeamScreen";
import {
  cache,
  clearCache,
  Host,
  readCache,
  tokenStore,
  writeCache,
} from "./storage";
import { setThemePreferences, useTheme } from "./theme";
import { errorText } from "./types";
import {
  LocalePreference,
  setHostLocale,
  setLocalePreference,
  useI18n,
} from "./i18n";
import { conversationTime, orderConversations } from "./logic/conversation-order";
import { groupWorkMembers, ownBotWork, waitingNames } from "./logic/group-work";

type Route =
  | {
      page: "home";
    }
  | {
      page: "chat";
    }
  | {
      page: "team";
      section: "bots" | "groups";
      id?: string;
      create?: "bot" | "group";
    }
  | {
      page: "settings";
      initial?: SettingsPage;
    }
  | {
      page: "agent";
    };
function Shell() {
  const t = useTheme();
  const fontScale = useFontScale();
  const { tr, locale } = useI18n();
  const [classic, setClassic] = useState(false);
  const [host, setHost] = useState<Host | null>(null);
  const [client, setClient] = useState<MobileClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [intro,setIntro] = useState(true);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<Route>({ page: "home" });
  const [selected, setSelected] = useState("");
  const [searching, setSearching] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [query, setQuery] = useState("");
  const homeList = useRef<ScrollView>(null);
  const rowPositions = useRef<Record<string,{y:number;height:number}>>({});
  const [homeScroll,setHomeScroll] = useState(0);
  const [previewState, setPreviewState] = useState<{serverId:string;items:Record<string,Message>} | null>(null);
  const previews = previewState?.serverId === host?.serverId ? previewState?.items || {} : {};
  const [creating, setCreating] = useState(false);
  const workspace = useWorkspace(client, host);
  useEffect(() => {
    let mounted = true;
    void Promise.all([readCache<Host>("app", "host"), tokenStore.get()])
      .then(([saved, session]) => {
        if (!mounted) return;
        if (saved && session?.serverId === saved.serverId) {
          if (saved.tlsPin !== session.tlsPin) throw new Error("The computer identity has changed. Pair this device again.");
          setHost(saved);
          setClient(
            createMobileClient({
              baseUrl: saved.url,
              tlsPin: session.tlsPin,
              tokenStore,
              cache,
              allowInsecure: __DEV__ && saved.allowInsecure,
            }),
          );
        }
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => () => client?.dispose(), [client]);
  useEffect(() => {
    setThemePreferences(workspace.team.prefs);
  }, [workspace.team.prefs]);
  async function readHostLanguage(connection: MobileClient) {
    const description = await connection.settings();
    const value = description.namespaces.find(
      (item) => item.ns === "locale",
    )?.value;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value.preference
      : undefined;
  }
  useEffect(() => {
    let alive = true;
    setClassic(false);
    setHostLocale(undefined);
    setLocalePreference("host");
    if (client && host) {
      void readCache<{
        classic?: boolean;
        locale?: LocalePreference;
        fontScale?: FontScale;
      }>(host.serverId, "mobile-preferences")
        .then((value) => {
          if (alive && value) {
            setClassic(!!value.classic);
            setLocalePreference(value.locale || "host");
            setFontScale(value.fontScale);
          }
        })
        .catch(() => {});
      void readHostLanguage(client)
        .then((value) => {
          if (alive) setHostLocale(value);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [client, host]);
  async function refreshSettings() {
    await workspace.refresh();
    if (client) {
      try {
        setHostLocale(await readHostLanguage(client));
      } catch {}
    }
  }
  async function localPreferences(patch: {
    classic?: boolean;
    locale?: LocalePreference;
    fontScale?: FontScale;
  }) {
    if (!host) return;
    const previous =
      (await readCache<{
        classic?: boolean;
        locale?: LocalePreference;
        fontScale?: FontScale;
      }>(host.serverId, "mobile-preferences")) || {};
    await writeCache(host.serverId, "mobile-preferences", {
      ...previous,
      ...patch,
    });
    if (patch.fontScale !== undefined) setFontScale(patch.fontScale);
    if (patch.classic !== undefined) {
      setClassic(patch.classic);
      setSelected("");
    }
    if (patch.locale) setLocalePreference(patch.locale);
  }
  async function connected(value: Host, connection: MobileClient) {
    await writeCache("app", "host", value);
    setHost(value);
    setClient(connection);
    setRoute({ page: "home" });
  }
  async function disconnect() {
    if (host) { await writeCache(host.serverId, 'backgroundOptIn', false); await writeCache(host.serverId, 'pushOptIn', false); }
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),3000);
    try { await Promise.allSettled([stopBackgroundNotifications(client || undefined), client?.action('notifications-preferences',{enabled:false,categories:[]},{signal:controller.signal})]); }
    finally { clearTimeout(timer); }
    if (client) await client.logout();
    else await tokenStore.clear();
    await clearCache("app");
    setClient(null);
    setHost(null);
    setSelected("");
    setRoute({ page: "home" });
    setThemePreferences({});
  }
  const notificationInbox = useNotifications(client, host?.serverId, workspace.online, choose, route.page === "chat" ? selected || undefined : undefined);
  function choose(id: string) {
    const found = workspace.conversations.find(
      (item) =>
        item.id === id || item.id === `bot:${id}` || item.id === `room:${id}`,
    );
    setSelected(found?.id || id);
    setNewChat(false);
    setRoute({ page: "chat" });
  }
  function navigate(value: Route) {
    setNewChat(false);
    setRoute(value);
  }
  const mainIds = workspace.team.mainBotIds?.length
    ? workspace.team.mainBotIds
    : workspace.team.mainBotId
      ? [workspace.team.mainBotId]
      : [];
  const chief = workspace.team.bots.find((bot) => bot.id === mainIds[0]);
  const conversation =
    workspace.conversations.find((item) => item.id === selected) ||
    (classic
      ? workspace.conversations.find((item) => item.kind === "agent")
      : workspace.conversations.find(
          (item) => item.sessionId === chief?.sessionId,
        ) || workspace.conversations[0]);
  function details(item = conversation) {
    if (!item) return;
    if (item.kind === "agent") {
      navigate({ page: "agent" });
      return;
    }
    const bot = workspace.team.bots.find(
      (bot) => bot.id === item.id || bot.sessionId === item.sessionId,
    );
    const room = workspace.team.rooms.find(
      (room) => room.id === item.id || `room:${room.id}` === item.id,
    );
    if (bot) navigate({ page: "team", section: "bots", id: bot.id });
    else if (room) navigate({ page: "team", section: "groups", id: room.id });
  }
  async function addAgent() {
    if (!client) return;
    setCreating(true);
    setError("");
    try {
      const result = await client.action<{
        id: string;
        sessions: string[];
      }>("add-agent", {});
      await workspace.refresh();
      if (result.sessions?.[0])
        choose(`agent:${result.id}:${result.sessions[0]}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }
  const showNavigation = () => { navigate({ page: "home" }); void workspace.refresh(); };
  useEffect(() => {
    if (route.page !== "chat") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {showNavigation();return true;});
    return () => sub.remove();
  }, [route.page]);
  const sorted = orderConversations(workspace.conversations
    .filter((c) => {
      if (classic && c.kind !== "agent") return false;
      const bot = workspace.team.bots.find(
        (b) => b.id === c.id || b.sessionId === c.sessionId,
      );
      const room = workspace.team.rooms.find((r) => r.id === c.id);
      const agent = workspace.team.agents?.find((a) => a.id === c.agentId);
      const isMain = !!bot && mainIds.includes(bot.id);
      const hidden = c.hidden || bot?.hidden || room?.hidden || agent?.hidden;
      return (
        (!hidden || c.id === conversation?.id || isMain) &&
        (!query ||
          `${c.name} ${c.role || ""}`
            .toLowerCase()
            .includes(query.toLowerCase()))
      );
    }), previews, (c) => {
      const item = workspace.team.bots.find(x => x.id === c.id || x.sessionId === c.sessionId)
        || workspace.team.rooms.find(x => x.id === c.id)
        || workspace.team.agents?.find(x => x.id === c.agentId);
      return !!(c.pinned || item?.pinned);
    });
  const conversationActivity = JSON.stringify(workspace.conversations.map(item => [item.id, item.sessionId, item.updatedAt]));
  useEffect(() => {
    if (route.page !== "home" || !host) return;
    let alive = true;
    const controller = new AbortController();
    void Promise.all(orderConversations(workspace.conversations, previews, () => false).slice(0,20).map(async item => {
      let messages = await cache.getMessages(host.serverId, item.id);
      if (workspace.online && client) {
        try { messages = (await client.messages(item.id,{limit:6,signal:controller.signal})).messages; }
        catch { /* Keep this host's cached preview when a read fails. */ }
      }
      const latest = [...messages].reverse().find(message => !message.pending && ['assistant','user'].includes(message.role) && (!!message.text || !!message.attachments?.length));
      return latest ? [item.id, latest] as const : null;
    })).then(rows => {
      if (!alive) return;
      const liveIds = new Set(workspace.conversations.map(item => item.id));
      setPreviewState(previous => {
        const retained = previous?.serverId === host.serverId ? previous.items : {};
        return { serverId: host.serverId, items: {
          ...Object.fromEntries(Object.entries(retained).filter(([id]) => liveIds.has(id))),
          ...Object.fromEntries(rows.filter(row => row !== null)),
        } };
      });
    }).catch(() => {});
    return () => { alive = false; controller.abort(); };
  }, [route.page, host, client, workspace.online, conversationActivity, notificationInbox?.cursor]);
  function unread(item:Conversation) {
    return !!notificationInbox?.items.some(event => !event.read && (event.conversationId === item.id || item.id === `bot:${event.conversationId}` || item.id === `room:${event.conversationId}`));
  }
  const unreadAbove = sorted.filter(item => unread(item) && rowPositions.current[item.id] && rowPositions.current[item.id].y + rowPositions.current[item.id].height < homeScroll + 110);
  useEffect(() => {if (route.page === "home") setHomeScroll(0);},[route.page]);
  function conversationRow(item: Conversation) {
    const bot = workspace.team.bots.find(
      (b) => b.id === item.id || b.sessionId === item.sessionId,
    );
    const room = workspace.team.rooms.find((r) => r.id === item.id);
    const main = !!bot && mainIds.includes(bot.id);
    const active = item.id === conversation?.id;
    const lastActivity = conversationTime(item, previews[item.id]);
    const needsApproval = workspace.team.work?.approvals.some(entry => bot ? entry.botId === bot.id && !entry.roomId : room ? entry.roomId === room.id : false);
    const preview = previews[item.id];
    const messagePreview = preview?.text.replace(/\s+/g, " ").trim() || (preview?.attachments?.length ? tr("Attachment message") : "") || (typeof item.preview === "string" ? item.preview : "");
    const work = bot ? ownBotWork(bot.id, workspace.team) : room ? groupWorkMembers(room, workspace.team).find(member => member.work)?.work : undefined;
    const names = waitingNames(work);
    const status = names.length ? tr("Waiting for {p0}", { p0: names.join(locale === "zh" ? "、" : ", ") }) : work?.switching ? tr("Moving to a fresh conversation") : work ? tr("Working") : "";
    const subtitle = needsApproval ? tr("Waiting for approval") : item.waiting ? tr("Waiting for your answer") : status || messagePreview;
      return (
      <Pressable
        key={item.id}
        onLayout={event => {rowPositions.current[item.id]=event.nativeEvent.layout;}}
        accessibilityRole="button"
        accessibilityLabel={tr("Open {p0}", { p0: String(item.name) })}
        accessibilityState={{ selected: active }}
        onPress={() => choose(item.id)}
        onLongPress={() => {
          setSelected(item.id);
          details(item);
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 8,
          paddingVertical: 14,
          minHeight: 72,
          borderRadius: 22,
          backgroundColor: pressed ? t.hover : undefined,
        })}
      >
        {bot ? (
          <BotAvatar bot={bot} size={44} main={main} live={!!item.waiting} animate={false} />
        ) : room ? (
          <RoomAvatar room={room} team={workspace.team} size={44} />
        ) : (
          <View style={{ width: 44, alignItems: "center" }}>
            <Icon name="bots" color={t.muted} />
          </View>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            numberOfLines={1}
            style={{
              color: t.ink,
              fontWeight: "600",
              fontSize: 17,
            }}
          >
            {item.name || tr("New conversation")}
          </Text>
          {!!subtitle && <Text numberOfLines={1} style={{fontSize:14,lineHeight:20,color:t.muted}}>{subtitle}</Text>}
        </View>
        <View style={{alignItems:"flex-end",alignSelf:"stretch",justifyContent:"space-between",paddingVertical:4,gap:10}}>
          {!!lastActivity && <Text style={{fontSize:14,color:t.muted}}>{new Date(lastActivity).toLocaleDateString() === new Date().toLocaleDateString()
            ? new Date(lastActivity).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US",{hour:"2-digit",minute:"2-digit"})
            : new Date(lastActivity).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US",{month:"short",day:"numeric"})}</Text>}
          {notificationInbox?.items.some(event => !event.read && (event.conversationId === item.id || item.id === `bot:${event.conversationId}` || item.id === `room:${event.conversationId}`))
            ? <View accessibilityLabel={tr("Unread")} style={{width:11,height:11,borderRadius:6,backgroundColor:t.accent}}/>
            : (item.pinned || bot?.pinned || room?.pinned) ? <Icon name="pin" size={14} color={t.muted}/> : null}
        </View>
      </Pressable>
    );
  }
  return (
    <SafeAreaView edges={route.page === "chat" ? ["top", "left", "right"] : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar barStyle={t.dark ? "light-content" : "dark-content"} />
      <View
        accessibilityElementsHidden={intro}
        importantForAccessibility={intro ? "no-hide-descendants" : "auto"}
        style={{
          flex: 1,
          opacity: intro ? 0 : 1,
          width: "100%",
          maxWidth: 860,
          alignSelf: "center",
          borderLeftWidth: Platform.OS === "web" ? 1 : 0,
          borderRightWidth: Platform.OS === "web" ? 1 : 0,
          borderColor: t.line,
        }}
      >
        <PageTransition key={`${route.page}:${route.page === "chat" ? selected : route.page === "team" ? `${route.section}:${route.id || ""}:${route.create || ""}` : ""}`}>
        {loading ? (
          <Busy text={tr("Opening your workspace…")} />
        ) : !client || !host ? (
          <>
            <Notice error text={error} />
            <PairingScreen onConnected={connected} />
          </>
        ) : route.page === "home" ? (
          <View style={{flex:1}}>
            <View pointerEvents="box-none" style={{position:"absolute",top:0,left:0,right:0,zIndex:2,flexDirection:"row",alignItems:"center",paddingHorizontal:20,paddingTop:16,paddingBottom:12,gap:10}}>
              <IconButton name="settings" floating label={tr("Open settings")} onPress={() => navigate({page:"settings"})}/>
              <View style={{flex:1}}/>
              <IconButton name="search" floating label={tr("Search conversations")} onPress={() => {setSearching(!searching);setQuery("");}}/>
              <IconButton name="plus" floating label={tr("New chat")} onPress={() => setNewChat(true)}/>
            </View>
            {searching && <View style={{marginHorizontal:20,marginTop:90,marginBottom:12,borderRadius:25,backgroundColor:t.hover,paddingHorizontal:18}}><TextInput accessibilityLabel={tr("Search conversations")} placeholder={tr("Search conversations")} placeholderTextColor={t.faint} value={query} onChangeText={setQuery} style={{color:t.ink,fontSize:17,minHeight:48}}/></View>}
            <Notice error text={workspace.error || error}/>
            {!searching && homeScroll > 120 && unreadAbove.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel={tr("{count} unread",{count:unreadAbove.length})} onPress={() => {const first=unreadAbove[0];homeList.current?.scrollTo({y:Math.max(0,rowPositions.current[first.id].y-110),animated:true});}} style={{position:"absolute",top:88,alignSelf:"center",zIndex:3,backgroundColor:t.accent,borderRadius:24,paddingHorizontal:14,minHeight:44,flexDirection:"row",alignItems:"center",gap:6}}><Icon name="up" size={18} color={t.accentText}/><Text style={{fontSize:18,fontWeight:"600",color:t.accentText}}>{tr("{count} unread",{count:unreadAbove.length})}</Text></Pressable>}
            <ScrollView ref={homeList} onScroll={event => setHomeScroll(event.nativeEvent.contentOffset.y)} scrollEventThrottle={80} contentContainerStyle={{paddingHorizontal:16,paddingTop:searching ? 0 : 80,paddingBottom:24}} keyboardShouldPersistTaps="handled">
              {sorted.map(conversationRow)}
              {!sorted.length && <View style={{padding:24,gap:16}}><Label muted>{tr("No conversations found.")}</Label>{classic ? <Button title={tr("New DSH Agent")} disabled={creating || !workspace.online} onPress={addAgent}/> : <Button secondary title={tr("Reconnect")} onPress={workspace.refresh}/>}</View>}
            </ScrollView>
          </View>
        ) : route.page === "chat" ? (
          conversation ? (
            <ChatScreen
              key={`${host.serverId}:${conversation.id}`}
              client={client}
              host={host}
              conversation={conversation}
              conversations={workspace.conversations}
              select={choose}
              team={workspace.team}
              refresh={workspace.refresh}
              online={workspace.online}
              transcription={workspace.transcription}
              onOpenNavigation={showNavigation}
              onOpenDetails={() => details()}
            />
          ) : (
            <>
              <PageHeader title={tr("DS Bot")} onOpenNavigation={showNavigation} />
              <View
                style={{
                  flex: 1,
                  justifyContent: "center",
                  alignItems: "center",
                  padding: 24,
                  gap: 18,
                }}
              >
                <BotAvatar bot={mainLook} size={64} />
                <Label large>
                  {tr(
                    classic
                      ? "No Agent conversations yet"
                      : "Your team is getting ready",
                  )}
                </Label>
                <Notice error text={workspace.error || error} />
                {classic ? (
                  <Button
                    title={tr("New DSH Agent")}
                    onPress={addAgent}
                    disabled={creating || !workspace.online}
                  />
                ) : (
                  <Button title={tr("Reconnect")} onPress={workspace.refresh} />
                )}
              </View>
            </>
          )
        ) : route.page === "team" && route.create ? (
          <CreationScreen key={route.create} kind={route.create} client={client} team={workspace.team} online={workspace.online} refresh={workspace.refresh} openConversation={choose} onClose={showNavigation}/>
        ) : route.page === "team" ? (
          <TeamScreen
            key={`${route.section}:${route.id || ""}:${route.create || ""}`}
            client={client}
            team={workspace.team}
            refresh={workspace.refresh}
            openConversation={choose}
            online={workspace.online}
            onCreate={(kind) => navigate({page:"team",section:kind === "bot" ? "bots" : "groups",create:kind})}
            initialSection={route.section}
            initialId={route.id}
            create={route.create}
            onBack={showNavigation}
          />
        ) : route.page === "agent" ? (
          <AgentDetails
            key={conversation?.id}
            client={client}
            team={workspace.team}
            conversations={workspace.conversations}
            conversation={conversation}
            online={workspace.online}
            refresh={workspace.refresh}
            openConversation={choose}
            onBack={showNavigation}
          />
        ) : (
          <SettingsScreen
            key={route.initial || "index"}
            client={client}
            host={host}
            team={workspace.team}
            disconnect={disconnect}
            online={workspace.online}
            refresh={refreshSettings}
            initialPage={route.initial}
            openConversation={choose}
            openTeam={(section) => navigate({ page: "team", section })}
            onBack={showNavigation}
            classic={classic}
            onClassicChange={(value) => {
              void localPreferences({ classic: value }).catch((err) =>
                setError(errorText(err)),
              );
            }}
            onLocaleChange={(value) => {
              void localPreferences({ locale: value }).catch((err) =>
                setError(errorText(err)),
              );
            }}
            fontScale={fontScale}
            onFontScaleChange={(value) => {
              void localPreferences({ fontScale: value }).catch((err) =>
                setError(errorText(err)),
              );
            }}
          />
        )}
      </PageTransition>
      </View>
      {intro && <LaunchIntro onComplete={() => setIntro(false)}/>}
      <Sheet title={tr("New chat")} visible={newChat && !!client} onClose={() => setNewChat(false)}>
        <SettingRow title={tr("New Bot")} leading={<Icon name="bots"/>} onPress={() => navigate({page:"team",section:"bots",create:"bot"})}/>
        <SettingRow title={tr("New group chat")} leading={<Icon name="groups"/>} disabled={workspace.team.bots.length<2} onPress={() => navigate({page:"team",section:"groups",create:"group"})}/>
        <SettingRow title={tr(creating ? "Creating Agent…" : "New DSH Agent")} leading={<Icon name="plus"/>} disabled={creating || !workspace.online} onPress={addAgent} last/>
      </Sheet>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <MotionProvider><Shell /></MotionProvider>
    </SafeAreaProvider>
  );
}
