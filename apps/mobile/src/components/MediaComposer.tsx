import { Text } from "./Typography";
import { tr } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { Keyboard, Modal, Platform, View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Speech from "expo-speech";
import * as DocumentPicker from "expo-document-picker";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import type { Attachment, MobileClient } from "@ds-bot/mobile-sdk";
import { Button, Icon, IconButton, Label, Notice, Sheet, styles } from "./UI";
import { errorText } from "../types";
import { useTheme } from "../theme";
const MAX_UPLOAD = 20 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
async function fileBody(uri: string): Promise<ArrayBuffer> {
  return Platform.OS === "web"
    ? (await fetch(uri)).arrayBuffer()
    : new File(uri).arrayBuffer();
}
export function MediaComposer({
  client,
  conversationId,
  attachments,
  setAttachments,
  onTranscript,
  disabled,
  transcription,
  onVoiceChat,
  onReferenceChat,
  voiceChatDisabled = false,
  children,
}: {
  client: MobileClient;
  conversationId: string;
  attachments: Attachment[];
  setAttachments: (value: Attachment[]) => void;
  onTranscript: (text: string) => void;
  disabled: boolean;
  transcription: boolean;
  onVoiceChat?: () => void;
  onReferenceChat?: () => void;
  voiceChatDisabled?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const nextMenuAction = useRef<(() => void) | null>(null);
  const menuTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(menuTimer.current); nextMenuAction.current = null; }, []);
  function afterMenuDismiss() {
    clearTimeout(menuTimer.current);
    const action = nextMenuAction.current;
    nextMenuAction.current = null;
    action?.();
  }
  function referenceChat() {
    nextMenuAction.current = onReferenceChat || null;
    setOpen(false);
    if (Platform.OS !== "ios") menuTimer.current = setTimeout(afterMenuDismiss, 300);
  }
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const [voice, setVoice] = useState(false);
  const finishing = useRef(false);
  useEffect(() => {
    if (state.isRecording && state.durationMillis >= 60_000)
      void finishRecording();
  }, [state.durationMillis, state.isRecording]);
  function removeRecording(uri: string | null) {
    if (!uri) return;
    try {
      if (Platform.OS === "web") URL.revokeObjectURL(uri);
      else {
        const file = new File(uri);
        if (file.exists) file.delete();
      }
    } catch {
      /* Cache cleanup may race OS cache eviction. */
    }
  }
  useEffect(
    () => () => {
      void (async () => {
        try {
          if (recorder.isRecording) await recorder.stop();
          await setAudioModeAsync({ allowsRecording: false });
          removeRecording(recorder.uri);
        } catch {
          /* Recorder may already be released by the native lifecycle. */
        }
      })();
    },
    [recorder],
  );
  async function upload(
    uri: string,
    name: string,
    mediaType: string,
    size?: number,
  ) {
    setError("");
    setBusy("Uploading attachment…");
    try {
      if (attachments.length >= 8)
        throw new Error("Send up to eight attachments at a time.");
      if (IMAGE_TYPES.includes(mediaType) && size && size > 10 * 1024 * 1024)
        throw new Error("Choose an image smaller than 10 MiB.");
      if (size && size > MAX_UPLOAD)
        throw new Error("Choose a file smaller than 20 MiB.");
      const target = await client.target(conversationId);
      const body = await fileBody(uri);
      if (IMAGE_TYPES.includes(mediaType) && body.byteLength > 10 * 1024 * 1024)
        throw new Error("Choose an image smaller than 10 MiB.");
      if (body.byteLength > MAX_UPLOAD)
        throw new Error("Choose a file smaller than 20 MiB.");
      const receipt = await client.upload({
        conversationId,
        sessionId: target.sessionId,
        name,
        mediaType,
        body,
      });
      setAttachments([
        ...attachments,
        { ...receipt, sessionId: target.sessionId },
      ]);
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }
  async function image(camera: boolean) {
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Allow photo access in device settings, or choose a file instead.",
        );
      const result = camera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.85,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.85,
          });
      if (!result.canceled) {
        const item = result.assets[0];
        if (item.mimeType && !IMAGE_TYPES.includes(item.mimeType)) {
          const converted = await ImageManipulator.manipulateAsync(item.uri, [], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
          try { await upload(converted.uri, (item.fileName || "photo").replace(/\.[^.]+$/, "") + ".jpg", "image/jpeg"); }
          finally { if (Platform.OS !== "web") { const file = new File(converted.uri); if (file.exists) file.delete(); } }
          return;
        }
        await upload(
          item.uri,
          item.fileName || "photo.jpg",
          item.mimeType || "image/jpeg",
          item.fileSize,
        );
      }
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function document() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: "*/*",
      });
      if (!result.canceled) {
        const item = result.assets[0];
        await upload(
          item.uri,
          item.name,
          item.name.toLowerCase().endsWith(".md")
            ? "text/markdown"
            : item.mimeType || "application/octet-stream",
          item.size,
        );
      }
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function startRecording() {
    setError("");
    await Speech.stop();
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted)
        throw new Error("Enable microphone access to record a voice message.");
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setVoice(true);
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function finishRecording() {
    if ((!recorder.isRecording && !voice) || finishing.current) return;
    finishing.current = true;
    setBusy("Transcribing on your host…");
    try {
      if (recorder.isRecording) await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (!recorder.uri) throw new Error("The recording could not be saved.");
      const body = await fileBody(recorder.uri);
      if (body.byteLength > 10 * 1024 * 1024)
        throw new Error("Record a shorter message, up to 10 MiB.");
      const text = await client.transcribe({
        name: Platform.OS === "web" ? "recording.webm" : "recording.m4a",
        mediaType: Platform.OS === "web" ? "audio/webm" : "audio/mp4",
        body,
      });
      onTranscript(text.text);
      setVoice(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
      setVoice(false);
      finishing.current = false;
      removeRecording(recorder.uri);
    }
  }
  async function cancelRecording() {
    if (recorder.isRecording) await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    removeRecording(recorder.uri);
    setVoice(false);
  }
  return (
    <View pointerEvents="box-none" style={{ gap: 8 }}>
      {!!attachments.length && (
        <View pointerEvents="box-none" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {attachments.map((item, index) => (
            <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "100%", minHeight: 44, paddingLeft: 14, borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface }}>
              <Icon name={item.type === "image" ? "image" : "folder"} size={16} color={t.muted} />
              <Text style={{ color: t.ink, flexShrink: 1, fontSize: 13 }} numberOfLines={1}>
                {item.name}
              </Text>
              <IconButton name="close" size={44} label={tr("Remove") + " " + item.name} disabled={disabled}
                onPress={() => setAttachments(attachments.filter((_, i) => i !== index))} />
            </View>
          ))}
        </View>
      )}
      {voice && (
        <View
          style={{
            backgroundColor: t.surface,
            padding: 12,
            borderRadius: 28,
            gap: 10,
          }}
        >
          <Label>
            {state.isRecording
              ? tr("Recording · {p0}s / 60s", { p0: String(Math.floor(state.durationMillis / 1000)) })
              : tr("Recording stopped. Transcribe it or cancel.")}
          </Label>
          <View style={styles.row}>
            <Button
              title={tr("Transcribe")}
              disabled={!!busy}
              onPress={finishRecording}
            />
            <Button
              title={tr("Cancel recording")}
              secondary
              disabled={!!busy}
              onPress={cancelRecording}
            />
          </View>
        </View>
      )}
      <Notice capsule text={busy} />
      <Notice capsule error text={error} />
      <View pointerEvents="box-none" style={{flexDirection:"row",alignItems:"flex-end",gap:10}}>
        <View pointerEvents="box-none" style={{height:48,justifyContent:"center"}}><IconButton name="plus" label={tr("Attach")} floating size={48} disabled={disabled || !!busy || state.isRecording}
          onPress={() => {Keyboard.dismiss();setError("");setOpen(true);}}/>
        </View>
        <View pointerEvents="box-none" style={{flex:1,flexDirection:"row",alignItems:"flex-end",minHeight:48,borderRadius:24,borderWidth:1,borderColor:t.line,backgroundColor:t.surface,padding:1,gap:2}}>
          {children}
        </View>
      </View>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)} onDismiss={afterMenuDismiss}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr("Close attachment menu")} onPress={() => setOpen(false)} style={{flex:1,backgroundColor:t.dark ? "#00000040" : "#00000008"}}/>
        <View style={{position:"absolute",bottom:insets.bottom + 72,left:20,width:316,maxWidth:"90%",backgroundColor:t.surface,borderWidth:1,borderColor:t.line,borderRadius:26,padding:10}}>
          {([['folder','Choose a file',document],['camera','Take a photo',()=>image(true)],['image','Attach image',()=>image(false)]] as const).map(([icon,label,action]) =>
            <Pressable key={label} accessibilityRole="button" accessibilityLabel={tr(label)} accessibilityState={{disabled:!!busy || disabled}}
              disabled={!!busy || disabled} onPress={action} style={({pressed})=>({minHeight:50,flexDirection:"row",alignItems:"center",gap:16,paddingHorizontal:16,borderRadius:999,backgroundColor:pressed?t.hover:undefined,opacity:!!busy || disabled ? .5 : 1})}>
              <Icon name={icon} size={24} color={t.muted}/><Text style={{color:t.ink,fontSize:18}}>{tr(label)}</Text>
            </Pressable>)}
          {onReferenceChat && <Pressable accessibilityRole="button" accessibilityLabel={tr("Reference a chat")} disabled={!!busy || disabled} onPress={referenceChat} style={({pressed})=>({minHeight:50,flexDirection:"row",alignItems:"center",gap:16,paddingHorizontal:16,borderRadius:999,backgroundColor:pressed?t.hover:undefined,opacity:!!busy || disabled ? .5 : 1})}><Icon name="chat" size={24} color={t.muted}/><Text style={{color:t.ink,fontSize:18}}>{tr("Reference a chat")}</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel={tr("Voice input")} disabled={!transcription || disabled || !!busy || state.isRecording} onPress={startRecording} style={({pressed})=>({minHeight:50,flexDirection:"row",alignItems:"center",gap:16,paddingHorizontal:16,borderRadius:999,backgroundColor:pressed?t.hover:undefined,opacity:!transcription || disabled || !!busy || state.isRecording ? .4 : 1})}><Icon name="microphone" size={24} color={t.muted}/><Text style={{color:t.ink,fontSize:18}}>{tr("Voice input")}</Text></Pressable>
          {onVoiceChat && <Pressable accessibilityRole="button" accessibilityLabel={tr("Voice chat")} disabled={!transcription || disabled || voiceChatDisabled || !!busy || state.isRecording || voice} onPress={() => { nextMenuAction.current=onVoiceChat;setOpen(false);if(Platform.OS!=="ios")menuTimer.current=setTimeout(afterMenuDismiss,300); }} style={({pressed})=>({minHeight:50,flexDirection:"row",alignItems:"center",gap:16,paddingHorizontal:16,borderRadius:999,backgroundColor:pressed?t.hover:undefined,opacity:!transcription || disabled || voiceChatDisabled || !!busy || state.isRecording || voice ? .4 : 1})}><Icon name="waveform" size={24} color={t.muted}/><Text style={{color:t.ink,fontSize:18}}>{tr("Voice chat")}</Text></Pressable>}
          {(busy || error) ? <View style={{padding:10,gap:8}}><Notice text={busy}/><Notice error text={error}/></View> : null}
        </View>
      </Modal>
    </View>
  );
}
