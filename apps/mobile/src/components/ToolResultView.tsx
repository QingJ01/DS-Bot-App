import { tr } from "../i18n";
import React, { useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ToolActivity } from "@ds-bot/mobile-sdk";
import { shouldShowViewCard, toolDisplay } from "../logic/tool-results";
import { useTheme } from "../theme";
import { Button, Label, Notice, Tag } from "./UI";
import { MarkdownText } from "./MarkdownText";
import { errorText } from "../types";
import { ViewCard } from "./ViewCard";
export function ToolResultView({tool}: {tool:ToolActivity}) {
  const t=useTheme(), display=toolDisplay(tool);
  const [raw,setRaw]=useState(false), [copied,setCopied]=useState(false), [error,setError]=useState("");
  const code={fontFamily:Platform.OS==='ios'?'Menlo':'monospace',fontSize:12,lineHeight:19,color:t.ink};
  const kinds={terminal:tr("Terminal"),file:tr("File"),diff:tr("File changes"),search:tr("Search"),web:tr("Web page"),skill:tr("Skill"),tasks:tr("Tasks"),generic:tr("Tool")};
  if (shouldShowViewCard(tool)) return <ViewCard shown={tool.view} />;
  return <View style={{gap:10,padding:12,borderRadius:12,borderWidth:1,borderColor:tool.isError?t.error:t.line}}>
    <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}><Tag>{kinds[display.kind]}</Tag><Label>{tool.state==='running'?tr("Running"):tool.state==='error'?tr("Failed"):tr("Completed")}</Label></View>
    {tool.durationMs !== undefined && <Label muted>{tr("{seconds}s",{seconds:(tool.durationMs / 1000).toFixed(1)})}</Label>}
    <Label>{tool.name === 'present' || tool.name === 'workspace_changes' ? tr(display.title) : display.title}</Label>{display.metadata ? <Label muted>{tr(display.metadata)}</Label>:null}
    {display.rows?.map((row,index)=><View key={index} style={{gap:4,backgroundColor:row.change==='add'?t.hover:undefined,borderLeftWidth:row.change?3:0,borderColor:row.change==='remove'?t.error:t.accent,padding:row.change?6:0}}>
      <Text selectable style={display.kind==='diff'?code:{color:t.ink,fontSize:14,lineHeight:21}}>{display.kind==='tasks'?(row.done?'☑ ':'☐ '):''}{row.title}</Text>{row.detail?<Label muted>{row.detail}</Label>:null}
      {row.url && /^https?:\/\//i.test(row.url) && <Button compact secondary title={tr("Open source")} onPress={()=>{try{const url=new URL(row.url!);if(url.username || url.password)throw new Error("URLs containing credentials cannot be opened.");void Linking.openURL(url.toString()).catch(err=>setError(errorText(err)));}catch(err){setError(errorText(err));}}}/>}
    </View>)}
    {!!display.body && (['terminal','file','diff'].includes(display.kind)?<ScrollView horizontal><Text selectable style={[code,{color:tool.isError?t.error:t.ink}]}>{display.kind==='file'?display.body.split('\n').map((line,i)=>`${String(i+1).padStart(4)}  ${line}`).join('\n'):display.body}</Text></ScrollView>:<MarkdownText text={display.body}/>)}
    {tool.truncated && <Notice text={tr("This is a redacted partial result.")}/>}
    <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}><Button secondary compact title={copied?tr("Copied"):tr("Copy result")} disabled={!tool.output} onPress={async()=>{try{await Clipboard.setStringAsync(tool.output || '');setCopied(true);}catch(err){setError(errorText(err));}}}/><Button compact secondary title={raw?tr("Hide raw details"):tr("Raw details")} onPress={()=>setRaw(!raw)}/></View>
    {raw && <><Label muted>{tool.name}</Label><Text selectable style={code}>{tool.input}</Text><Text selectable style={code}>{tool.output}</Text></>}
    <Notice error text={error}/>
  </View>;
}
