# One-click connection to your computer

English | [中文](mobile-local-https.zh.md)

Update both DS Bot and the native mobile app. Local HTTPS requires no domain, Tailscale, OpenSSL executable, or certificate installation.

1. Connect the phone and computer to the same Wi-Fi and keep DSH running.
2. On the computer, open **Settings → Mobile devices → Enable phone connection**. The plugin creates its certificate, starts HTTPS, and shows a QR code.
3. Scan it in DS Bot Mobile. The app automatically requests pairing.
4. Click **Approve** on the computer for the phone you recognize. Later app launches reconnect automatically.

Allow private-network access if the computer's firewall asks. Camera permission and iOS local-network permission may also appear. The plugin cannot approve OS permissions for you.

The default port is `8788`; the plugin prefers IPv4 and also lists private and public IPv6 addresses. If several interfaces are available, choose the Wi-Fi address before enabling. Guest Wi-Fi, AP isolation, VPNs, or a firewall may prevent the phone reaching that address. If the computer changes networks or IP address, turn the connection off and on, generate a new QR and pair the new address. Routine certificate renewal does not require pairing again.

## IPv6 direct access

IPv6 support requires the v0.1.1 or newer plugin and App. Version v0.1.0 lists IPv4 addresses only.

The published `0.1.1 r2` UI has no separate IPv6 switch: turn off phone connection to reveal its network-address dropdown, then select IPv6. The development branch adds a dedicated **Use IPv6** switch that stays visible while connected, explains when no usable IPv6 address is available, and requires turning off the connection before changing protocols. This UI improvement is not included in the r2 archive yet.

A computer with public IPv6 can accept connections from another IPv6-capable network without a domain, coordination server, relay, or additional app.

1. Turn off an existing phone connection on the computer. Select an address marked **Public IPv6** in Mobile devices, then enable the connection.
2. Allow incoming TCP `8788` to that address in the computer and router IPv6 firewalls (or the selected custom port). Only the mobile port needs access; leave the DSH management port private. The plugin does not change firewalls.
3. Scan the new QR in the native app and approve it on the computer. Test external access using IPv6-capable cellular data.

An IPv6 origin is written as `https://[IPv6-address]:8788`; brackets are required. The plugin generates the correct QR and IP certificate automatically. The app still verifies the computer's public-key pin.

Private IPv6 beginning with `fc` or `fd` requires a network with a route to that address; it is not public Internet access. Link-local `fe80` addresses require different interface scopes on each device and are not listed. A public IPv6 address does not prove reachability: the carrier, routing and firewalls must also allow connections. An IPv4-only phone network cannot connect directly. When IPv6 is selected, HTTPS binds only to that address.

IPv6 prefixes and temporary addresses can change. Turn the connection off and on, choose the current address and pair again if the old address stops working. This version does not discover address changes through a public service. The project provides no hosted coordination or relay service.

## Identity and restart

The plugin creates a self-signed P-256 certificate using Node's built-in crypto. The QR contains the SHA-256 hash of the computer's SPKI public key. Dedicated native HTTP/WSS transports validate that pin, certificate validity/signature, and hostname. Global TLS validation stays enabled and the connection never falls back to HTTP.

The phone stores the pin alongside its credentials in secure storage. A different identity requires pairing again. At startup, certificates near expiry or missing a current network address are renewed with the same private key, preserving existing pairings. Enabled local access resumes after DSH restarts. A damaged key fails closed instead of silently changing identity.

Files live in the plugin's own `mobile/` directory; DSH installation and profile files are unchanged. Unix key permissions are `0600`, certificate-directory permissions `0700`; Windows retains the user's directory ACL. Keep backups private. Turning off phone connection stops the listener and active streams but retains pairing records. Revoke a device to remove its access independently.

Existing manual HTTPS configuration is preserved. Explicit `mobile.enabled: false` prevents enabling local access from the UI.

## Scope

Both devices must be directly reachable, either locally or through public IPv6 as described above. This feature does not create an Internet tunnel or keep a powered-off computer available. Other remote deployment options are in the [deployment guide](mobile.md).

A browser or Expo Go cannot use this certificate-pinning transport; install the updated native app. Android background reception uses the same pin and does not require FCM/APNs while its background service runs. Existing iOS background execution limits still apply. EAS configuration is not needed for this feature. GitHub Actions can sign APKs with the project DeepSeekBot key when the password Secret is configured. Earlier test APKs used debug signing; switching certificates requires uninstalling the old App and pairing again. See [signing and releases](releasing.md).
