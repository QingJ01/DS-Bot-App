import { Text } from "./Typography";
import { tr } from "../i18n";
import React, { useRef, useState } from "react";
import { View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import { MobileClient } from "@ds-bot/mobile-sdk";
import { Button, Field, Notice, styles } from "./UI";
import { errorText, Question } from "../types";
import { useTheme } from "../theme";

export function QuestionCard({ question, sessionId, client, refresh, disabled = false }: {
  question: Question;
  sessionId: string;
  client: MobileClient;
  refresh: () => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const multi = question.multiSelect === true;
  const custom = question.allowCustom === true;
  async function submit(values: string[], dismiss = false) {
    if (submitting.current || disabled) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await client.action(dismiss ? "dismiss-question" : "answer-question", {
        sessionId,
        ...(dismiss ? {} : { questionId: question.id, answer: { selected: values, ...(custom && answer.trim() ? { custom: answer.trim() } : {}) } }),
      });
      setSettled(true);
      await refresh();
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); submitting.current = false; }
  }
  if (settled) return null;
  return <View style={{ backgroundColor: t.bubble, borderRadius: 16, padding: 12, gap: 10, marginVertical: 8 }}>
    <View style={[styles.between, { alignItems: "flex-start" }]}>
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={{ color: t.ink, fontSize: 15, lineHeight: 22, fontWeight: "600" }}>{question.header ? question.header + " · " : ""}{question.question || question.prompt || question.text || tr("Your Bot is waiting for input.")}</Text>
        {question.detail ? <Text style={{ color: t.muted, fontSize: 13, lineHeight: 20 }}>{question.detail}</Text> : null}
        {multi ? <Text style={{ color: t.muted, fontSize: 12 }}>{tr("Choose all that apply")}</Text> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={tr("Dismiss question")} disabled={busy || disabled} onPress={() => void submit([], true)} style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center", opacity: busy || disabled ? 0.4 : 1 }}><Text style={{ color: t.muted, fontSize: 22 }}>×</Text></Pressable>
    </View>
    {question.options?.map((option, index) => {
      const label = typeof option === "string" ? option : option.label || option.value || "";
      const description = typeof option === "object" ? option.description : undefined;
      const picked = selected.includes(label);
      return <Pressable key={index + ":" + label} accessibilityRole={multi ? "checkbox" : "button"} accessibilityLabel={label} accessibilityState={{ checked: multi ? picked : undefined, disabled: busy || disabled }} disabled={busy || disabled} onPress={() => {
        if (multi) setSelected(old => picked ? old.filter(value => value !== label) : [...old, label]);
        else void submit([label]);
      }} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: t.surface, borderRadius: 10, borderWidth: 1, borderColor: picked ? t.accent : t.line, opacity: busy || disabled ? 0.4 : 1 }}>
        <Text style={{ fontSize: 12, color: picked ? t.userText : t.muted, backgroundColor: picked ? t.user : t.line, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4 }}>{String.fromCharCode(65 + index)}</Text>
        <View style={{ flex: 1, gap: 3 }}><Text style={{ color: t.ink, fontSize: 14 }}>{label}</Text>{description ? <Text style={{ color: t.muted, fontSize: 12, lineHeight: 18 }}>{description}</Text> : null}</View>
        {picked ? <Text style={{ color: t.accent }}>✓</Text> : null}
      </Pressable>;
    })}
    {custom ? <Field label={tr("Your own answer")} placeholder={tr("Type your own answer")} value={answer} onChangeText={setAnswer} editable={!busy && !disabled} multiline /> : null}
    <Notice error text={error} />
    {(multi || (custom && answer.trim())) ? <View style={[styles.row, { justifyContent: "flex-end" }]}>
      {multi ? <Button title={tr("Skip")} secondary compact disabled={busy || disabled} onPress={() => void submit([], true)} /> : null}
      <Button title={busy ? tr("Submitting…") : tr("Submit")} compact disabled={busy || disabled || (!selected.length && (!custom || !answer.trim()))} onPress={() => void submit(selected)} />
    </View> : null}
  </View>;
}
