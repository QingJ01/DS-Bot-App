import { Text } from "./Typography";
import { systemEventLabel } from "../logic/system-events";
import { ToolResultView } from "./ToolResultView";
import { tr } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Keyboard, Platform, Share, View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import * as Clipboard from "expo-clipboard";
import * as Speech from "expo-speech";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Attachment, Message, MobileClient } from "@ds-bot/mobile-sdk";
import { Button, Icon, Notice, Sheet } from "./UI";
import { MarkdownText } from "./MarkdownText";
import { BotAvatar } from "./BotAvatar";
import { MessageActions, MessageAction, REACTIONS } from "./MessageActions";
import { useTheme } from "../theme";
import { Bot, errorText } from "../types";
import { readCache, writeCache } from "../storage";

import { hideQuestionReceipt, toolLabel } from "../logic/tool-results";
import { FileAttachment } from "./FileAttachment";

const fileName = (value: string) => value.replace(/[^\w. -]/g, "_").slice(0, 120) || "attachment";
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This image could not be loaded."));
    reader.readAsDataURL(blob);
  });
}
async function saveFile(name: string, body: string, mediaType: string, base64 = false) {
  if (Platform.OS === "web") {
    const blob = base64 ? await (await fetch(body)).blob() : new Blob([body], { type: mediaType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(name);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const file = new File(Paths.cache, Date.now() + "-" + fileName(name));
  if (base64) file.write(body.split(",", 2)[1], { encoding: "base64" });
  else file.write(body);
  try { await Sharing.shareAsync(file.uri, { mimeType: mediaType }); }
  finally { if (file.exists) file.delete(); }
}
function ImageAttachment({ attachment, message, client, conversationId }: {
  attachment: Attachment; message: Message; client: MobileClient; conversationId: string;
}) {
  const t = useTheme();
  const [uri, setUri] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    setUri("");
    if (!attachment.id) return;
    void client.attachment(conversationId, message.sessionId, attachment.id).then(dataUrl).then(value => {
      if (active) setUri(value);
    }).catch(err => { if (active) setError(errorText(err)); });
    return () => { active = false; };
  }, [client, conversationId, message.sessionId, attachment.id, retry]);
  return <View style={{ gap: 6 }}>
    {uri ? <Pressable accessibilityRole="button" accessibilityLabel={tr("Open ") + attachment.name} onPress={() => setOpen(true)}>
      <Image accessibilityLabel={attachment.name} source={{ uri }} resizeMode="contain" style={{ width: "100%", height: 190, minWidth: 190, borderRadius: 10 }} />
    </Pressable> : error ? <Button secondary compact title={tr("Retry image: ") + attachment.name} onPress={() => setRetry(value => value + 1)} /> : <View style={{ height: 90, minWidth: 190, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={t.accent} /></View>}
    <Text style={{ color: t.muted, fontSize: 11 }}>{attachment.name}</Text>
    {error ? <Notice error text={error} /> : null}
    <Sheet title={attachment.name} visible={open} onClose={() => setOpen(false)}>
      {uri ? <Image accessibilityLabel={attachment.name} source={{ uri }} resizeMode="contain" style={{ width: "100%", height: 380 }} /> : null}
      <Button title={tr("Download image")} onPress={async () => {
        try { await saveFile(attachment.name, uri, attachment.mediaType || "image/png", true); }
        catch (err) { setError(errorText(err)); }
      }} />
    </Sheet>
  </View>;
}

export function MessageBubble({ message, client, conversationId, serverId, bot, bots, showAuthor = false, onReply, onOpenBot }: {
  message: Message;
  client: MobileClient;
  conversationId: string;
  serverId?: string;
  bot?: Bot;
  bots?: Bot[];
  showAuthor?: boolean;
  onReply?: (text: string) => void;
  onOpenBot?: (id: string) => void;
}) {
  const t = useTheme();
  const mine = message.role === "user";
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [reactions, setReactions] = useState<string[]>([]);
  const writes = useRef(Promise.resolve());
  const reading = useRef(false);
  const systemTask = useRef<null | (() => Promise<unknown>)>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {clearTimeout(dismissTimer.current);systemTask.current=null;if(reading.current) void Speech.stop();}, []);
  useEffect(() => {if(!copied)return;const timer=setTimeout(()=>setCopied(false),2000);return()=>clearTimeout(timer);},[copied]);
  function openActions(){Keyboard.dismiss();setError("");setCopied(false);setMenu(true);}
  function runSystemAction(){
    clearTimeout(dismissTimer.current);
    const action=systemTask.current;systemTask.current=null;
    if(action) void action().catch(err=>setError(errorText(err)));
  }
  function systemAction(action:()=>Promise<unknown>){
    systemTask.current=action;
    setMenu(false);
    // iOS delivers onDismiss; Android needs to wait out its fade animation.
    if(Platform.OS!=="ios") dismissTimer.current=setTimeout(runSystemAction,300);
  }
  const author = mine ? tr("You") : typeof message.author === "string" ? message.author : typeof message.author?.name === "string" ? message.author.name : bot?.name || tr("Bot");
  const hasText=!!message.text.trim();
  const actions:MessageAction[]=[
    ...(onReply?[{label:tr("Reply"),icon:"reply" as const,disabled:!hasText,onPress:()=>{setMenu(false);onReply(message.text);}}]:[]),
    {label:tr("Copy"),icon:"copy",disabled:!hasText,onPress:()=>{void Clipboard.setStringAsync(message.text).then(()=>{setMenu(false);setCopied(true);}).catch(err=>setError(errorText(err)));}},
    {label:tr("Share"),icon:"share",disabled:!hasText,onPress:()=>{void systemAction(()=>Share.share({message:message.text}));}},
    {label:tr("Download"),icon:"download",disabled:!hasText,onPress:()=>{void systemAction(()=>saveFile(author+"-message.md",message.text,"text/markdown"));}},
    ...(!mine?[{label:tr(speaking?"Stop reading":"Read aloud"),icon:"speaker" as const,disabled:!hasText,onPress:()=>{setMenu(false);void Speech.stop().then(()=>{if(speaking){reading.current=false;setSpeaking(false);return;}reading.current=true;setSpeaking(true);Speech.speak(message.text,{onDone:()=>{reading.current=false;setSpeaking(false);},onStopped:()=>{reading.current=false;setSpeaking(false);},onError:()=>{reading.current=false;setSpeaking(false);setError("Text-to-speech is unavailable on this device.");}});}).catch(err=>setError(errorText(err)));}}]:[]),
  ];
  useEffect(() => {
    let active = true;
    if (serverId) void readCache<string[]>(serverId, "reactions:" + message.id).then(value => {
      if (active) setReactions(Array.isArray(value) ? value.filter(item => REACTIONS.includes(item)) : []);
    }).catch(() => {});
    return () => { active = false; };
  }, [serverId, message.id]);
  function react(emoji: string) {
    const next = reactions.includes(emoji) ? reactions.filter(value => value !== emoji) : [...reactions, emoji];
    setReactions(next);
    setMenu(false);
    if (serverId) {
      writes.current = writes.current.catch(() => {}).then(() => writeCache(serverId, "reactions:" + message.id, next));
      void writes.current.catch(err => setError(errorText(err)));
    }
  }
  const tool = message.tool;
  if (message.role === "tool" && tool) {
    if (hideQuestionReceipt(tool)) return null;
    const label = tr(toolLabel(tool));
    const failed = tool.state === "error" || tool.isError;
    return <View style={{ marginVertical: 6, alignSelf: "flex-start", maxWidth: "94%" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label + tr(" details")} accessibilityState={{ expanded }} onPress={() => setExpanded(true)} style={({pressed}) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: failed ? t.error : t.line, backgroundColor: pressed ? t.hover : t.surface })}>
        {tool.state === "running" ? <ActivityIndicator size="small" color={t.muted} /> : <Icon name={failed ? "close" : "check"} size={16} color={failed ? t.error : t.muted}/>}
        <Text numberOfLines={1} style={{ color: t.ink, fontSize: 14, flexShrink: 1 }}>{label}</Text>
        <Text style={{color:failed ? t.error : t.muted,fontSize:12}}>{tr(failed ? "Failed" : tool.state === "running" ? "Running" : "Completed")}</Text>
        <Icon name="chevron" size={16} color={t.muted}/>
      </Pressable>
      <Sheet title={label} visible={expanded} onClose={() => setExpanded(false)}><ToolResultView tool={tool} /></Sheet>
    </View>;
  }
  if (message.role === "system") return <Text selectable style={{ color: t.muted, fontSize: 12, lineHeight: 19, textAlign: "center", marginVertical: 12 }}>{systemEventLabel(message.systemEvent, tr) || message.text}</Text>;
  return <View style={{ alignSelf: mine ? "flex-end" : "stretch", width: "100%", maxWidth: "100%", marginVertical: 10, gap: 4 }}>
    {showAuthor && !mine && bot ? <Pressable disabled={!onOpenBot} onPress={() => onOpenBot?.(bot.id)} accessibilityRole="button" accessibilityLabel={tr("Open ") + author + tr("'s chat")} style={{flexDirection:"row",alignItems:"center",gap:8,minHeight:44,alignSelf:"flex-start"}}><BotAvatar bot={bot} size={28}/><Text style={{color:t.muted,fontSize:13}}>{author}</Text></Pressable> : showAuthor && !mine && message.author ? <Text style={{color:t.muted,fontSize:13}}>{author}</Text> : null}
    {message.reasoning ? <View style={{ marginLeft: 0, gap: 5 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr("Thinking details")} accessibilityState={{ expanded: thinking }} onPress={() => setThinking(!thinking)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: t.muted, fontSize: 13 }}>{thinking ? "⌃" : "⌄"} {message.pending ? tr("Thinking…") : tr("Thought process")}</Text></Pressable>
      {thinking ? <View style={{ borderLeftWidth: 2, borderColor: t.line, paddingLeft: 10 }}><Text selectable style={{ color: t.muted, fontSize: 13, lineHeight: 20 }}>{message.reasoning}</Text></View> : null}
    </View> : null}
    {!!message.text || !!message.attachments?.length || (message.pending && !message.reasoning) ? <View style={{ flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-end", gap: 8, justifyContent: "flex-start" }}>
      <Pressable accessible={false} onLongPress={() => !message.pending && openActions()} delayLongPress={350} style={{ maxWidth: mine ? "90%" : "88%", flexShrink: 1, backgroundColor: mine ? t.messageBubble : t.bubble, borderRadius: 26, paddingHorizontal: 18, paddingVertical: 13, gap: 10 }}>
        {!!message.text ? <MarkdownText onLongPress={!message.pending ? () => openActions() : undefined} fontSize={18} text={message.text} bots={bots} selfId={mine ? undefined : bot?.id} color={mine ? t.messageText : t.ink} onLink={url => {
          if (!url.startsWith("https://bots.local/")) return false;
          try { const id = decodeURIComponent(url.slice("https://bots.local/".length)); if (bots?.some(item => item.id === id)) onOpenBot?.(id); } catch {}
          return true;
        }} /> : message.pending && !message.reasoning ? <Text style={{ color: t.muted, fontSize: 13 }}>{tr("Thinking…")}</Text> : null}
        {message.attachments?.map((attachment, index) => attachment.type === "image" ? <ImageAttachment key={attachment.id || index} attachment={attachment} message={message} client={client} conversationId={conversationId} /> : <FileAttachment key={attachment.id || index} attachment={attachment} message={message} client={client} conversationId={conversationId} color={mine ? t.messageText : undefined} />)}
      </Pressable>

    </View> : null}
    {message.interrupted ? <Text style={{ color: t.muted, fontSize: 12, marginLeft: 0 }}>{tr("Stopped")}</Text> : null}
    {!!reactions.length ? <View style={{ flexDirection: "row", gap: 4, justifyContent: mine ? "flex-end" : "flex-start" }}>
      {reactions.map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={tr("Remove reaction ") + emoji} onPress={() => react(emoji)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: t.bubble }}><Text>{emoji}</Text></Pressable>)}
    </View> : null}
    <Notice error text={error} />
    {copied && <Text accessibilityLiveRegion="polite" style={{color:t.muted,fontSize:12,textAlign:mine?"right":"left"}}>{tr("Copied")}</Text>}
    {speaking && <Pressable accessibilityRole="button" accessibilityLabel={tr("Stop reading")} onPress={()=>{reading.current=false;void Speech.stop();setSpeaking(false);}} style={{flexDirection:"row",alignItems:"center",gap:6,minHeight:36,alignSelf:"flex-start"}}><Icon name="stop" size={14} color={t.muted}/><Text style={{color:t.muted,fontSize:12}}>{tr("Stop reading")}</Text></Pressable>}
    <MessageActions visible={menu} author={author} preview={message.text} reactions={reactions} allowReactions={!mine} actions={actions} onReact={react} onClose={()=>setMenu(false)} onDismiss={runSystemAction} error={error}/>

  </View>;
}
