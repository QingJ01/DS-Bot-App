import { Text } from "./Typography";
import { tr } from "../i18n";
import React, { useMemo, useState } from "react";
import { Linking, Platform, ScrollView, TextStyle, View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import * as Clipboard from "expo-clipboard";
import { markdownNodes, MarkdownNode, safeLink, MentionBot } from "../logic/markdown";
import { useTheme } from "../theme";

const mono = Platform.OS === "ios" ? "Menlo" : "monospace";

function CodeBlock({ node, onLongPress }: { node: MarkdownNode; onLongPress?: () => void }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <View style={{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 10, overflow: "hidden" }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingLeft: 12, borderBottomWidth: 1, borderColor: t.line }}>
      <Text style={{ color: t.muted, fontSize: 11 }}>{node.info.split(/\s/)[0] || tr("Code")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={tr("Copy code")} onPress={async () => {
        try { await Clipboard.setStringAsync(node.text); setCopied(true); setFailed(false); }
        catch { setFailed(true); }
      }} style={{ minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: failed ? t.error : t.muted, fontSize: 12 }}>{failed ? tr("Copy failed") : copied ? tr("Copied") : tr("Copy")}</Text>
      </Pressable>
    </View>
    <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
      <Text selectable={!onLongPress} onLongPress={onLongPress} style={{ color: t.ink, fontSize: 13, lineHeight: 20, fontFamily: mono }}>{node.text.replace(/\n$/, "")}</Text>
    </ScrollView>
  </View>;
}

export function MarkdownText({ text, color, onLink, onLongPress, fontSize = 14, bots, selfId }: {
  text: string;
  color?: string;
  onLink?: (url: string) => boolean;
  onLongPress?: () => void;
  fontSize?: number;
  bots?: MentionBot[];
  selfId?: string;
}) {
  const t = useTheme();
  const nodes = useMemo(() => markdownNodes(text, bots, selfId), [text, bots, selfId]);
  const [linkError, setLinkError] = useState("");
  const ink = color || t.ink;
  const body: TextStyle = { color: ink, fontSize, lineHeight: fontSize + 8 };
  async function open(value: string) {
    if (onLink?.(value)) return;
    const url = safeLink(value);
    if (!url) { setLinkError("This link cannot be opened."); return; }
    try { await Linking.openURL(url); setLinkError(""); }
    catch { setLinkError("This link could not be opened."); }
  }
  function inline(items: MarkdownNode[], prefix: string): React.ReactNode[] {
    return items.map((node, index) => {
      const key = `${prefix}:${index}`;
      const children = node.children.length ? inline(node.children, key) : node.text;
      if (node.type === "softbreak" || node.type === "hardbreak") return "\n";
      if (node.type === "strong") return <Text key={key} style={{ fontWeight: "700" }}>{children}</Text>;
      if (node.type === "em") return <Text key={key} style={{ fontStyle: "italic" }}>{children}</Text>;
      if (node.type === "s") return <Text key={key} style={{ textDecorationLine: "line-through" }}>{children}</Text>;
      if (node.type === "code_inline") return <Text key={key} style={{ fontFamily: mono, backgroundColor: t.line, fontSize: fontSize - 1 }}>{node.text}</Text>;
      if (node.type === "link") return <Text key={key} accessibilityRole="link" style={{ color: color === t.userText ? color : t.link, textDecorationLine: "underline" }} onPress={() => void open(node.attrs.href)}>{children}</Text>;
      if (node.type === "image") return <Text key={key} accessibilityRole="link" style={{ textDecorationLine: "underline" }} onPress={() => void open(node.attrs.src)}>{node.text || tr("Open image")}</Text>;
      return <Text key={key}>{children}</Text>;
    });
  }
  function render(items: MarkdownNode[], prefix = "md"): React.ReactNode[] {
    return items.map((node, index) => {
      const key = `${prefix}:${index}`;
      if (node.type === "inline") return <Text key={key} selectable={!onLongPress} onLongPress={onLongPress} style={body}>{inline(node.children, key)}</Text>;
      if (node.type === "fence" || node.type === "code_block") return <CodeBlock key={key} node={node} onLongPress={onLongPress} />;
      if (node.type === "heading") {
        const size = Math.max(fontSize + 1, 25 - Number(node.tag.slice(1)) * 2);
        return <Text key={key} accessibilityRole="header" selectable={!onLongPress} onLongPress={onLongPress} style={{ ...body, fontSize: size, lineHeight: size + 8, fontWeight: "700", marginTop: 4 }}>{node.children.flatMap(child => inline(child.children, key))}</Text>;
      }
      if (node.type === "bullet_list" || node.type === "ordered_list") {
        const start = Number(node.attrs.start || 1);
        return <View key={key} style={{ gap: 5 }}>{node.children.map((child, n) => <View key={n} style={{ flexDirection: "row", gap: 7, paddingLeft: 2 }}>
          <Text style={{ ...body, minWidth: node.type === "ordered_list" ? 21 : 12 }}>{node.type === "ordered_list" ? `${start + n}.` : "•"}</Text>
          <View style={{ flex: 1, gap: 5 }}>{render(child.children, `${key}:${n}`)}</View>
        </View>)}</View>;
      }
      if (node.type === "blockquote") return <View key={key} style={{ borderLeftWidth: 3, borderColor: t.muted, paddingLeft: 11, gap: 7 }}>{render(node.children, key)}</View>;
      if (node.type === "hr") return <View key={key} accessible={false} style={{ height: 1, backgroundColor: t.line, marginVertical: 5 }} />;
      if (node.type === "table") {
        const rows = node.children.flatMap(section => section.children);
        return <ScrollView key={key} horizontal><View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 7, overflow: "hidden" }}>{rows.map((row, rowIndex) => <View key={rowIndex} style={{ flexDirection: "row", borderBottomWidth: rowIndex === rows.length - 1 ? 0 : 1, borderColor: t.line }}>{row.children.map((cell, col) => <View key={col} style={{ width: 148, padding: 10, backgroundColor: cell.type === "th" ? t.line : undefined, borderLeftWidth: col ? 1 : 0, borderColor: t.line }}><Text selectable={!onLongPress} onLongPress={onLongPress} style={{ ...body, fontWeight: cell.type === "th" ? "600" : "400" }}>{cell.children.flatMap(child => inline(child.children, `${key}:${rowIndex}:${col}`))}</Text></View>)}</View>)}</View></ScrollView>;
      }
      return <View key={key} style={{ gap: 7 }}>{node.children.length ? render(node.children, key) : <Text selectable={!onLongPress} onLongPress={onLongPress} style={body}>{node.text}</Text>}</View>;
    });
  }
  return <View style={{ gap: 8 }}>{render(nodes)}{linkError ? <Text accessibilityRole="alert" style={{ color: t.error, fontSize: 12 }}>{tr(linkError)}</Text> : null}</View>;
}
