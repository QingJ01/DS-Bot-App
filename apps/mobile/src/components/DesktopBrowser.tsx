import { Text } from "./Typography";
import { tr } from "../i18n";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { MobileClient } from "@ds-bot/mobile-sdk";
import { Button, Card, Field, Label, Notice, Sheet } from "./UI";
import { useTransientSecret } from "../host-settings/shared";
import { errorText } from "../types";
interface Control { item: number; role: string; name: string; disabled: boolean; editable: boolean }
interface Page { tabId?: string; snapshotId?: string; title?: string; text?: string; controls?: Control[] }
interface Browser { botId: string; mobileControl: boolean; active: string; tabs: {id:string;title:string;url:string}[] }
export function DesktopBrowser({client,botId,online}: {client:MobileClient;botId:string;online:boolean}) {
  const [available,setAvailable]=useState<boolean | null>(null);
  const [browser,setBrowser]=useState<Browser | null>(null);
  const [page,setPage]=useState<Page | null>(null);
  const [url,setUrl]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [field,setField]=useState<Control | null>(null);
  const [text,setText]=useTransientSecret();
  const [click,setClick]=useState<Control | null>(null);
  async function load(){const value=await client.action<{available:boolean;pages:Browser[]}>("browser-pages",{});setAvailable(value.available);setBrowser(value.pages.find(item=>item.botId===botId)||null);}
  useEffect(()=>{if(online)void load().catch(err=>setError(errorText(err)));setPage(null);},[client,botId,online]);
  async function command(command:string,payload:Record<string,unknown>={}){
    if(busy || !online)return;setBusy(true);setError("");
    const requestId=Crypto.randomUUID();
    try{const value=await client.action<{page:Page}>("browser-control",{botId,command,tabId:browser?.active,requestId,...payload});setPage(command==="snapshot" ? value.page : null);setClick(null);setField(null);setText("");await load();}
    catch(err){setPage(null);setError(errorText(err));}
    finally{setBusy(false);}
  }
  const disabled=!online || busy || !browser?.mobileControl;
  return <View style={{gap:12}}><Label muted>{tr("Control this Bot's desktop browser. Its login sessions stay on your computer.")}</Label>
    <Notice error text={error}/>{error && <Notice text={tr(" The action may have completed. Read the current state before continuing.")}/>}{available === false ? <Notice text={tr("Browser control is unavailable on this host. Enable the browser service in DSH Desktop first.")}/> : available === true && !browser ? <Notice text={tr("Open this Bot’s browser in DSH Desktop to connect it.")}/> : browser && !browser.mobileControl ? <Notice text={tr("Allow mobile control in this Bot’s desktop browser window.")}/> : null}
    <Button secondary title={tr("Refresh tabs")} disabled={!online || busy} onPress={()=>load().catch(err=>setError(errorText(err)))}/>
    {browser?.tabs.map(tab=><Card key={tab.id}><Label>{tab.title || tr("New tab")}</Label><Label muted>{tab.url}</Label><View style={{flexDirection:"row",gap:8}}><Button compact secondary title={tab.id===browser.active ? tr("Current tab") : tr("Switch tab")} disabled={disabled || tab.id===browser.active} onPress={()=>command("activate",{tabId:tab.id})}/><Button compact secondary danger title={tr("Close tab")} disabled={disabled} onPress={()=>command("close",{tabId:tab.id})}/></View></Card>)}
    <Field label={tr("URL")} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" maxLength={2000}/>
    <View style={{flexDirection:"row",gap:8,flexWrap:"wrap"}}><Button compact title={tr("Open URL")} disabled={disabled || !url.trim()} onPress={()=>command("navigate",{url:url.trim()})}/><Button compact secondary title={tr("New tab")} disabled={disabled} onPress={()=>command("new-tab",url.trim()?{url:url.trim()}:{})}/>{[ ["back",tr("Go back")],["forward",tr("Go forward")],["reload",tr("Refresh")],["stop",tr("Stop")] ].map(([value,label])=><Button key={value} compact secondary title={label} disabled={disabled} onPress={()=>command(value)}/>)}</View>
    <Button title={tr("Read current page")} disabled={disabled} onPress={()=>command("snapshot")}/>
    {!!page?.snapshotId && <><Label large>{page.title}</Label><Label>{page.text}</Label><View style={{flexDirection:"row",gap:8}}><Button secondary title={tr("Scroll up")} disabled={disabled} onPress={()=>command("scroll",{direction:"up"})}/><Button secondary title={tr("Scroll down")} disabled={disabled} onPress={()=>command("scroll",{direction:"down"})}/></View><Label>{tr("Page controls")}</Label>
    {page.controls?.map(control=><Card key={control.item}><Label>{control.name || control.role}</Label><Label muted>{control.role}</Label><Button secondary title={control.editable ? tr("Enter text") : tr("Click")} disabled={disabled || control.disabled} onPress={()=>control.editable ? (setText(""),setField(control)) : setClick(control)}/></Card>)}</>}
    <Sheet title={tr("Enter page text")} visible={!!field} onClose={()=>{setField(null);setText("");}}><Label>{field?.name}</Label><Field label={tr("Text")} value={text} onChangeText={setText} multiline maxLength={8000}/><Button title={tr("Fill on desktop")} disabled={disabled || !page?.snapshotId} onPress={()=>command("fill",{snapshotId:page?.snapshotId,tabId:page?.tabId,item:field?.item,text})}/></Sheet>
    <Sheet title={tr("Confirm click")} visible={!!click} onClose={()=>setClick(null)}><Label>{tr("Click “{name}” on the desktop page?",{name:click?.name || click?.role || ""})}</Label><Button title={tr("Confirm click")} disabled={disabled || !page?.snapshotId} onPress={()=>command("click",{snapshotId:page?.snapshotId,tabId:page?.tabId,item:click?.item})}/></Sheet>
  </View>;
}
