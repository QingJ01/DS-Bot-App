import { Text } from "./Typography";
import React from "react";
import { ScrollView, View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import { Bot } from "../types";
import { useTheme } from "../theme";
import { tr } from "../i18n";
import { BotAvatar } from "./BotAvatar";
import { Icon, IconButton } from "./UI";
export function MentionMenu({ rows, pick, close }: { rows: { name: string; bot?: Bot }[]; pick: (name: string) => void; close: () => void }) {
  const t=useTheme();
  if (!rows.length) return null;
  return <View style={{ backgroundColor:t.surface, borderWidth:1, borderColor:t.line, borderRadius:20, padding:6 }}>
    <View style={{ flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingLeft:12 }}><Text style={{color:t.muted,fontSize:13}}>{tr("Mention a Bot")}</Text><IconButton name="close" label={tr("Close mentions")} size={44} onPress={close}/></View>
    <ScrollView keyboardShouldPersistTaps="always" style={{maxHeight:192}}>{rows.map(row=><Pressable key={row.bot?.id || "everyone"} accessibilityRole="button" accessibilityLabel={tr("Mention {name}",{name:row.name})} onPress={()=>pick(row.name)} style={({pressed})=>({minHeight:48,paddingHorizontal:12,paddingVertical:6,borderRadius:999,backgroundColor:pressed?t.hover:undefined,flexDirection:"row",alignItems:"center",gap:12})}>
      {row.bot ? <BotAvatar bot={row.bot} size={30}/> : <Icon name="groups" size={30}/>}
      <View style={{flex:1,gap:2}}><Text numberOfLines={1} style={{fontSize:16,color:t.ink}}>{row.name}</Text>{row.bot?.role ? <Text numberOfLines={1} style={{fontSize:12,color:t.muted}}>{row.bot.role}</Text> : null}</View>
    </Pressable>)}</ScrollView>
  </View>;
}
