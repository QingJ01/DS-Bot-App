import { Text } from "./Typography";
import { tr } from "../i18n";
import React, { useId, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, AppState, Animated, Image, Platform, View } from "react-native";
import Svg, {
  Defs,
  G,
  LinearGradient,
  Mask,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import data from "./characterData.json";
import { Bot, Room, TeamState } from "../types";
import { useTheme } from "../theme";
import { BRAND_BLUE } from "../logic/colors";

// Source artwork: ds-bot/src/client/characters.js, DS Bot's original characters.
type Character = {
  body: string;
  shade: string;
  light: string;
  eyes: number[][];
  paints?: (string | number)[][];
  label?: string;
};
export const characters = data.characters as Record<string, Character>;
export const characterShapes = data.shapes;
export const characterColors = data.colors;
export const inks = data.inks as Record<string, string[]>;
export const mainLook = {
  id: "ds-bot",
  name: "DS Bot",
  color: BRAND_BLUE,
  avatar: { shape: "whale" },
};
function hash(id: string) {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++)
    value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return value >>> 0;
}
export function defaultColor(id: string) {
  const t = (hash(id) + 1831565813) | 0;
  let n = Math.imul(t ^ (t >>> 15), 1 | t);
  n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
  return data.defaultColors[
    Math.floor(
      (((n ^ (n >>> 14)) >>> 0) / 4294967296) * data.defaultColors.length,
    )
  ];
}
export function defaultShape(id: string) {
  let value = hash(id) | 0;
  value = Math.imul(value ^ (value >>> 16), 73244475);
  value = Math.imul(value ^ (value >>> 13), 3266489909);
  return data.defaultShapes[
    ((value ^ (value >>> 16)) >>> 0) % data.defaultShapes.length
  ];
}
export function botColor(bot: Pick<Bot, "id" | "color">, dark = false) {
  const key = bot.color || defaultColor(bot.id);
  if (key === "deepseek" || key === "blue") return BRAND_BLUE;
  return /^#[0-9a-f]{6}$/i.test(key)
    ? key
    : (inks[key] || inks.gray)[dark ? 1 : 0];
}
export function BotAvatar({
  bot,
  size = 36,
  main = false,
  admin = false,
  live = false,
  silhouette = false,
  blink: controlledBlink,
  animate = true,
  eyeFill,
}: {
  bot: Pick<Bot, "id" | "name" | "color" | "avatar">;
  size?: number;
  main?: boolean;
  admin?: boolean;
  live?: boolean;
  silhouette?: boolean;
  blink?: boolean;
  animate?: boolean;
  eyeFill?: string;
}) {
  const t = useTheme();
  const uid = `avatar${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const shape =
    characters[bot.avatar?.shape || ""] ||
    characters[bot.id ? defaultShape(bot.id) : "gumdrop"];
  const color = bot.color || (bot.id ? defaultColor(bot.id) : "black");
  const photo = bot.avatar?.image;
  const bob = useRef(new Animated.Value(0)).current;
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [autoBlink, setBlink] = useState(false);
  const blink = controlledBlink ?? autoBlink;
  const pet = useRef(new Animated.Value(0)).current;
  useEffect(() => { const subscription = AppState.addEventListener("change", state => setForeground(state === "active")); return () => subscription.remove(); }, []);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduceMotion(value);
    });
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    bob.setValue(0);
    if (!animate || !foreground || reduceMotion || t.motion === "quiet" || (!main && !live)) return;
    const duration = t.motion === "lively" ? 900 : 1600;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration,
          useNativeDriver: Platform.OS !== "web",
          isInteraction: false,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration,
          useNativeDriver: Platform.OS !== "web",
          isInteraction: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, reduceMotion, t.motion, main, live, foreground, animate]);

  useEffect(() => {
    setBlink(false);
    if (!animate || controlledBlink !== undefined || !foreground || reduceMotion || t.motion === "quiet") return;
    let reopen: ReturnType<typeof setTimeout>;
    const timer = setInterval(() => { setBlink(true); reopen = setTimeout(() => setBlink(false), 140); }, 3800 + hash(bot.id) % 2400);
    return () => { clearInterval(timer); clearTimeout(reopen); };
  }, [foreground, reduceMotion, t.motion, bot.id, animate, controlledBlink]);
  useEffect(() => { if (!foreground) { pet.stopAnimation(); pet.setValue(0); } }, [foreground, pet]);
  function reactToTouch() {
    if (!animate || !foreground || reduceMotion || t.motion === "quiet") return;
    pet.stopAnimation(); pet.setValue(0);
    Animated.sequence([Animated.timing(pet, {toValue:1,duration:120,useNativeDriver:Platform.OS!=="web"}),Animated.spring(pet,{toValue:0,useNativeDriver:Platform.OS!=="web",friction:4})]).start();
  }

  return (
    <View
      onTouchStart={reactToTouch}
      accessibilityLabel={`${bot.name}${main ? tr(", Main Bot") : admin ? tr(", Admin") : ""}`}
      style={{ width: size, height: size }}
    >
      <Animated.View
        style={{
          transform: [
            { scale: pet.interpolate({inputRange:[0,1],outputRange:[1,1.1]}) },
            { rotate: pet.interpolate({inputRange:[0,1],outputRange:["0deg","-8deg"]}) },
            {
              translateY: bob.interpolate({
                inputRange: [0, 1],
                outputRange: [0, t.motion === "lively" ? -2.5 : -1.2],
              }),
            },
          ],
        }}
      >
        {photo && /^data:image\/(png|jpeg|webp|gif);base64,/.test(photo) ? (
          <Image
            source={{ uri: photo }}
            style={{ width: size, height: size, borderRadius: size * 0.24 }}
          />
        ) : (
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Defs>
              <Mask
                id={uid}
                x="-100"
                y="-100"
                width="300"
                height="300"
                maskUnits="userSpaceOnUse"
              >
                <Rect x="-100" y="-100" width="300" height="300" fill="white" />
                {(silhouette ? [] : shape.eyes).map(([cx, cy, width, height, tilt], index) => (
                  <G
                    key={index}
                    transform={`translate(${cx} ${cy}) rotate(${tilt})`}
                  >
                    <Rect
                      x={-width / 2}
                      y={-(blink ? Math.max(1.5, height * 0.08) : height) / 2}
                      width={width}
                      height={blink ? Math.max(1.5, height * 0.08) : height}
                      rx={width / 2}
                      fill="black"
                    />
                  </G>
                ))}
              </Mask>
              {color === "aurora" && (
                <LinearGradient
                  id={`${uid}g`}
                  x1="18"
                  y1="10"
                  x2="78"
                  y2="92"
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop offset="0" stopColor="#A4FFB0" />
                  <Stop offset=".42" stopColor="#00F0E4" />
                  <Stop offset="1" stopColor="#2E9EF7" />
                </LinearGradient>
              )}
            </Defs>
            {eyeFill && !silhouette && shape.eyes.map(([cx, cy, width, height, tilt], index) => <G key={index} transform={`translate(${cx} ${cy}) rotate(${tilt})`}><Rect x={-width / 2} y={-(blink ? Math.max(1.5, height * 0.08) : height) / 2} width={width} height={blink ? Math.max(1.5, height * 0.08) : height} rx={width / 2} fill={eyeFill}/></G>)}
            <G mask={`url(#${uid})`} fillRule="evenodd">
              <Path
                d={shape.body}
                fill={
                  color === "aurora" ? `url(#${uid}g)` : botColor(bot, t.dark)
                }
              />
              {(!silhouette ? shape.paints : [])?.map(([path, fill, opacity], i) => (
                <Path
                  key={i}
                  d={String(path)}
                  fill={String(fill)}
                  opacity={Number(opacity)}
                />
              ))}
              <Path d={shape.shade} fill="black" opacity={0.14} />
              <Path d={shape.light} fill="white" opacity={0.16} />
            </G>
          </Svg>
        )}
      </Animated.View>
      {(main || admin) && (
        <View
          style={{
            position: "absolute",
            right: -3,
            bottom: -2,
            width: main ? size * 0.36 : size * 0.3,
            height: main ? size * 0.36 : size * 0.3,
            backgroundColor: admin && !main ? t.surface : undefined,
            borderRadius: 99,
          }}
        >
          <Svg viewBox="0 0 20 20" width="100%" height="100%">
            <Path
              d="M10 2.4l2.29 5.04 5.51.63-4.09 3.74 1.11 5.42L10 14.5l-4.82 2.73 1.11-5.42L2.2 8.07l5.51-.63z"
              fill={main ? "#e2a227" : t.muted}
              stroke={main ? t.surface : "none"}
              strokeWidth={1}
            />
          </Svg>
        </View>
      )}
      {live && (
        <View
          style={{
            position: "absolute",
            width: 8,
            height: 8,
            borderRadius: 4,
            bottom: 0,
            left: 0,
            backgroundColor: t.accent,
            borderWidth: 1.5,
            borderColor: t.surface,
          }}
        />
      )}
    </View>
  );
}
export function RoomAvatar({
  room,
  team,
  size = 36,
}: {
  room: Room;
  team: Pick<TeamState, "bots">;
  size?: number;
}) {
  const t = useTheme();
  const members = room.members
    .map((id) => team.bots.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => !!bot);
  const count = Math.max(2, Math.min(4, members.length));
  const positions =
    count === 2
      ? [
          [0, 0],
          [0.34, 0.34],
        ]
      : count === 3
        ? [
            [0.23, 0],
            [0, 0.44],
            [0.45, 0.44],
          ]
        : [
            [0, 0],
            [0.5, 0],
            [0, 0.5],
            [0.5, 0.5],
          ];
  const ratio = count === 2 ? 0.66 : count === 3 ? 0.55 : 0.5;
  return (
    <View accessibilityLabel={room.name} style={{ width: size, height: size }}>
      {positions.map(([left, top], index) => (
        <View
          key={index}
          style={{ position: "absolute", left: size * left, top: size * top }}
        >
          {index === 3 && members.length > 4 ? (
            <Text
              style={{
                width: size / 2,
                height: size / 2,
                textAlign: "center",
                color: t.muted,
                fontSize: size * 0.2,
              }}
            >
              +{members.length - 3}
            </Text>
          ) : members[index] ? (
            <BotAvatar bot={members[index]} size={size * ratio} />
          ) : (
            <View
              style={{
                width: size * ratio,
                height: size * ratio,
                borderRadius: size,
                backgroundColor: t.lineStrong,
              }}
            />
          )}
        </View>
      ))}
    </View>
  );
}
