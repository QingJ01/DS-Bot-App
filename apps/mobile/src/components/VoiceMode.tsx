import { Text } from "./Typography";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, ScrollView, View } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { File } from "expo-file-system";
import * as Speech from "expo-speech";
import type { Conversation, Message, MobileClient } from "@ds-bot/mobile-sdk";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import { Bot, Room, TeamState, errorText } from "../types";
import { endVoiceTurn, speechText, voiceActivity, voiceReply, VoiceSubmission } from "../logic/voice";
import { BotAvatar, RoomAvatar } from "./BotAvatar";
import { Button, Label, Notice, styles } from "./UI";

type Phase = "paused" | "preparing" | "listening" | "transcribing" | "thinking" | "speaking";

function useWebMeter(enabled: boolean) {
  const [meter, setMeter] = useState<number | undefined>();
  useEffect(() => {
    setMeter(undefined);
    if (!enabled || Platform.OS !== "web" || !globalThis.AudioContext || !navigator.mediaDevices?.getUserMedia) return;
    let active = true;
    let audio: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(media => {
      if (!active) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      audio = new AudioContext();
      void audio.resume().catch(() => {});
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(media).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const sample = () => {
        if (!active) return;
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
        setMeter(20 * Math.log10(Math.max(rms, 1e-8)));
        timer = setTimeout(sample, 100);
      };
      sample();
    }).catch(() => {});
    return () => { active = false; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); void audio?.close().catch(() => {}); };
  }, [enabled]);
  return meter;
}

function removeRecording(uri: string | null) {
  if (!uri) return;
  try { if (Platform.OS === "web") URL.revokeObjectURL(uri); else { const file = new File(uri); if (file.exists) file.delete(); } } catch {}
}

export function VoiceMode({ client, conversation, bot, room, team, messages, running, enabled, onSend, onStop, onClose }: {
  client: MobileClient; conversation: Conversation; bot?: Bot; room?: Room; team: TeamState;
  messages: Message[]; running: boolean; enabled: boolean;
  onSend: (text: string) => Promise<VoiceSubmission | null>; onStop: () => Promise<void>; onClose: () => void;
}) {
  const t = useTheme();
  const { tr, locale } = useI18n();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<Phase>("paused");
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const alive = useRef(true);
  const finishing = useRef(false);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const request = useRef<AbortController | null>(null);
  const submission = useRef<VoiceSubmission | null>(null);
  const activity = useRef({ heard: false, lastSound: 0 });
  const props = useRef({ enabled, onSend });
  props.current = { enabled, onSend };
  const webMeter = useWebMeter(phase === "listening");
  async function release() {
    try {
      const uri = recorder.uri;
      if (recorder.isRecording) await recorder.stop();
      removeRecording(recorder.uri || uri);
    } catch {}
    try { await setAudioModeAsync({ allowsRecording: false }); } catch {}
  }
  function pause(note = "") {
    generation.current++;
    request.current?.abort();
    submission.current = null;
    void Speech.stop();
    void release();
    if (alive.current) { setPhase("paused"); if (note) setError(note); }
  }
  async function listen() {
    if (!props.current.enabled || busy || finishing.current || AppState.currentState === "background" || AppState.currentState === "inactive") return;
    const run = ++generation.current;
    const current = () => alive.current && generation.current === run && props.current.enabled;
    setBusy(true); setError(""); setCaption(""); setPhase("preparing");
    activity.current = { heard: false, lastSound: 0 };
    try {
      await Speech.stop();
      await release();
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!current()) return;
      if (!permission.granted) throw new Error("Enable microphone access to use voice chat.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!current()) { await release(); return; }
      recorder.record();
      setPhase("listening");
    } catch (err) { if (current()) { setError(errorText(err)); setPhase("paused"); await release(); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function finish() {
    if (finishing.current || phaseRef.current !== "listening") return;
    finishing.current = true;
    const run = generation.current;
    const current = () => alive.current && generation.current === run && props.current.enabled;
    const controller = new AbortController();
    request.current = controller;
    let uri: string | null = null;
    setBusy(true); setPhase("transcribing");
    try {
      if (recorder.isRecording) await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      uri = recorder.uri;
      if (!current()) return;
      if (!uri) throw new Error("The recording could not be saved.");
      const blob = Platform.OS === "web" ? await (await fetch(uri)).blob() : null;
      const body = blob ? await blob.arrayBuffer() : await new File(uri).arrayBuffer();
      if (!current()) return;
      if (body.byteLength > 10 * 1024 * 1024) throw new Error("Record a shorter message, up to 10 MiB.");
      const mediaType = blob?.type.split(";")[0] || (Platform.OS === "web" ? "audio/webm" : "audio/mp4");
      const result = await client.transcribe({ name: mediaType === "audio/mp4" ? "voice.m4a" : "voice.webm", mediaType, body, signal: controller.signal });
      if (!current()) return;
      const text = result.text.trim();
      if (!text) throw new Error("No speech was recognized. Resume listening and try again.");
      setCaption(text);
      const accepted = await props.current.onSend(text);
      if (!current()) return;
      if (!accepted) throw new Error("This voice turn needs review. Return to chat to check your draft and send status.");
      submission.current = accepted;
      setPhase("thinking");
    } catch (err) { if (current()) { setError(errorText(err)); setPhase("paused"); } }
    finally { removeRecording(uri); finishing.current = false; if (request.current === controller) request.current = null; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    if (phase !== "listening") return;
    if (state.mediaServicesDidReset || (!state.isRecording && state.durationMillis > 500)) {
      pause("The microphone was interrupted. Resume listening when it is available.");
      return;
    }
    activity.current = voiceActivity(activity.current, state.durationMillis, Platform.OS === "web" ? webMeter : state.metering);
    if (endVoiceTurn(activity.current, state.durationMillis)) void finish();
  }, [phase, state.durationMillis, state.metering, state.isRecording, state.mediaServicesDidReset, webMeter]);
  useEffect(() => {
    if (phase !== "thinking" || running || !submission.current) return;
    const reply = voiceReply(messages, submission.current);
    if (!reply) return;
    submission.current = null;
    const text = speechText(reply);
    setCaption(text);
    if (!text) { setPhase("paused"); return; }
    const run = generation.current;
    setPhase("speaking");
    Speech.speak(text, { language: /[\u3400-\u9fff]/.test(text) ? "zh-CN" : locale === "zh" ? "zh-CN" : "en-US",
      onDone: () => { if (alive.current && generation.current === run && phaseRef.current === "speaking") void listen(); },
      onError: () => { if (alive.current && generation.current === run) { setError("Text-to-speech is unavailable on this device."); setPhase("paused"); } },
    });
  }, [phase, messages, running]);
  useEffect(() => {
    if (phase !== "thinking") return;
    const timer = setTimeout(() => pause("Your Bot is still working or waiting for input. Return to chat to review its status."), 120000);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => { if (!enabled) pause("Voice chat is paused. Reconnect to your host before resuming."); }, [enabled]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", value => { if (value !== "active") pause("Voice chat is paused while this app is in the background."); });
    return () => { alive.current = false; generation.current++; request.current?.abort(); void Speech.stop(); void release(); subscription.remove(); };
  }, []);
  const labels: Record<Phase, string> = { paused: "Paused", preparing: "Preparing microphone…", listening: "Listening…", transcribing: "Transcribing…", thinking: "Thinking…", speaking: "Speaking…" };
  return <Modal animationType="slide" onRequestClose={() => { pause(); onClose(); }}>
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 50, paddingHorizontal: 24, paddingBottom: 36, gap: 24 }}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 20 }}>
        {room ? <RoomAvatar room={room} team={team} size={100} /> : <BotAvatar bot={bot || { id: conversation.id, name: conversation.name }} size={100} live={phase === "thinking" || phase === "speaking"} />}
        <Text style={{ color: t.ink, fontSize: 22, fontWeight: "600" }}>{conversation.name}</Text>
        <Text accessibilityLiveRegion="polite" style={{ color: t.muted, fontSize: 17 }}>{tr(labels[phase])}</Text>
        {phase === "listening" ? <Text style={{ color: t.accent, fontSize: 13 }}>{Math.floor(state.durationMillis / 1000)} / 60 s</Text> : null}
        <ScrollView style={{ maxHeight: 180, alignSelf: "stretch" }}><Text selectable style={{ color: t.ink, fontSize: 16, lineHeight: 24, textAlign: "center" }}>{caption}</Text></ScrollView>
      </View>
      <Notice error text={tr(error)} />
      <Label muted>{tr("Your audio is transcribed on your host. Recognized speech is sent automatically when you pause, then the reply is read aloud. Pause stops the microphone.")}</Label>
      <View style={[styles.row, { justifyContent: "center", flexWrap: "wrap" }]}>
        {phase === "paused" ? <Button title={tr("Resume listening")} disabled={!enabled || busy} onPress={() => void listen()} /> : <Button title={tr("Pause")} secondary onPress={() => pause()} />}
        {phase === "listening" ? <Button title={tr("Send voice turn")} disabled={busy || state.durationMillis < 500} onPress={() => void finish()} /> : null}
        {phase === "thinking" && running ? <Button title={tr("Stop reply")} secondary onPress={() => { pause(); void onStop(); }} /> : null}
        <Button title={tr("End voice chat")} secondary onPress={() => { pause(); onClose(); }} />
      </View>
    </View>
  </Modal>;
}
