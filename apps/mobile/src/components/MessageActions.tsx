import { Text } from "./Typography";
import React from 'react';
import {Modal, ScrollView, View} from 'react-native';
import { AnimatedPressable as Pressable } from "./Motion";
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {tr} from '../i18n';
import {Icon, IconButton, IconName, Notice} from './UI';

export const REACTIONS=['👍','❤️','😂','😮','😢','🙏'];
export type MessageAction={label:string;icon:IconName;disabled?:boolean;onPress:()=>void};

export function MessageActions({visible,author,preview,reactions,allowReactions,actions,onReact,onClose,onDismiss,error}:{
  error?:string;visible:boolean;author:string;preview:string;reactions:string[];allowReactions:boolean;actions:MessageAction[];onReact:(emoji:string)=>void;onClose:()=>void;onDismiss:()=>void;
}) {
  const t=useTheme(), insets=useSafeAreaInsets();
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
    <View style={{flex:1,justifyContent:'flex-end'}}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('Close message actions')} onPress={onClose} style={{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:t.dark?'#000a':'#0005'}}/>
      <View accessibilityViewIsModal style={{backgroundColor:t.surface,borderTopLeftRadius:28,borderTopRightRadius:28,maxHeight:'80%',paddingHorizontal:18,paddingBottom:insets.bottom+18,paddingTop:8,borderWidth:1,borderColor:t.line}}>
        <View accessible={false} style={{alignSelf:'center',width:34,height:4,borderRadius:2,backgroundColor:t.lineStrong,marginVertical:6}}/>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text accessibilityRole="header" style={{color:t.ink,fontSize:18,fontWeight:'600'}}>{tr('Message actions')}</Text><IconButton name="close" label={tr('Close message actions')} onPress={onClose} size={44}/></View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{flexShrink:1}} contentContainerStyle={{gap:12,paddingTop:4}}>
          {allowReactions && <View accessibilityLabel={tr('Reactions')} style={{flexDirection:'row',justifyContent:'space-between',backgroundColor:t.hover,borderRadius:24,padding:4}}>{REACTIONS.map(emoji=><Pressable key={emoji} accessibilityRole="button" accessibilityLabel={tr('React with {emoji}',{emoji})} accessibilityState={{selected:reactions.includes(emoji)}} onPress={()=>onReact(emoji)} style={({pressed})=>({flex:1,minHeight:44,minWidth:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:reactions.includes(emoji)?t.soft:pressed?t.active:undefined,borderWidth:reactions.includes(emoji)?1:0,borderColor:t.accent})}><Text style={{fontSize:25}}>{emoji}</Text></Pressable>)}</View>}
          <View style={{paddingHorizontal:12,paddingVertical:10,borderLeftWidth:3,borderColor:t.lineStrong,gap:3}}><Text numberOfLines={1} style={{fontSize:12,color:t.muted}}>{author}</Text><Text numberOfLines={2} style={{color:t.ink,fontSize:14,lineHeight:20}}>{preview || tr('Attachment message')}</Text></View>
          <Notice error text={error}/>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{actions.map(action=><Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} accessibilityState={{disabled:!!action.disabled}} disabled={action.disabled} onPress={action.onPress} style={({pressed})=>({width:'48.5%',flexGrow:1,minHeight:54,paddingHorizontal:14,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:10,borderRadius:16,backgroundColor:pressed?t.active:t.hover,opacity:action.disabled ? .4 : 1})}><Icon name={action.icon} size={20}/><Text style={{color:t.ink,fontSize:15,flexShrink:1,lineHeight:21}}>{action.label}</Text></Pressable>)}</View>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
