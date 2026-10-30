import { Text, TextInput } from "./Typography";
import { tr } from "../i18n";
import React, { useEffect } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, BackHandler, Modal, ScrollView, StyleSheet, TextInputProps, View, Switch } from "react-native";
import { AnimatedPressable as Pressable, PageTransition } from "./Motion";
import { contrastText, useTheme } from "../theme";
import { BRAND_BLUE } from "../logic/colors";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
export function Label({
  children,
  muted = false,
  large = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
  large?: boolean;
}) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: muted ? t.muted : t.ink,
        fontSize: large ? 19 : 14,
        fontWeight: large ? "600" : "400",
        lineHeight: large ? 26 : 21,
      }}
    >
      {children}
    </Text>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  danger = false,
  compact = false,
  floating = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  danger?: boolean;
  compact?: boolean;
  floating?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingVertical: compact ? 8 : 10,
        paddingHorizontal: compact ? 13 : 16,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
        backgroundColor: secondary ? (floating ? t.surface : t.hover) : danger ? t.error : t.accent,
        borderColor: t.line,
        borderWidth: floating ? 1 : 0,
      })}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: "500",
          color: secondary ? (danger ? t.error : t.ink) : danger ? contrastText(t.error) : t.accentText,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  ...props
}: TextInputProps & {
  label: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: t.ink, fontSize: 13, fontWeight: "500" }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        {...props}
        style={[
          {
            backgroundColor: t.surface,
            color: t.ink,
            minHeight: 44,
            padding: 12,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 14,
            fontSize: 15,
            textAlignVertical: "top",
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Notice({
  text,
  error = false,
  capsule = false,
}: {
  text?: string | null;
  error?: boolean;
  capsule?: boolean;
}) {
  const t = useTheme();
  if (!text) return null;
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={{
        borderRadius: capsule ? 999 : 12,
        backgroundColor: t.surface,
        borderColor: error ? t.error : t.line,
        borderWidth: 1,
        padding: 12,
        paddingHorizontal: capsule ? 20 : 12,
      }}
    >
      <Text
        selectable
        style={{
          color: error ? t.error : t.muted,
          fontSize: 13,
          lineHeight: 20,
        }}
      >
        {tr(text)}
      </Text>
    </View>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: 18,
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: t.line,
      }}
    >
      {children}
    </View>
  );
}
export function Busy({ text = "Loading…" }: { text?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        padding: 22,
        flexDirection: "row",
        gap: 12,
        justifyContent: "center",
      }}
    >
      <ActivityIndicator color={t.accent} />
      <Label muted>{tr(text)}</Label>
    </View>
  );
}
export function Sheet({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "web" ? undefined : "padding"}
        style={{
          flex: 1,
          backgroundColor: "#0008",
          justifyContent: "flex-end",
        }}
      >
        <Pressable accessibilityRole="button" accessibilityLabel={tr("Close")} onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <PageTransition distance={28}>
        <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: t.bg,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: "90%",
            overflow: "hidden",
            paddingTop: 20,
            paddingHorizontal: 20,
            paddingBottom: Math.max(16, insets.bottom + 8),
          }}
        >
          <View style={styles.between}>
            <Label large>{title}</Label>
            <IconButton name="close" floating label={tr("Close")} onPress={onClose} />
          </View>
          <ScrollView
            style={{ flexShrink: 1, minHeight: 0 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              gap: 16,
              paddingTop: 20,
              paddingBottom: 16,
            }}
          >
            {children}
          </ScrollView>
        </View>
        </View>
        </PageTransition>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  between: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "center",
  },
  page: { padding: 16, gap: 20, paddingBottom: 24 },
  caption: { fontSize: 12 },
  grow: { flex: 1 },
});
const iconNames = {
  menu: "menu", back: "chevron-left", close: "x", plus: "plus", search: "search",
  settings: "settings", bots: "users", groups: "message-circle", chat: "message-square", devices: "smartphone",
  schedules: "clock", usage: "bar-chart-2", pin: "bookmark", chevron: "chevron-right",
  up: "chevron-up", more: "more-horizontal", check: "check", connectors: "link", secrets: "key", feedback: "message-square",
  microphone: "mic", folder: "folder", camera: "camera", image: "image", send: "arrow-up",
  stop: "square", skills: "book-open", browser: "monitor", bell: "bell", reply: "corner-up-left", smile: "smile", copy: "copy", share: "share-2", download: "download", speaker: "volume-2",
} as const;
export type IconName = keyof typeof iconNames | "waveform";
export function Icon({ name, size = 22, color }: {name: IconName; size?: number; color?: string}) {
  const t = useTheme();
  return name === "waveform"
    ? <MaterialCommunityIcons name="waveform" size={size} color={color || t.ink} accessible={false} />
    : <Feather name={iconNames[name]} size={size} color={color || t.ink} accessible={false} />;
}
export function IconButton({ name, label, onPress, disabled = false, floating = false, primary = false, brand = false, size = 48, width = size }: {
  name: IconName; label: string; onPress: () => void; disabled?: boolean; floating?: boolean; primary?: boolean; brand?: boolean; size?: number; width?: number;
}) {
  const t = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}}
    disabled={disabled} onPress={onPress} style={({pressed}) => ({
      width, height:size, borderRadius:size / 2, alignItems:"center", justifyContent:"center",
      flexShrink:0, backgroundColor:brand ? BRAND_BLUE : primary ? t.ink : floating ? t.surface : pressed ? t.hover : undefined,
      borderWidth:floating && !primary ? 1 : 0, borderColor:t.line,
      opacity:disabled ? .35 : pressed ? .65 : 1,
    })}><Icon name={name} size={name === "plus" ? 28 : 23} color={brand ? "#FFFFFF" : primary ? t.bg : t.ink}/></Pressable>;
}
export function PageHeader({
  title,
  onBack,
  onOpenNavigation,
  right,
  close = false,
  floating = false,
}: {
  title: string;
  onBack?: () => void;
  onOpenNavigation?: () => void;
  right?: React.ReactNode;
  close?: boolean;
  floating?: boolean;
}) {
  const t = useTheme();
  useEffect(() => {
    if (!onBack) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onBack]);
  return (
    <View
      pointerEvents="box-none"
      style={{
        ...(floating ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 } as const : {}),
        flexDirection: "row",
        alignItems: "center",
        gap: 18,
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
        minHeight: 76,
      }}
    >
      {onBack ? (
        <IconButton name={close ? "close" : "back"} floating label={tr(close ? "Close" : "Back")} onPress={onBack} />
      ) : onOpenNavigation ? (
        <IconButton
          name="menu"
          label={tr("Open navigation")}
          onPress={onOpenNavigation}
        />
      ) : null}
      <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'flex-start' }}>
        {!!title && <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 21, fontWeight: "600", color: t.ink, ...(floating ? { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 24, overflow: 'hidden' as const, paddingHorizontal: 16, paddingVertical: 10 } : {}) }}>{title}</Text>}
      </View>
      {right}
    </View>
  );
}
export function Section({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontSize: 14,
          lineHeight: 20,
          fontWeight: "400",
          color: t.muted,
          paddingHorizontal: 20,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: t.hover,
          borderRadius: 22,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
      {footer && (
        <Text
          style={{
            fontSize: 12,
            lineHeight: 17,
            color: t.muted,
            paddingHorizontal: 4,
          }}
        >
          {footer}
        </Text>
      )}
    </View>
  );
}
export function SettingRow({
  title,
  hint,
  children,
  onPress,
  leading,
  accessibilityLabel,
  danger = false,
  last = false,
  disabled = false,
  compact = false,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  leading?: React.ReactNode;
  accessibilityLabel?: string;
  compact?: boolean;
  danger?: boolean;
  last?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            color: danger ? t.error : t.ink,
            fontSize: 19,
            lineHeight: 26,
          }}
        >
          {title}
        </Text>
        {hint && (
          <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
            {hint}
          </Text>
        )}
      </View>
      {children}
      {onPress && <Icon name="chevron" size={16} color={t.faint} />}
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: compact ? 12 : 16,
    minHeight: compact ? 56 : 64,
    borderBottomWidth: last ? 0 : 1,
    borderColor: t.line,
    opacity: disabled ? 0.5 : 1,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        ...style,
        backgroundColor: pressed ? t.hover : undefined,
      })}
    >
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}
export function ToggleRow({
  title,
  hint,
  value,
  onChange,
  disabled,
  last,
}: {
  title: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <SettingRow title={title} hint={hint} disabled={disabled} last={last}>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.accent }}
      />
    </SettingRow>
  );
}
export function Tag({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        fontSize: 11,
        lineHeight: 16,
        paddingHorizontal: 5,
        borderRadius: 4,
        color: t.tagInk,
        backgroundColor: t.tagBg,
        overflow: "hidden",
      }}
    >
      {children}
    </Text>
  );
}
