import React, { useRef, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { MobileClient } from "@ds-bot/mobile-sdk";
import { tr } from "../i18n";
import { asText, readView, resolve, validateViewAnswer, viewScope, ViewNode } from "../logic/views";
import { errorText, PendingView } from "../types";
import { useTheme } from "../theme";
import { Button, Field, Label, Notice } from "./UI";
import { MarkdownText } from "./MarkdownText";

type Answer = (action: string, values: Record<string, unknown>) => void;

export function ViewCard({ shown, disabled = false, answer }: { shown: unknown; disabled?: boolean; answer?: Answer }) {
  const checked = readView(shown);
  if (!checked) return <Notice text={tr("This card cannot be displayed safely. Open it on Web or desktop.")} />;
  return <ViewBody title={checked.title} blueprint={checked.view} interactive={checked.interactive} disabled={disabled} answer={answer} />;
}

function ViewBody({ title, blueprint, interactive, disabled, answer }: { title: string; blueprint: ViewNode; interactive: boolean; disabled: boolean; answer?: Answer }) {
  const t = useTheme();
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const scope = viewScope(blueprint, inputs);
  const value = (sent: unknown) => resolve(sent, scope, "—");
  const text = (sent: unknown) => asText(value(sent));
  const submit: Answer | undefined = answer ? (action, values) => answer(action, { ...values, ...(Object.keys(inputs).length ? { inputs } : {}) }) : undefined;
  function render(node: ViewNode, key: string): React.ReactNode {
    const current = Object.hasOwn(inputs, node.id) ? inputs[node.id] : node.type === "toggle" ? node.value === true : node.type === "choice" ? node.value ?? node.options[0]?.value ?? node.options[0]?.label : node.value;
    const set = (next: unknown) => setInputs(old => ({ ...old, [node.id]: next }));
    const label = node.label ? text(node.label) : "";
    let content: React.ReactNode;
    switch (node.type) {
      case "stack": case "row":
        content = <View style={{ gap: 12, flexDirection: node.type === "row" ? "row" : "column", flexWrap: node.type === "row" ? "wrap" : undefined }}>{node.children.map((child: ViewNode, index: number) => render(child, `${key}:${index}`))}</View>;
        break;
      case "text": case "callout": content = <MarkdownText text={text(node.text)} />; break;
      case "metric": content = <><Label muted>{label}</Label><Text selectable style={{ color: t.ink, fontSize: 24, fontWeight: "600" }}>{text(node.value)}</Text>{node.caption !== undefined && <Label muted>{text(node.caption)}</Label>}</>; break;
      case "html": content = <><MarkdownText text={node.summary} /><Notice text={tr("Interactive HTML is only available on Web or desktop. This is its summary.")} /></>; break;
      case "table":
        content = <DataTable columns={node.columns.map((column: { label: string }) => column.label)} rows={node.rows.map((row: unknown[]) => row.map(text))} />;
        break;
      case "chart":
        content = <><Label muted>{tr("Chart data")}{node.unit ? ` · ${node.unit}` : ""}</Label><DataTable columns={[tr("Category"), ...node.series.map((series: { name?: string }, index: number) => series.name || `${tr("Series")} ${index + 1}`)]} rows={node.categories.map((category: string, index: number) => [category, ...node.series.map((series: { values: unknown[] }) => text(series.values[index]))])} />{node.caption && <Label muted>{node.caption}</Label>}</>;
        break;
      case "progress": {
        const percentage = node.percent !== undefined ? Number(value(node.percent)) : Number(value(node.value)) / Number(value(node.max)) * 100;
        const valid = Number.isFinite(percentage);
        content = <><Label>{label} {node.valueLabel !== undefined ? text(node.valueLabel) : valid ? `${Math.round(percentage)}%` : "—"}</Label><View accessibilityRole="progressbar" accessibilityValue={valid ? { min: 0, max: 100, now: Math.max(0, Math.min(100, percentage)) } : undefined} style={{ height: 8, backgroundColor: t.line, borderRadius: 4 }}><View style={{ height: 8, borderRadius: 4, backgroundColor: t.accent, width: `${valid ? Math.max(0, Math.min(100, percentage)) : 0}%` }} /></View></>;
        break;
      }
      case "sources": content = <>{node.items.map((item: { label: string; url: string }, index: number) => <View key={index}><Label>{item.label}</Label><Text selectable style={{ color: t.muted }}>{item.url}</Text></View>)}</>; break;
      case "number": case "slider":
        content = <><Field label={`${label}${node.unit ? ` (${node.unit})` : ""}`} value={current === undefined ? "" : String(current)} editable={!disabled} keyboardType="numeric" onChangeText={sent => set(sent.trim() === "" || !Number.isFinite(Number(sent)) ? sent : Number(sent))} />{(node.min !== undefined || node.max !== undefined) && <Label muted>{`${node.min ?? "−∞"} … ${node.max ?? "∞"}`}</Label>}</>;
        break;
      case "toggle": content = <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Label>{label}</Label><Switch accessibilityLabel={label} disabled={disabled} value={current === true} onValueChange={set} trackColor={{ true: t.accent, false: t.line }} /></View>; break;
      case "choice": content = <><Label>{label}</Label>{node.options.map((option: { label: string; value?: unknown }, index: number) => <Button key={index} title={option.label} secondary={current !== (option.value ?? option.label)} disabled={disabled} onPress={() => set(option.value ?? option.label)} />)}</>; break;
      default: content = <AnswerControls node={node} disabled={disabled || !submit} answer={submit} />;
    }
    return <View key={key} style={{ gap: 8, flexShrink: 1, minWidth: node.type === "row" ? undefined : "100%" }}>{content}</View>;
  }
  return <View style={{ gap: 12, padding: 12, marginVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.bubble }}>
    {!!title && <Label>{title}</Label>}
    {render(blueprint, "view")}
    {interactive && !answer && <Notice text={tr("Historical card. Use the current card in the conversation to answer.")} />}
  </View>;
}

function DataTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const t = useTheme();
  const row = (cells: string[], index: number) => <View key={index} style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: t.line }}>{cells.map((cell, at) => <Text key={at} selectable style={{ width: 145, padding: 8, color: t.ink, fontWeight: index === -1 ? "600" : "400" }}>{cell}</Text>)}</View>;
  return <ScrollView horizontal><View>{row(columns, -1)}{rows.map(row)}</View></ScrollView>;
}

function AnswerControls({ node, disabled, answer }: { node: ViewNode; disabled: boolean; answer?: Answer }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  switch (node.type) {
    case "confirm": return <><Button title={node.confirmLabel || tr("Confirm")} disabled={disabled} onPress={() => answer?.(node.id, { confirmed: true })} /><Button title={node.cancelLabel || tr("Cancel")} secondary disabled={disabled} onPress={() => answer?.(node.id, { confirmed: false })} /></>;
    case "options": return <>{node.options.map((option: { label: string; description?: string }, index: number) => <View key={index} style={{ gap: 4 }}><Button title={option.label} secondary={!selected.includes(option.label)} disabled={disabled} onPress={() => node.multi ? setSelected(old => old.includes(option.label) ? old.filter(label => label !== option.label) : [...old, option.label]) : answer?.(node.id, { selected: [option.label] })} />{option.description && <Label muted>{option.description}</Label>}</View>)}{node.multi && <Button title={tr("Submit")} disabled={disabled || !selected.length} onPress={() => answer?.(node.id, { selected })} />}</>;
    case "form": return <>{node.fields.map((field: { id: string; label: string; placeholder?: string }) => <Field key={field.id} label={field.label} placeholder={field.placeholder} value={fields[field.id] ?? ""} maxLength={2000} editable={!disabled} onChangeText={text => setFields(old => ({ ...old, [field.id]: text }))} />)}<Button title={node.submitLabel || tr("Submit")} disabled={disabled} onPress={() => answer?.(node.id, { fields })} /></>;
    case "submit": return <Button title={node.label || tr("Submit")} disabled={disabled} onPress={() => answer?.(node.id, {})} />;
    default: return <Notice text={tr("This card cannot be displayed safely. Open it on Web or desktop.")} />;
  }
}

export function PendingViewCard({ pending, client, refresh, disabled }: { pending: PendingView; client: MobileClient; refresh: () => Promise<void>; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  async function send(action?: string, values: Record<string, unknown> = {}) {
    if (disabled || locked.current || settled) return;
    if (action) {
      const shown = readView(pending);
      const checked = shown && validateViewAnswer(shown.view, action, values);
      if (!checked || checked.error) { setError(checked?.error || tr("This card cannot be displayed safely. Open it on Web or desktop.")); return; }
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await client.action(action ? "view-reply" : "dismiss-view", { sessionId: pending.sessionId, viewId: pending.id, ...(action ? { action, values } : {}) });
      setSettled(true);
    } catch (err) { setError(errorText(err)); }
    finally { locked.current = false; setBusy(false); }
    await refresh().catch(() => {});
  }
  if (settled) return null;
  return <View style={{ gap: 6 }}><ViewCard shown={pending} disabled={disabled || busy} answer={(action, values) => void send(action, values)} /><Notice error text={error} /><Button secondary title={tr("Dismiss card")} disabled={disabled || busy} onPress={() => void send()} /></View>;
}
