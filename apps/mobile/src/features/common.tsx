import { Text } from "../components/Typography";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { useTheme } from "../theme";

export function ChoiceChips({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ fontSize: 12, color: theme.muted }}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingBottom: 2 }}
      >
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${option.label}`}
            accessibilityState={{ selected: value === option.value, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={{
              minHeight: 36,
              justifyContent: "center",
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.line,
              backgroundColor:
                value === option.value ? theme.soft : theme.surface,
              opacity: disabled ? 0.45 : 1,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                color: value === option.value ? theme.accent : theme.ink,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
export function FeatureTitle({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.ink }}>
          {title}
        </Text>
        {hint ? (
          <Text style={{ fontSize: 12, lineHeight: 18, color: theme.muted }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
export function SmallText({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text
      selectable
      style={{
        color: error ? theme.error : theme.muted,
        fontSize: 12,
        lineHeight: 18,
      }}
    >
      {children}
    </Text>
  );
}
export function useRemoteView<T>(
  loader: () => Promise<T>,
  online: boolean,
  interval = 0,
) {
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const generation = useRef(0),
    mounted = useRef(false);
  const show = useCallback((next: T) => {
    ++generation.current;
    if (mounted.current) {
      setValue(next);
      setError("");
      setLoading(false);
    }
  }, []);
  const load = useCallback(async () => {
    if (!online) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await loader();
      if (mounted.current && generation.current === current) {
        setValue(result);
        setError("");
      }
    } catch (failure) {
      if (mounted.current && generation.current === current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not load this view.",
        );
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }, [loader, online]);
  useEffect(() => {
    mounted.current = true;
    setValue(null);
    setError("");
    void load();
    return () => {
      mounted.current = false;
      ++generation.current;
    };
  }, [load]);
  useEffect(() => {
    if (!online || !interval) return;
    const timer = setInterval(() => void load(), interval);
    return () => clearInterval(timer);
  }, [load, online, interval]);
  return { value, error, loading, load, show };
}
