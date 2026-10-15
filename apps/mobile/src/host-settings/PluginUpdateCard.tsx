import { tr } from "./locale";
import React, { useEffect, useState } from "react";
import { Linking } from "react-native";
import { Button, Card, Label, Notice } from "../components/UI";
import { PanelProps, usePanelAction } from "./shared";

interface HarnessUpdate {current:string|null;verified:string|null;kind:string;phase:string;available:boolean;error?:string|null;installed?:string|null}
interface Update {
  dsh?: HarnessUpdate;
  current: string;
  latest: string | null;
  phase: string;
  available: boolean;
  installed?: string | null;
  error?: string | null;
  notesUrl?: string;
  latestRef?: string | null;
  currentRevision?: number | null;
  targetId?: string | null;
  canRepair?: boolean;
  restartRequired?: boolean;
  checkError?: string | null;
  blockedReason?: string | null;
}
export function PluginUpdateCard(props: PanelProps) {
  const action = usePanelAction(props);
  const [status, setStatus] = useState<Update | null>(null);
  const [confirm, setConfirm] = useState<"bot"|"repair"|"dsh"|null>(null);
  const [chosenTarget, setChosenTarget] = useState<{id?: string | null; label: string}>({label:""});
  const [restartNotice, setRestartNotice] = useState(false);
  async function check(fresh = false) {
    setStatus(await props.client.action<Update>("update-check", { fresh }));
  }
  useEffect(() => { if(props.online)void action.run(()=>check()); },[props.client,props.online]);
  useEffect(() => {
    if (!props.online || (status?.phase !== "installing" && status?.dsh?.phase !== "installing")) return;
    const timer = setTimeout(() => {
      void action.run(() => check());
    }, 3000);
    return () => clearTimeout(timer);
  }, [props.client, props.online, status]);
  const blocked =
    !props.online || action.busy || (status?.phase === "installing" || status?.dsh?.phase === "installing");
  return (
    <Card>
      <Label>{tr("DS Bot host plugin")}</Label>
      <Label muted>
        {tr(
          "This updates the plugin installed in Harness. It does not update this mobile app.",
        )}
      </Label>
      <Notice error text={action.error ? tr(action.error) : status?.error ? tr(status.error) : status?.checkError ? tr(status.checkError) : status?.dsh?.error || undefined} />
      {status?.blockedReason && <Notice text={tr(status.blockedReason)}/>}
      <Label muted>{tr("Updates come from this project’s releases. Your team and conversations are kept.")}</Label>
      {status && (
        <Label muted>
          {tr("Installed:")}
          {status.current}{status.currentRevision ? ` · r${status.currentRevision}` : ""}
          {status.latest ? tr(" · Latest: {p0}", { p0: String(status.latestRef || status.latest) }) : ""}
        </Label>
      )}
      {status?.dsh?.current && <Label muted>{tr("Harness installed: {version}",{version:status.dsh.current})}{status.dsh.verified ? tr(" · Verified: {version}",{version:status.dsh.verified}) : ""}</Label>}
      {(status?.phase === "installing" || status?.dsh?.phase === "installing") && (
        <Notice
          text={tr(
            "Installing on the host… The connection may briefly restart.",
          )}
        />
      )}
      {status?.phase === "installed" && (
        <Notice
          text={status.restartRequired ? tr("Restart Harness on your computer to finish the plugin update.") : tr("Plugin update installed. Reconnect if the host connection closed.")}
        />
      )}
      {restartNotice && status?.phase !== "failed" && (
        <Notice
          text={tr(
            "If the host disconnects during the update, wait for Harness to restart and reconnect.",
          )}
        />
      )}
      <Button
        title={action.busy ? tr("Checking…") : tr("Check for updates")}
        secondary
        disabled={blocked}
        onPress={() => action.run(() => check(true))}
      />
      {status?.notesUrl && (
        <Button
          title={tr("Release notes")}
          secondary
          onPress={() =>
            action.run(async () => {
              const url = new URL(status.notesUrl!);
              if (
                url.protocol !== "https:" ||
                url.hostname !== "github.com" ||
                url.username ||
                url.password
              )
                throw new Error(
                  tr("The host returned an unsupported release address."),
                );
              await Linking.openURL(url.href);
            })
          }
        />
      )}
      {status?.available && (
        <Button
          title={tr(status.phase === "failed" ? "Try again" : "Update host plugin")}
          disabled={blocked}
          onPress={() => {setChosenTarget({id:status.targetId,label:status.latestRef || status.latest || ""});setConfirm("bot");}}
        />
      )}
      {status?.canRepair && !status.available && status.phase !== "installed" && <Button title={tr("Repair installation")} secondary disabled={blocked}
        onPress={()=>{setChosenTarget({id:status.targetId,label:status.latestRef || status.latest || ""});setConfirm("repair");}}/>}
      {status?.dsh?.available && status.dsh.kind === "npm" && <Button title={tr("Update Harness on host")} disabled={blocked} onPress={()=>setConfirm("dsh")}/>}
      {status?.dsh?.available && status.dsh.kind !== "npm" && <Notice text={tr("Use the Desktop app’s updater for the verified Harness version.")}/>}
      {confirm && (
        <>
          <Notice
            text={confirm === "dsh" ? tr("Install Harness {version} on your host? The connection may restart.",{version:status?.dsh?.verified || ""}) : confirm === "repair" ? tr("Reinstall DS Bot {version} from the latest release?",{version:chosenTarget.label}) : tr("Install DS Bot {p0} on your host? This may restart the plugin and interrupt the phone connection.", { p0: chosenTarget.label })}
          />
          <Button
            title={tr("Install update")}
            disabled={blocked}
            onPress={() =>
              action.run(async () => {
                setConfirm(null);
                setRestartNotice(true);
                if(confirm === "dsh") {
                  const dsh=await props.client.action<HarnessUpdate>("dsh-update-install",{});
                  setStatus(previous=>previous ? {...previous,dsh} : previous);
                } else setStatus(await props.client.action<Update>("update-install", {targetId:chosenTarget.id,repair:confirm === "repair"}));
              })
            }
          />
          <Button
            title={tr("Cancel")}
            secondary
            disabled={action.busy}
            onPress={() => setConfirm(null)}
          />
        </>
      )}
    </Card>
  );
}
