import React from "react";
import { Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import { BotAvatar } from "./BotAvatar";
import { useTheme } from "../theme";
import type { Bot } from "../types";

export function WorkCapsule({ bot, label, onPress }: {bot?: Bot; label: string; onPress?: () => void}) {
  const t = useTheme();
  return <View style={{alignItems:"center",paddingHorizontal:12,paddingBottom:8}}>
    <Pressable accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={label} onPress={onPress}
      style={{flexDirection:"row",alignItems:"center",gap:8,maxWidth:"100%",minHeight:44,paddingVertical:8,paddingHorizontal:14,borderRadius:999,borderWidth:1,borderColor:t.line,backgroundColor:t.surface}}>
      {bot && <BotAvatar bot={bot} size={22}/>}
      <Text numberOfLines={2} style={{flexShrink:1,fontSize:12,color:t.ink}}>{label}</Text>
    </Pressable>
  </View>;
}
