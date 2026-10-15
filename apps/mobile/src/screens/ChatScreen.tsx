import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dateLocale } from "../i18n";
import { DesktopBrowser } from "../components/DesktopBrowser";
import { tr } from "../i18n";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { AnimatedPressable as Pressable } from "../components/Motion";
import * as Speech from "expo-speech";
import {
  Attachment,
  Conversation,
  Message,
  MobileClient,
} from "@ds-bot/mobile-sdk";
import {
  Button,
  Card,
  Field,
  Label,
  Notice,
  Sheet,
  styles,
  IconButton,
  Icon,
} from "../components/UI";
import { MediaComposer } from "../components/MediaComposer";
import { MessageBubble } from "../components/MessageBubble";
import { QuestionCard } from "../components/QuestionCard";
import { useReadingPosition } from "../hooks/useReadingPosition";
import { hasNewTail } from "../logic/reading-position";
import { useConversation } from "../hooks/useConversation";
import { Host } from "../storage";
import { errorText, TeamState } from "../types";
import { useTheme } from "../theme";
import { BotAvatar, RoomAvatar } from "../components/BotAvatar";
import { GroupProgress } from "../components/GroupProgress";
import { ConversationExport } from "../components/ConversationExport";
import { VoiceMode } from "../components/VoiceMode";
import { HistorySearchPanel, ConversationPartsPanel } from "../features/HistoryPanels";
import { ApprovalCards } from "../components/ApprovalCards";
import { SkillsPanel } from "../host-settings/SkillsPanel";
import { SecretRequestCards } from "../host-settings/SecretsPanel";
import { MentionMenu } from "../components/MentionMenu";
import { ReferencePicker, ReferenceChat } from "../components/ReferencePicker";
import { combineTurnReasoning } from "../logic/reasoning";
import { ThinkingLevelPicker } from "../components/ThinkingLevelPicker";
import { composeReferenceDraft, mentionCandidates, mentionQuery, referenceDraft, sessionMention } from "../logic/composer";

function messageDate(message?: Message) {
  const value = message?.createdAt;
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())
    || (typeof value === "number" && (!Number.isFinite(value) || value <= 0))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day = date.toDateString();
  if (day === today.toDateString()) return tr("Today");
  if (day === yesterday.toDateString()) return tr("Yesterday");
  return date.toLocaleDateString(dateLocale(), { month: "short", day: "numeric", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}) });
}

export function ChatScreen({
  client,
  host,
  conversation,
  conversations,
  select,
  team,
  refresh,
  online,
  transcription,
  onOpenNavigation,
  onOpenDetails,
}: {
  client: MobileClient;
  host: Host;
  conversation: Conversation;
  conversations: Conversation[];
  select: (id: string) => void;
  team: TeamState;
  refresh: () => Promise<void>;
  online: boolean;
  transcription: boolean;
  onOpenNavigation?: () => void;
  onOpenDetails?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const chat = useConversation(client, host, conversation.id);
  const [previousSends, setPreviousSends] = useState(false);
  const [search, setSearch] = useState(false);
  const [parts, setParts] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [voice, setVoice] = useState(false);
  const [skills, setSkills] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [context, setContext] = useState<Message[] | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextCursor, setContextCursor] = useState<string | null>(null);
  const [contextSession, setContextSession] = useState("");
  const [contextError, setContextError] = useState("");
  const contextGeneration = useRef(0);
  const [removeQueue, setRemoveQueue] = useState<string | null>(null);
  useEffect(
    () => () => {
      Speech.stop();
      contextGeneration.current++;
    },
    [],
  );
  const [options, setOptions] = useState(false);
  const [picker, setPicker] = useState(false);
  const [models, setModels] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelBusy, setModelBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [referencePicker, setReferencePicker] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [dockHeight, setDockHeight] = useState(88);
  const [inputHeight, setInputHeight] = useState(44);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [dismissedMention, setDismissedMention] = useState("");
  const reading = useReadingPosition(`${host.serverId}:${conversation.id}`, chat.hydrated, chat.messages);
  const { list, bottom } = reading;
  const input = useRef<TextInput>(null);
  const displayMessages = useMemo(() => combineTurnReasoning(chat.messages), [chat.messages]);
  const listMessages = useMemo(() => [...displayMessages].reverse(), [displayMessages]);
  const composer = useMemo(() => referenceDraft(chat.draft), [chat.draft]);
  useEffect(() => {
    const hide = Keyboard.addListener("keyboardDidHide", () => { setComposerFocused(false); setKeyboardVisible(false); });
    const show = Keyboard.addListener("keyboardDidShow", () => { setKeyboardVisible(true); if(input.current?.isFocused()) setComposerFocused(true); });
    return () => { hide.remove(); show.remove(); };
  }, []);
  const [newMessages, setNewMessages] = useState(false);
  const lastTail = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!bottom.current && hasNewTail(lastTail.current, displayMessages.map(item => item.id))) setNewMessages(true);
    lastTail.current = displayMessages.at(-1)?.id;
  }, [displayMessages]);
  const bot = team.bots.find(
    (item) =>
      item.sessionId === conversation.sessionId ||
      item.id === conversation.id ||
      `bot:${item.id}` === conversation.id,
  );
  const room = team.rooms.find(item => item.id === conversation.id || `room:${item.id}` === conversation.id);
  const questionOwners = new Set([conversation.id, bot?.id, room?.id]);
  const questions = Object.entries(team.questions ?? {})
    .filter(([sessionId, question]) => question.conversationId
      ? questionOwners.has(question.conversationId)
      : (question.sessionId ?? sessionId) === conversation.sessionId)
    .map(([sessionId, question]) => ({ question, sessionId: question.sessionId ?? sessionId }));
  const writable = online && !team.readOnly && chat.status !== "unauthorized";
  const mention = (bot || room) && composerFocused && writable && !chat.pending && !chat.busy ? mentionQuery(composer.text, selection) : null;
  const mentionKey = `${chat.draft}:${selection.start}`;
  const mentionRows = mention && dismissedMention !== mentionKey ? mentionCandidates(team.bots, bot?.id, room, mention.query, tr("Everyone")) : [];
  function setComposerText(text: string) { chat.setDraft(composeReferenceDraft(text, composer.references)); }
  function pickMention(name: string) {
    if (!mention) return;
    const insert = `@${name} `;
    setComposerText(composer.text.slice(0, mention.start) + insert + composer.text.slice(mention.end));
    const position = mention.start + insert.length;
    setSelection({ start: position, end: position });
    requestAnimationFrame(() => {input.current?.focus();input.current?.setNativeProps({selection:{start:position,end:position}});});
  }
  function pickReference(chatReference: ReferenceChat) {
    setReferencePicker(false);
    if (composer.references.some(ref => ref.sessionId === chatReference.sessionId)) return;
    if (composer.references.length >= 3) { chat.setError(tr("Use up to three chat references.")); return; }
    chat.setError("");
    chat.setDraft(composeReferenceDraft(composer.text, [...composer.references, {sessionId:chatReference.sessionId,label:chatReference.label,mention:sessionMention(chatReference.sessionId,chatReference.label)}]));
  }
  function authorBot(message: Message) {
    const id = typeof message.author === "object" ? message.author?.id : undefined;
    const name = typeof message.author === "string" ? message.author : message.author?.name;
    return team.bots.find(value => value.id === id || value.sessionId === id || (name && value.name === name)) || bot;
  }
  function reply(text: string) {
    if (chat.pending || chat.busy) return;
    const excerpt = text.replace(/\s+/g, " ").trim();
    chat.setDraft(`${chat.draft}${chat.draft ? "\n\n" : ""}> ${excerpt.length > 200 ? `${excerpt.slice(0, 200)}…` : excerpt}\n\n`);
    input.current?.focus();
  }
  async function openContext(message: Message) {
    const generation = ++contextGeneration.current;
    setSearch(false);
    setContext([message]);
    setContextSession(message.sessionId);
    setContextCursor(null);
    setContextError("");
    setContextBusy(true);
    try {
      const page = await client.action<{ messages: Message[]; cursor: string | null }>("context", { conversationId: conversation.id, sessionId: message.sessionId, seq: message.seq, limit: 30 });
      if (generation !== contextGeneration.current) return;
      setContext(page.messages);
      setContextCursor(page.cursor);
    } catch (err) { if (generation === contextGeneration.current) setContextError(errorText(err)); }
    finally { if (generation === contextGeneration.current) setContextBusy(false); }
  }
  async function openPart(sessionId: string) {
    const generation = ++contextGeneration.current;
    setParts(false);
    setContext([]);
    setContextSession(sessionId);
    setContextCursor(null);
    setContextError("");
    setContextBusy(true);
    try {
      const view = await client.action<{ parts: { sessionId: string; cursor: string }[] }>("parts", { conversationId: conversation.id });
      const part = view.parts.find(item => item.sessionId === sessionId);
      if (!part) throw new Error("This conversation part is no longer available.");
      const page = await client.messages(conversation.id, { cursor: part.cursor, limit: 60 });
      if (generation !== contextGeneration.current) return;
      setContext(page.messages);
      setContextCursor(page.cursor);
    } catch (err) { if (generation === contextGeneration.current) setContextError(errorText(err)); }
    finally { if (generation === contextGeneration.current) setContextBusy(false); }
  }
  async function earlierContext() {
    if (!contextCursor || contextBusy) return;
    const generation = contextGeneration.current;
    setContextBusy(true);
    try {
      const page = await client.messages(conversation.id, { cursor: contextCursor });
      if (generation !== contextGeneration.current) return;
      const samePart = page.messages.filter(message => message.sessionId === contextSession);
      setContext(previous => [...samePart.filter(message => !previous?.some(item => item.id === message.id)), ...(previous || [])]);
      setContextCursor(page.sessionId === contextSession ? page.cursor : null);
    } catch (err) { if (generation === contextGeneration.current) setContextError(errorText(err)); }
    finally { if (generation === contextGeneration.current) setContextBusy(false); }
  }
  async function chooseModel(model: string) {
    if (!bot || modelBusy || !writable) return;
    setModelBusy(true);
    try {
      await client.action("update-bot", { id: bot.id, model, effort: null });
      await refresh();
      setModels(false);
    } catch (err) {
      chat.setError(errorText(err));
    } finally {
      setModelBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "web" ? undefined : "padding"}
      keyboardVerticalOffset={insets.top}
    >
      <View style={{ flex: 1 }}>
      <View pointerEvents="none" style={{position:"absolute",top:0,left:0,right:0,height:82,backgroundColor:t.bg,zIndex:9}} />
      <View pointerEvents="box-none" style={{ position: "absolute", top: 16, left: 20, right: 20, zIndex: 10 }}>
        <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", minHeight: 50, gap: 10 }}>
          <IconButton name="back" floating label={tr("Back to conversations")} onPress={onOpenNavigation || (() => setPicker(true))} />
          <View pointerEvents="box-none" style={{ flex: 1, alignItems: "flex-start" }}>
            <Pressable accessibilityRole="button" accessibilityLabel={tr("Open ") + conversation.name + tr(" details")} onPress={onOpenDetails || (() => setPicker(true))} style={{ minHeight: 48, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 28, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface }}>
              {room ? <RoomAvatar room={room} team={team} size={30} /> : <BotAvatar bot={bot || { id: conversation.id, name: conversation.name }} size={30} />}
              <Text numberOfLines={1} style={{ color: t.ink, fontSize: 18, fontWeight: "600", flexShrink: 1 }}>{conversation.name}</Text>
            </Pressable>
          </View>
          <IconButton name="more" floating label={tr("Conversation options")} onPress={() => setOptions(true)} />
        </View>
      </View>
      {!reading.ready && <View pointerEvents="none" style={{position:"absolute",top:90,left:0,right:0,alignItems:"center"}}><Label muted>{tr("Loading…")}</Label></View>}
      <FlatList
        ref={list}
        testID="message-list"
        style={{ flex: 1, opacity: reading.ready ? 1 : 0 }}
        CellRendererComponent={reading.Cell}
        inverted
        data={listMessages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 82,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
        onLayout={reading.onLayout}
        scrollIndicatorInsets={{ top: 76, bottom: dockHeight }}
        onScrollBeginDrag={reading.onScrollBeginDrag}
        onTouchMove={reading.onScrollBeginDrag}
        {...(Platform.OS === "web" ? { onWheel: reading.onScrollBeginDrag } : {})}
        onScroll={event => {
          reading.onScroll(event);
          if (bottom.current) setNewMessages(false);
        }}
        scrollEventThrottle={32}
        onContentSizeChange={reading.onContentSizeChange}
        ListFooterComponent={
          <View style={{ gap: 8 }}>
          {chat.status === "unauthorized" ? <Notice error text={tr("This device no longer has access. Open Settings, disconnect, then pair again.")} /> : !online ? <Notice text={tr("Host offline. Cached messages and drafts are available. Keep your computer awake, then reconnect to send.")} /> : chat.status !== "connected" ? <Text style={{ color: t.muted, fontSize: 11, textAlign: "center" }}>{tr("Reconnecting…")}</Text> : null}
          {team.readOnly ? <Notice text={team.readOnly} /> : null}
          {chat.cursor ? (
            <Button
              title={chat.busy ? tr("Loading…") : tr("Load earlier messages")}
              secondary
              disabled={chat.busy || !online}
              onPress={chat.older}
            />
          ) : null}
          </View>
        }
        ListEmptyComponent={chat.hydrated ?
          <View style={{ flex: 1, justifyContent: "flex-end", paddingVertical: 22, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              {room && <RoomAvatar room={room} team={team} size={24} />}
              <View style={{ flex: 1, backgroundColor: t.bubble, borderRadius: 18, paddingVertical: 9, paddingHorizontal: 12 }}>
                <Text style={{ color: t.ink, fontSize: 14, lineHeight: 22 }}>{bot?.waiting ? tr("Hi, I'm ") + bot.name + tr(". Pick a model for me first. You can change it later in my details.") : room ? tr("Message the group, or @mention a Bot to bring it into the conversation.") : tr("Message ") + conversation.name + tr(" to get started.")}</Text>
              </View>
            </View>
            {bot?.waiting ? <View style={{ marginLeft: 32, gap: 8 }}>
              {Array.from(new Set(team.models.map(model => model.providerName || "Models"))).map(provider => <View key={provider} style={{ gap: 5 }}>
                <Text style={{ color: t.muted, fontSize: 12 }}>{provider}</Text>
                <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>{team.models.filter(model => (model.providerName || "Models") === provider).map(model => <Button key={model.ref} compact secondary title={model.name} disabled={!writable || modelBusy} onPress={() => void chooseModel(model.ref)} />)}</View>
              </View>)}
              {!team.models.length ? <Notice text={tr("Add a model provider in Harness settings, then refresh.")} /> : null}
            </View> : null}
          </View> : null
        }
        renderItem={({ item, index }) => {
          if(item.role==="assistant" && !item.text && !item.reasoning && !item.attachments?.length && !item.pending)return null;
          const previous = listMessages[index + 1];
          const date = messageDate(item);
          const before = messageDate(previous);
          const changedDay = date && (!before || date.toDateString() !== before.toDateString());
          const changedPart = previous && item.sessionId && previous.sessionId && item.sessionId !== previous.sessionId;
          return <View>
            {changedPart ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 }}>
              <View style={{ height: 1, flex: 1, backgroundColor: t.line }} />
              <Text style={{ color: t.muted, fontSize: 12 }}>{tr("New conversation part")}</Text>
              <View style={{ height: 1, flex: 1, backgroundColor: t.line }} />
            </View> : null}
            {changedDay ? <Text style={{ color: t.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginVertical: 12 }}>{dayLabel(date)}</Text> : null}
            <MessageBubble
            message={item}
            client={client}
            conversationId={conversation.id}
            serverId={host.serverId}
            bot={authorBot(item)}
            showAuthor={!!room}
            bots={team.bots}
            onReply={writable && !chat.pending ? reply : undefined}
            onOpenBot={id => { const target = conversations.find(value => value.id === id || value.id === `bot:${id}`); if (target) select(target.id); }}
            />
          </View>;
        }}
        ListHeaderComponent={
          <View style={{ paddingBottom: dockHeight + 12 }}>
            <ApprovalCards client={client} conversationId={conversation.id} online={online} messages={chat.messages} />
            {bot ? <SecretRequestCards botId={bot.id} client={client} team={team} online={writable} refresh={refresh} /> : null}
            {chat.queue.map((item) => (
              <Card key={item.id}>
                <Label muted>
                  {tr("Queued ·")}{" "}
                  {item.target === "next-step" ? tr("next step") : tr("next turn")}
                </Label>
                <Label>{item.text || tr("Attachment message")}</Label>
                <Button
                  secondary
                  title={tr("Remove queued message")}
                  disabled={!online}
                  onPress={() => setRemoveQueue(item.id)}
                />
              </Card>
            ))}
            {questions.map(({ question, sessionId }) => (
              <QuestionCard
                key={`${sessionId}:${question.id}`}
                question={question}
                sessionId={sessionId}
                client={client}
                refresh={refresh}
                disabled={!writable}
              />
            ))}
          </View>
        }
      />
      <View pointerEvents="box-none"
        onLayout={event => { const height = Math.ceil(event.nativeEvent.layout.height); setDockHeight(previous => Math.abs(previous - height) > 1 ? height : previous); }}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10 }}>
      {room && <GroupProgress client={client} room={room} team={team} running={chat.running} online={online && chat.status === "connected"} />}
      {newMessages && (
        <View pointerEvents="box-none" style={{alignItems:"center",paddingVertical:4}}><Button
          floating
          title={tr("↓ New messages")}
          secondary
          compact
          onPress={() => {
            bottom.current = true;
            list.current?.scrollToOffset({ offset: 0, animated: true });
            setNewMessages(false);
          }}
        /></View>
      )}
      <View
        pointerEvents="box-none"
        style={{
          paddingHorizontal: 20,
          paddingTop: 6,
          paddingBottom: keyboardVisible ? 8 : insets.bottom + 8,
          gap: 9,
        }}
      >
        <Notice capsule error text={chat.error} />
        <MentionMenu rows={mentionRows} pick={pickMention} close={() => setDismissedMention(mentionKey)} />
        {!!composer.references.length && <View pointerEvents="box-none" style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{composer.references.map(ref=><View key={ref.sessionId} style={{flexDirection:"row",alignItems:"center",backgroundColor:t.surface,borderColor:t.line,borderWidth:1,borderRadius:999,paddingLeft:14,gap:8}}>
          <Icon name="chat" size={16}/><Text numberOfLines={1} style={{color:t.ink,fontSize:13,maxWidth:180}}>{ref.label}</Text><IconButton name="close" size={44} label={tr("Remove reference {name}",{name:ref.label})} disabled={!!chat.pending || chat.busy} onPress={()=>chat.setDraft(composeReferenceDraft(composer.text,composer.references.filter(item=>item.sessionId!==ref.sessionId)))}/>
        </View>)}</View>}
        {bot?.waiting && <Notice capsule text={tr("This Bot is waiting for your answer. Open its latest message and answer the question.")} />}
        {chat.receipt && (
          <View style={{alignSelf:"flex-start",borderRadius:999,backgroundColor:t.surface,paddingHorizontal:16,paddingVertical:8}}><Text style={{ color: t.muted, fontSize: 11 }}>{tr(chat.receipt)}</Text></View>
        )}
        <MediaComposer
          client={client}
          conversationId={conversation.id}
          attachments={attachments}
          setAttachments={setAttachments}
          onTranscript={(text) => {
            setComposerText(composer.text ? `${composer.text}\n${text}` : text);
          }}
          onReferenceChat={() => setReferencePicker(true)}
          disabled={
            !writable ||
            chat.status === "unauthorized" ||
            chat.busy ||
            !!chat.pending
          }
          transcription={transcription}
          onVoiceChat={() => setVoice(true)}
          voiceChatDisabled={!!chat.draft.trim() || !!attachments.length || chat.running || !!bot?.waiting || chat.status !== "connected"}
        >
          <TextInput
            ref={input}
            accessibilityLabel={tr("Message")}
            multiline
            maxLength={Math.max(0,100000-(chat.draft.length-composer.text.length))}
            placeholder={tr("Ask {p0}", { p0: String(conversation.name) })}
            value={composer.text}
            editable={!chat.pending && !chat.busy}
            onChangeText={setComposerText}
            onSelectionChange={event => setSelection(event.nativeEvent.selection)}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onContentSizeChange={event => {
              const height = Math.max(44, Math.min(150, Math.ceil(event.nativeEvent.contentSize.height)));
              setInputHeight(previous => Math.abs(previous - height) > 1 ? height : previous);
            }}
            scrollEnabled={inputHeight >= 150}
            underlineColorAndroid="transparent"
            placeholderTextColor={t.muted}
            style={{
              flex: 1,
              color: t.ink,
              backgroundColor: "transparent",
              borderColor: t.line,
              borderWidth: 0,
              textAlignVertical: "top",
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 17,
              lineHeight: 24,
              includeFontPadding: false,
              minHeight: 44,
              maxHeight: 150,
              // Wrapped placeholders must not make an empty composer grow.
              height: composer.text.length === 0 ? 44 : undefined,
            }}
          />
          <IconButton primary brand size={44}
            name="send"
            label={chat.pending ? tr("Retry") : tr("Send")}
            disabled={
              chat.previousDevice ||
              !writable ||
              chat.status === "unauthorized" ||
              chat.busy ||
              (!chat.pending && !chat.draft.trim() && !attachments.length) ||
              !!bot?.waiting
            }
            onPress={async () => {
              if (await chat.send(attachments, attachments[0]?.sessionId)) {
                setAttachments([]);
                bottom.current = true;
              }
            }}
          />

        </MediaComposer>
        {(chat.previousDevice || !!chat.archived.length) && (
          <Button
            secondary
            title={tr("Review previous pairing sends")}
            onPress={() => setPreviousSends(true)}
          />
        )}
        {chat.pending && (
          <Notice capsule
            text={
              chat.previousDevice
                ? tr("This unconfirmed send belongs to a previous pairing and cannot be retried. Review it on your host before starting a new message.")
                : tr("A previous send needs confirmation. Retry checks its original receipt before sending again.")
            }
          />
        )}
        {chat.rejected && (
          <Button
            secondary
            title={tr("Keep draft and prepare again")}
            onPress={chat.recompose}
          />
        )}

      </View>
      </View>
      {voice ? <VoiceMode client={client} conversation={conversation} bot={bot} room={room} team={team} messages={chat.messages} running={chat.running} enabled={writable && chat.status === "connected" && !bot?.waiting} onSend={text => !writable || chat.pending || chat.busy || attachments.length ? Promise.resolve(null) : chat.sendVoice(text)} onStop={chat.cancel} onClose={() => setVoice(false)} /> : null}
      <Sheet title={tr("Conversation options")} visible={options} onClose={() => setOptions(false)}>
        {chat.running && <Button secondary title={tr("Stop")} disabled={!writable || chat.busy} onPress={() => {setOptions(false);void chat.cancel();}}/>}
        {!transcription && <Notice text={tr("Voice input is unavailable. Enable and prepare speech recognition in Harness settings.")}/>}
        <Button secondary title={tr("Search conversation")} onPress={() => {setOptions(false);setSearch(true);}}/>
        <Button secondary title={tr("Conversation history")} onPress={() => {setOptions(false);setParts(true);}}/>
        <Button secondary title={tr("Skills")} disabled={!online || !!chat.pending || chat.busy} onPress={() => {setOptions(false);setSkills(true);}}/>
        {!!bot && <Button secondary title={tr("Desktop browser")} disabled={!online} onPress={() => {setOptions(false);setBrowser(true);}}/>}
        {!!bot && <Button secondary title={tr("Choose a model")} disabled={!writable} onPress={() => {setOptions(false);setModels(true);}}/>}
      </Sheet>
      <Sheet title={tr("Desktop browser")} visible={browser} onClose={() => setBrowser(false)}>{bot && <DesktopBrowser client={client} botId={bot.id} online={online} />}</Sheet>
      <Sheet title={tr("Skills")} visible={skills} onClose={() => setSkills(false)}><SkillsPanel client={client} team={team} online={online} refresh={refresh} conversationId={conversation.id} onChoose={name => { chat.setDraft(`/${name}${chat.draft ? " " + chat.draft : " "}`); setSkills(false); input.current?.focus(); }} /></Sheet>
      <Sheet
        title={tr("Previous pairing sends")}
        visible={previousSends}
        onClose={() => setPreviousSends(false)}
      >
        <Label muted>
          {tr("These sends were created under a different device credential. Check the conversation on your computer to determine whether they ran. This app will not replay them.")}</Label>
        {[
          ...chat.archived,
          ...(chat.previousDevice && chat.pending ? [chat.pending] : []),
        ].map((item) => (
          <Card key={item.requestId}>
            <Label>{item.text || tr("Attachment message")}</Label>
            <Text selectable style={{ color: t.muted, fontSize: 12 }}>
              {tr("Request:")}{item.requestId}
            </Text>
          </Card>
        ))}
        {chat.previousDevice && (
          <Button
            title={tr("Archive and start an empty draft")}
            onPress={async () => {
              try {
                await chat.archivePrevious();
                setPreviousSends(false);
              } catch (error) {
                chat.setError(errorText(error));
              }
            }}
          />
        )}
      </Sheet>
      <Sheet title={exporting ? tr("Export conversation") : context !== null ? tr("Conversation part") : parts ? tr("Conversation history") : tr("Search conversation")} visible={search || parts || exporting || context !== null} onClose={() => {
        contextGeneration.current++; setSearch(false); setParts(false); setExporting(false); setContext(null);
      }}>
        {exporting ? <ConversationExport client={client} conversation={conversation} online={online} /> : search ? <HistorySearchPanel client={client} conversation={conversation} online={online} onSelectMessage={message => void openContext(message)} /> : parts ? <><Button title={tr("Export conversation")} secondary disabled={!online} onPress={() => { setParts(false); setExporting(true); }} /><ConversationPartsPanel client={client} conversation={conversation} online={online} onSelectPart={sessionId => void openPart(sessionId)} /></> : <>
          <Notice error text={contextError} />
          {contextBusy ? <Label muted>{tr("Loading conversation…")}</Label> : null}
          {contextCursor ? <Button title={tr("Load earlier in this part")} secondary disabled={contextBusy || !online} onPress={() => void earlierContext()} /> : null}
          {context?.map(message => <MessageBubble key={message.id} message={message} client={client} conversationId={conversation.id} serverId={host.serverId} bot={authorBot(message)} bots={team.bots} showAuthor={!!room} onReply={writable && !chat.pending ? text => { contextGeneration.current++; setContext(null); reply(text); } : undefined} />)}
          {!contextBusy && !contextError && !context?.length ? <Label muted>{tr("No messages in this part.")}</Label> : null}
        </>}
      </Sheet>
      <Sheet
        title={tr("Remove queued message")}
        visible={!!removeQueue}
        onClose={() => setRemoveQueue(null)}
      >
        <Label>
          {tr("Remove this waiting message from the host's queue? This does not cancel the current reply.")}</Label>
        <Button
          danger
          title={tr("Remove from queue")}
          onPress={async () => {
            if (removeQueue) await chat.removeQueued(removeQueue);
            setRemoveQueue(null);
          }}
        />
      </Sheet>
      <Sheet
        title={tr("Conversations")}
        visible={picker}
        onClose={() => setPicker(false)}
      >
        {conversations.filter(item => !item.hidden || item.id === conversation.id).map((item) => (
          <Button
            secondary={item.id !== conversation.id}
            key={item.id}
            title={`${item.kind === "room" ? "○ " : ""}${item.name}`}
            onPress={() => {
              setPicker(false);
              select(item.id);
            }}
          />
        ))}
      </Sheet>
      <Sheet
        title={tr("Choose a model")}
        visible={models}
        onClose={() => setModels(false)}
      >
        <Label muted>
          {tr("Models are configured on your host. This changes the selected Bot's model on all devices.")}</Label>
        <Field label={tr("Search models")} value={modelQuery} onChangeText={setModelQuery} autoCorrect={false} />
        {bot && <ThinkingLevelPicker client={client} model={team.models.find(model=>model.ref===bot.model)} value={bot.effort} disabled={!writable || modelBusy} choose={async effort=>{await client.action("update-bot",{id:bot.id,effort});await refresh();}}/>}
        {team.models.filter(model => [model.name, model.providerName, model.ref].join(" ").toLowerCase().includes(modelQuery.toLowerCase())).map((model) => (
          <Button
            secondary={bot?.model !== model.ref}
            key={model.ref}
            title={`${model.name} · ${model.providerName || model.ref}`}
            disabled={!writable || modelBusy}
            onPress={() => chooseModel(model.ref)}
          />
        ))}
        {!team.models.length && (
          <Notice text={tr("Add a model provider in DSH on your computer, then refresh the team.")} />
        )}
      </Sheet>
      <ReferencePicker client={client} conversationId={conversation.id} bots={team.bots} visible={referencePicker} online={writable && !chat.pending && !chat.busy} pick={pickReference} close={() => setReferencePicker(false)}/>
      </View>
    </KeyboardAvoidingView>
  );
}
