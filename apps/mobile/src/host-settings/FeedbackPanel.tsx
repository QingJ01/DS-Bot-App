import { Text } from "../components/Typography";
import { dateLocale } from "../i18n";
import { tr } from "./locale";
import React, { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Button, Card, Field, Label, Notice } from "../components/UI";
import { useTheme } from "../theme";
import { PanelProps, usePanelAction } from "./shared";

interface Report {
  markdown: string;
  issuesUrl: string;
  total: number;
  entries: Array<{ time: number; text: string; source: string; code?: string }>;
}

export function FeedbackPanel(props: PanelProps) {
  const t = useTheme();
  const action = usePanelAction(props);
  const [report, setReport] = useState<Report | null>(null);
  const [what, setWhat] = useState("");
  const [preview, setPreview] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  async function load() {
    const next = await props.client.action<Report>("diagnostics", {
      client: {
        surface: `DS Bot Mobile ${Platform.OS}`,
        language: Intl.DateTimeFormat().resolvedOptions().locale,
        userAgent: `React Native ${String(Platform.Version)}`,
      },
      clientErrors: [],
    });
    setReport(next);
    return next;
  }
  useEffect(() => {
    if (props.online) void action.run(load);
  }, [props.client, props.online]);
  const blocked = !props.online || action.busy;
  async function download() {
    const text = await props.client.action<string>("diagnostics-log", {});
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(
        new Blob([text || tr("No entries.\n")], { type: "text/plain" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "ds-bot-diagnostics.log";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      const file = new File(
        Paths.cache,
        `ds-bot-diagnostics-${Date.now()}.log`,
      );
      try {
        file.write(text || tr("No entries.\n"));
        if (await Sharing.isAvailableAsync())
          await Sharing.shareAsync(file.uri, { mimeType: "text/plain" });
        else
          throw new Error(
            tr(
              "File sharing is unavailable on this device. Copy the diagnostics instead.",
            ),
          );
      } finally {
        if (file.exists) file.delete();
      }
    }
  }
  return (
    <View style={{ gap: 16 }}>
      <Notice error text={action.error} />
      <Notice text={action.notice} />
      <Card>
        <Label>{tr("Report a problem")}</Label>
        <Field
          label={tr("What happened?")}
          value={what}
          onChangeText={setWhat}
          multiline
          maxLength={2000}
          placeholder={tr("What were you doing, and what did you expect?")}
        />
        <Label muted>
          {tr(
            "Review the diagnostics before sharing. Nothing is sent to GitHub automatically.",
          )}
        </Label>
        <Button
          title={preview ? tr("Hide diagnostics") : tr("Preview diagnostics")}
          secondary
          disabled={blocked}
          onPress={() =>
            action.run(async () => {
              await load();
              setPreview((value) => !value);
            })
          }
        />
        {preview && report && (
          <Text
            selectable
            style={{
              color: t.ink,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              fontSize: 12,
              lineHeight: 19,
            }}
          >
            {report.markdown}
          </Text>
        )}
        <Button
          title={tr("Copy diagnostics")}
          secondary
          disabled={blocked}
          onPress={() =>
            action.run(async () => {
              const next = await load();
              await Clipboard.setStringAsync(next.markdown);
              action.setNotice(
                tr(
                  "Copied the diagnostics. Review them before pasting into an issue.",
                ),
              );
            })
          }
        />
        <Button
          title={tr("Open a GitHub issue")}
          disabled={blocked}
          onPress={() =>
            action.run(async () => {
              const next = await load();
              const address = new URL(next.issuesUrl);
              if (
                address.protocol !== "https:" ||
                address.hostname !== "github.com" ||
                address.username ||
                address.password
              )
                throw new Error(
                  tr("The host returned an unsupported issue address."),
                );
              address.searchParams.set("template", "bug.yml");
              if (what.trim()) {
                address.searchParams.set(
                  "title",
                  what.trim().split("\n")[0].slice(0, 80),
                );
                address.searchParams.set("what", what.trim());
              }
              // Diagnostics remain local until the user explicitly copies and pastes.
              await Linking.openURL(address.href);
              action.setNotice(
                tr(
                  "Opened an issue draft. Copy the diagnostics if you want to include them, then review before submitting.",
                ),
              );
            })
          }
        />
      </Card>
      <Card>
        <Label>
          {tr("Recent errors")}
          {report ? ` · ${report.total}` : ""}
        </Label>
        {!report && (
          <Notice
            text={
              props.online
                ? tr("Load diagnostics to see recent host errors.")
                : tr("Reconnect to read host diagnostics.")
            }
          />
        )}
        {report?.entries.length === 0 && (
          <Label muted>{tr("No errors recorded.")}</Label>
        )}
        {report?.entries.slice(0, 8).map((entry, index) => (
          <View key={`${entry.time}:${index}`} style={{ gap: 4 }}>
            <Text style={{ color: t.muted, fontSize: 12 }}>
              {new Date(entry.time).toLocaleString(dateLocale())} · {entry.source}
              {entry.code ? ` · ${entry.code}` : ""}
            </Text>
            <Text selectable style={{ color: t.ink, lineHeight: 21 }}>
              {entry.text}
            </Text>
          </View>
        ))}
        <Button
          title={tr("Refresh diagnostics")}
          secondary
          disabled={blocked}
          onPress={() => action.run(load)}
        />
        <Button
          title={tr("Download error log")}
          secondary
          disabled={blocked}
          onPress={() => action.run(download)}
        />
        <Button
          title={tr("Clear error log")}
          secondary
          danger
          disabled={blocked || !report?.total}
          onPress={() => setConfirmClear(true)}
        />
        {confirmClear && (
          <>
            <Notice
              text={tr(
                "Clear the host diagnostic error log? This does not remove conversations.",
              )}
            />
            <Button
              title={tr("Confirm clear")}
              danger
              disabled={blocked}
              onPress={() =>
                action.run(async () => {
                  await props.client.action("diagnostics-clear", {});
                  setConfirmClear(false);
                  await load();
                  action.setNotice(tr("Cleared the error log."));
                })
              }
            />
            <Button
              title={tr("Cancel")}
              secondary
              disabled={action.busy}
              onPress={() => setConfirmClear(false)}
            />
          </>
        )}
      </Card>
    </View>
  );
}
