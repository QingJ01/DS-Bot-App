import React, { useSyncExternalStore } from "react";
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput, TextInputProps, TextProps, TextStyle } from "react-native";
export type AppTextInput = NativeTextInput;

export const FONT_SCALES = [0.9, 1, 1.15, 1.3] as const;
export type FontScale = (typeof FONT_SCALES)[number];
let scale: FontScale = 1;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setFontScale(value: unknown) {
  const next = FONT_SCALES.find(item => item === value) || 1;
  if (next === scale) return;
  scale = next;
  listeners.forEach(listener => listener());
}
export function useFontScale() {
  return useSyncExternalStore(subscribe, () => scale, () => scale);
}
function scaled(style: TextStyle | undefined, factor: number) {
  if (!style || factor === 1) return style;
  const next: TextStyle = { ...style };
  if (typeof style.fontSize === "number") next.fontSize = Math.round(style.fontSize * factor);
  if (typeof style.lineHeight === "number") next.lineHeight = Math.round(style.lineHeight * factor);
  return next;
}
export const Text = React.forwardRef<NativeText, TextProps>(function AppText(props, ref) {
  const factor = useFontScale();
  const flat = StyleSheet.flatten(props.style) as TextStyle | undefined;
  return <NativeText {...props} ref={ref} allowFontScaling style={[props.style, scaled(flat, factor)]} />;
});
export const TextInput = React.forwardRef<NativeTextInput, TextInputProps>(function AppTextInput(props, ref) {
  const factor = useFontScale();
  const flat = StyleSheet.flatten(props.style) as TextStyle | undefined;
  return <NativeTextInput {...props} ref={ref} allowFontScaling style={[props.style, scaled(flat, factor)]} />;
});
