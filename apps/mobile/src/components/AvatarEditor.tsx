import { tr } from "../i18n";
import { useI18n } from "../i18n";
import React, { useState } from "react";
import { View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Bot } from "../types";
import { useTheme } from "../theme";
import {
  BotAvatar,
  botColor,
  characterColors,
  characters,
  characterShapes,
  defaultColor,
  defaultShape,
} from "./BotAvatar";
import { Button, Field, Notice, styles } from "./UI";
export function AvatarEditor({
  bot,
  disabled = false,
  onChange,
  onReset,
}: {
  bot: Bot;
  disabled?: boolean;
  onChange: (patch: { color?: string; avatar?: Bot["avatar"] }) => void;
  onReset?: () => void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const [error, setError] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  async function photo() {
    setError("");
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled) return;
      const item = result.assets[0];
      if (item.fileSize && item.fileSize > 25 * 1024 * 1024)
        throw new Error("Choose a photo smaller than 25 MB.");
      const edge = Math.min(item.width, item.height);
      let image = "";
      for (const quality of [0.9, 0.75, 0.6]) {
        const encoded = await manipulateAsync(
          item.uri,
          [
            {
              crop: {
                originX: Math.max(0, (item.width - edge) / 2),
                originY: Math.max(0, (item.height - edge) / 2),
                width: edge,
                height: edge,
              },
            },
            { resize: { width: 160, height: 160 } },
          ],
          { compress: quality, format: SaveFormat.WEBP, base64: true },
        );
        image = `data:image/webp;base64,${encoded.base64}`;
        if (image.length <= 150000) break;
      }
      if (image.length > 150000)
        throw new Error(
          "This photo could not be made small enough. Choose a simpler photo.",
        );
      onChange({ avatar: { image } });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load this photo.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <View style={{ alignItems: "center", padding: 16 }}>
        <BotAvatar bot={bot} size={104} />
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {characterShapes.map((shape) => (
          <Pressable
            key={shape}
            accessibilityRole="button"
            accessibilityLabel={tr("Character {p0}", { p0: String(characters[shape].label || shape) })}
            accessibilityState={{ selected: bot.avatar?.shape === shape }}
            disabled={disabled || busy}
            onPress={() => onChange({ avatar: { shape } })}
            style={{
              width: "14%",
              minWidth: 40,
              aspectRatio: 1,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: bot.avatar?.shape === shape ? t.active : t.hover,
            }}
          >
            <BotAvatar bot={{ ...bot, avatar: { shape } }} size={38} />
          </Pressable>
        ))}
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 6,
        }}
      >
        {characterColors.map((color) => (
          <Pressable
            key={color}
            accessibilityRole="button"
            accessibilityLabel={tr("Color {p0}", { p0: String(color) })}
            accessibilityState={{ selected: bot.color === color }}
            onPress={() => onChange({ color })}
            disabled={disabled || busy}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 9,
                backgroundColor: botColor({ ...bot, color }, t.dark),
                borderWidth: bot.color === color ? 3 : 1,
                borderColor: bot.color === color ? t.ink : t.lineStrong,
              }}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field
            label={tr("Custom color")}
            placeholder="#3964FE"
            value={custom}
            onChangeText={setCustom}
            autoCapitalize="none"
            maxLength={7}
          />
        </View>
        <Button
          title={tr("Apply")}
          secondary
          compact
          disabled={!/^#[0-9a-f]{6}$/i.test(custom) || disabled || busy}
          onPress={() => onChange({ color: custom })}
        />
      </View>
      <View style={[styles.row, { flexWrap: "wrap" }]}>
        <Button
          title={tr("Shuffle")}
          secondary
          disabled={disabled || busy}
          onPress={() => {
            const id = String(Math.random());
            onChange({
              color: defaultColor(id),
              avatar: { shape: defaultShape(id) },
            });
          }}
        />
        <Button
          title={tr(busy ? "Loading photo…" : "Upload photo")}
          secondary
          disabled={disabled || busy}
          onPress={photo}
        />
        {onReset && (
          <Button
            title={tr("Reset")}
            secondary
            disabled={disabled || busy}
            onPress={onReset}
          />
        )}
      </View>
      <Notice error text={error} />
    </View>
  );
}
