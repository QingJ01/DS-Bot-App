import { Text } from "../components/Typography";
import { createMobileClient } from "../network/client";
import { tr } from "../i18n";
import { useI18n } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Switch, View } from "react-native";
import { BotAvatar, mainLook } from "../components/BotAvatar";
import { PairingScanner } from "../components/PairingScanner";
import { MobileClient, validateServerUrl } from "@ds-bot/mobile-sdk";
import {
  Button,
  Card,
  Field,
  Label,
  Notice,
  Sheet,
  styles,
} from "../components/UI";
import { cache, Host, tokenStore } from "../storage";
import { useTheme } from "../theme";
export function PairingScreen({
  onConnected,
}: {
  onConnected: (host: Host, client: MobileClient) => Promise<void>;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const [raw, setRaw] = useState("");
  const [device, setDevice] = useState(
    Platform.OS === "web"
      ? "Browser preview"
      : `My ${Platform.OS === "ios" ? "iPhone" : "Android"}`,
  );
  const [insecure, setInsecure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef(0);
  const pairingActive = useRef(false);
  const clientRef = useRef<MobileClient | null>(null);
  useEffect(
    () => () => {
      attempt.current++;
      clientRef.current?.dispose();
    },
    [],
  );
  async function pair(input = raw) {
    if (pairingActive.current) return;
    pairingActive.current = true;
    clientRef.current?.dispose();
    setError("");
    setBusy(true);
    const run = ++attempt.current;
    try {
      const data = JSON.parse(input.trim()) as {
        url?: string;
        code?: string;
        serverId?: string;
        tlsPin?: string;
      };
      if (!data.url || !data.code || !data.serverId || !device.trim())
        throw new Error(
          "Paste the complete pairing JSON from your host and enter a device name.",
        );
      const url = validateServerUrl(data.url, {
        allowInsecure: __DEV__ && insecure,
      });
      const client = createMobileClient({
        baseUrl: url,
        tlsPin: data.tlsPin,
        tokenStore,
        cache,
        allowInsecure: __DEV__ && insecure,
      });
      clientRef.current = client;
      const info = await client.info();
      if (info.serverId !== data.serverId)
        throw new Error(
          "The server identity does not match this pairing code. Generate a new code on your host.",
        );
      const pairing = await client.pair(data.code, device.trim());
      setRaw("");
      setStatus("Waiting for approval on your computer…");
      const deadline = Date.now() + 120000;
      while (attempt.current === run && Date.now() < deadline) {
        const result = await client.completePairing(pairing.claimToken);
        if (attempt.current !== run) return;
        if ("accessToken" in result) {
          clientRef.current = null;
          await onConnected(
            {
              url,
              tlsPin: client.tlsPin,
              serverId: info.serverId,
              name: info.name || "My DSH host",
              allowInsecure: __DEV__ && insecure,
            },
            client,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (attempt.current === run)
        throw new Error(
          "Pairing expired. Generate a new code on your computer.",
        );
    } catch (err) {
      if (attempt.current === run)
        setError(
          err instanceof SyntaxError
            ? "This is not valid pairing JSON. Copy the complete code shown on your host."
            : err instanceof Error
              ? err.message
              : "Pairing failed.",
        );
    } finally {
      if (attempt.current === run) {
        pairingActive.current = false;
        setBusy(false);
        setStatus("");
      }
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.page,
        {
          flexGrow: 1,
          justifyContent: "center",
          maxWidth: 560,
          width: "100%",
          alignSelf: "center",
          paddingVertical: 42,
        },
      ]}
    >
      <View style={{ alignItems: "center", gap: 12, paddingBottom: 12 }}>
        <BotAvatar bot={mainLook} size={72} />
        <Text style={{ color: t.ink, fontSize: 28, fontWeight: "600" }}>
          {tr("DS Bot")}</Text>
        <Label muted>{tr("Connect to your Bot team.")}</Label>
      </View>
      {Platform.OS === "web" && (
        <Notice
          text={tr(
            "Browser development preview. Device credentials stay in this tab's memory. Use the iOS or Android app for everyday access.",
          )}
        />
      )}
      <Card>
        <Label>{tr("Connect your host")}</Label>
        <Label muted>
          {tr(
            "On your computer, open Settings → Mobile devices, choose a reachable IPv4 or IPv6 address, and enable phone connection. Scan the code, then approve your phone on the computer.",
          )}
        </Label>
        <Label muted>
          {tr("Public IPv6 also works across networks when your phone supports IPv6 and both firewalls allow the connection.")}
        </Label>
        <PairingScanner disabled={busy} onScan={(text) => { setRaw(text); void pair(text); }} />
        <Field
          label={tr("Pairing JSON")}
          value={raw}
          onChangeText={setRaw}
          multiline
          numberOfLines={3}
          placeholder={'{"url":"https://your-host…","code":"…","serverId":"…"}'}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <Field
          label={tr("Device name")}
          value={device}
          onChangeText={setDevice}
          maxLength={80}
          editable={!busy}
        />
        {__DEV__ && (
          <View style={styles.between}>
            <View style={{ flex: 1 }}>
              <Label muted>{tr("Local development HTTP")}</Label>
              <Text style={{ color: t.muted, fontSize: 11 }}>
                {tr("Loopback only. HTTPS is required on a real host.")}
              </Text>
            </View>
            <Switch
              accessibilityLabel={tr("Allow development loopback HTTP")}
              disabled={busy}
              value={insecure}
              onValueChange={setInsecure}
            />
          </View>
        )}
        <Notice error text={tr(error)} />
        <Notice text={tr(status)} />
        <Button
          title={busy ? tr("Waiting for host…") : tr("Connect to my host")}
          disabled={busy || !raw.trim() || !device.trim()}
          onPress={() => void pair()}
        />
        {busy && (
          <Button
            title={tr("Cancel pairing")}
            secondary
            onPress={() => {
              attempt.current++;
              pairingActive.current = false;
              clientRef.current?.dispose();
              clientRef.current = null;
              pairingActive.current = false;
              setBusy(false);
              setStatus("");
            }}
          />
        )}
      </Card>
    </ScrollView>
  );
}
