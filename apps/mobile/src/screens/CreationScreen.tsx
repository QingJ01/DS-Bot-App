import { Text, TextInput } from "../components/Typography";
import React, {useEffect, useState} from 'react';
import {BackHandler, KeyboardAvoidingView, Platform, ScrollView, View} from 'react-native';
import { PageTransition, AnimatedPressable as Pressable } from "../components/Motion";
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MobileClient} from '@ds-bot/mobile-sdk';
import {Bot, Room, TeamState, errorText} from '../types';
import {useI18n} from '../i18n';
import {useTheme} from '../theme';
import {BotAvatar, botColor, characterColors, characterShapes, characters} from '../components/BotAvatar';
import {Button, Field, Icon, IconButton, Notice, Sheet} from '../components/UI';

export function CreationScreen({kind,client,team,online,refresh,openConversation,onClose}:{kind:'bot'|'group';client:MobileClient;team:TeamState;online:boolean;refresh:()=>Promise<void>;openConversation:(id:string)=>void;onClose:()=>void}) {
  const t=useTheme(), {tr}=useI18n(), insets=useSafeAreaInsets();
  const [name,setName]=useState(''), [shape,setShape]=useState('gumdrop'), [color,setColor]=useState('blue');
  const [members,setMembers]=useState<string[]>([]), [admin,setAdmin]=useState(''), [query,setQuery]=useState('');
  const [step,setStep]=useState<'members'|'details'>('members'), [busy,setBusy]=useState(false), [error,setError]=useState(''), [moreCharacters,setMoreCharacters]=useState(false);
  const locked=busy || !online || !!team.readOnly;
  const bot:Bot={id:'',name,color,avatar:{shape}};
  const roster=team.bots.filter(b=>`${b.name} ${b.role || ''}`.toLowerCase().includes(query.toLowerCase()));
  function back(){if(busy)return;if(kind==='group' && step==='details')setStep('members');else onClose();}
  useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{back();return true;});return()=>sub.remove();},[kind,step,onClose,busy]);
  async function create(){
    if(locked || (kind==='bot' ? !name.trim() : members.length<2 || !members.includes(admin)))return;
    setBusy(true);setError('');
    try {
      if(kind==='bot') {
        const model=team.models.find(m=>m.ref===team.defaultModel)?.ref || team.models[0]?.ref;
        const result=await client.action<Bot>('create-bot',{name:name.trim(),role:'',instructions:'',color,avatar:{shape},...(model?{model}:{})});
        await refresh();openConversation(result.id);
      } else {
        const result=await client.action<Room>('create-room',{name:name.trim(),members,admin,greet:true});
        await refresh();openConversation(result.id);
      }
    } catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  const shapes=characterShapes.slice(0,13), colors=characterColors.slice(0,11);
  return <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='web'?undefined:'padding'} keyboardVerticalOffset={insets.top}>
    <View style={{flexDirection:'row',alignItems:'center',gap:18,paddingHorizontal:20,paddingTop:16,paddingBottom:12}}>
      <IconButton name={kind==='group' && step==='details'?'back':'close'} floating label={tr(kind==='group' && step==='details'?'Back':'Close')} onPress={back} disabled={busy}/>
      <Text style={{flex:1,fontSize:21,fontWeight:'600',color:t.ink}}>{tr(kind==='bot'?'Create new Bot':step==='members'?'New group chat':'Group details')}</Text>
      {kind==='group' && step==='members' && <Pressable accessibilityRole="button" accessibilityLabel={tr('Next')} accessibilityState={{disabled:locked || members.length<2}} disabled={locked || members.length<2} onPress={()=>setStep('details')} style={{borderRadius:26,minHeight:50,paddingHorizontal:18,backgroundColor:t.ink,opacity:locked || members.length<2 ? .45 : 1,justifyContent:'center'}}><Text style={{color:t.bg,fontSize:18,fontWeight:'600'}}>{tr('Next')}</Text></Pressable>}
    </View>
    <Notice error text={error}/><Notice text={team.readOnly || (!online?tr('Your host is offline. Settings can be changed when it reconnects.'):'')}/>
    <PageTransition key={step}>
    {kind==='bot' ? <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:18,paddingTop:24,paddingBottom:20,alignItems:'center'}}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr("More characters")} onPress={()=>setMoreCharacters(true)}><BotAvatar bot={bot} size={188}/></Pressable>
        <TextInput accessibilityLabel={tr('Bot name')} placeholder={tr('Give your Bot a name')} placeholderTextColor={t.faint} value={name} onChangeText={setName} maxLength={40} editable={!locked} style={{width:'100%',minHeight:66,marginTop:38,backgroundColor:t.hover,borderRadius:20,color:t.ink,textAlign:'center',fontSize:26,fontWeight:'600',paddingHorizontal:16}}/>
        <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',width:'100%',maxWidth:350,columnGap:19,rowGap:20,marginTop:34}}>
          {shapes.map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={tr('Character {p0}',{p0:String(characters[value].label || value)})} accessibilityState={{selected:shape===value,disabled:locked}} disabled={locked} onPress={()=>setShape(value)} style={{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:24,borderWidth:shape===value?2:0,borderColor:t.lineStrong}}><BotAvatar bot={{...bot,avatar:{shape:value}}} size={40} silhouette/></Pressable>)}
        </View>
        <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',width:'100%',maxWidth:350,gap:8,marginTop:32}}>
          {colors.map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={tr('Color {p0}',{p0:value})} accessibilityState={{selected:color===value,disabled:locked}} disabled={locked} onPress={()=>setColor(value)} style={{width:48,height:48,borderRadius:24,borderWidth:color===value?2:0,borderColor:t.lineStrong,alignItems:'center',justifyContent:'center'}}><View style={{width:32,height:32,borderRadius:16,backgroundColor:botColor({...bot,color:value},t.dark)}}/></Pressable>)}
        </View>

      </ScrollView>
      <View style={{paddingHorizontal:20,paddingTop:12,paddingBottom:14}}><Pressable accessibilityRole="button" accessibilityLabel={tr(busy?'Creating…':'Create')} accessibilityState={{disabled:locked || !name.trim()}} disabled={locked || !name.trim()} onPress={()=>void create()} style={{height:50,borderRadius:25,backgroundColor:t.ink,opacity:locked || !name.trim() ? .45 : 1,alignItems:'center',justifyContent:'center'}}><Text style={{color:t.bg,fontSize:20,fontWeight:'600'}}>{tr(busy?'Creating…':'Create')}</Text></Pressable></View>
    </> : step==='members' ? <>
      <View style={{marginHorizontal:20,marginTop:2,marginBottom:28,borderRadius:26,minHeight:50,borderWidth:1,borderColor:t.line,backgroundColor:t.surface,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16}}><Text style={{fontSize:18,color:t.faint}}>{tr('To:')}</Text><TextInput accessibilityLabel={tr('Search Bots')} placeholder={tr('Search Bots')} placeholderTextColor={t.faint} value={query} onChangeText={setQuery} style={{flex:1,minHeight:48,color:t.ink,fontSize:18}}/></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:20,paddingBottom:32}}>
        {roster.map(item=>{const selected=members.includes(item.id);return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityLabel={tr('Select Bot: {name}',{name:item.name})} accessibilityState={{checked:selected,disabled:locked}} disabled={locked} onPress={()=>{const next=selected?members.filter(id=>id!==item.id):[...members,item.id];setMembers(next);if(!next.includes(admin))setAdmin(next[0] || '');}} style={{flexDirection:'row',alignItems:'center',gap:16,minHeight:64,paddingVertical:12}}><BotAvatar bot={item} size={40}/><Text style={{fontSize:21,color:t.ink,flex:1}}>{item.name}</Text>{selected && <Icon name="check" color={t.accent}/>}</Pressable>})}
        {!roster.length && <Text style={{color:t.muted,fontSize:16,padding:16}}>{tr('No Bots found.')}</Text>}
      </ScrollView>
    </> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:20,gap:24}}>
      <Field label={tr('Group name')} placeholder={tr('Name after members')} value={name} onChangeText={setName} editable={!locked} maxLength={60}/>
      <Text style={{fontSize:18,color:t.ink}}>{tr('Choose an admin')}</Text>
      {team.bots.filter(b=>members.includes(b.id)).map(item=><Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={tr('Choose admin: {name}',{name:item.name})} accessibilityState={{selected:admin===item.id,disabled:locked}} disabled={locked} onPress={()=>setAdmin(item.id)} style={{flexDirection:'row',gap:16,alignItems:'center',minHeight:56}}><BotAvatar bot={item} size={40}/><Text style={{fontSize:20,flex:1,color:t.ink}}>{item.name}</Text>{admin===item.id && <Icon name="check"/>}</Pressable>)}
      <Button title={tr(busy?'Creating…':'Create group')} disabled={locked || members.length<2 || !members.includes(admin)} onPress={()=>void create()}/>
    </ScrollView>}
    <Sheet title={tr('More characters')} visible={moreCharacters} onClose={()=>setMoreCharacters(false)}><View style={{flexDirection:'row',flexWrap:'wrap',gap:14}}>{characterShapes.map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={tr('Character {p0}',{p0:String(characters[value].label || value)})} disabled={locked} onPress={()=>{setShape(value);setMoreCharacters(false);}} style={{width:56,height:56,alignItems:'center',justifyContent:'center'}}><BotAvatar bot={{...bot,avatar:{shape:value}}} size={48}/></Pressable>)}</View></Sheet>
    </PageTransition>
  </KeyboardAvoidingView>;
}
