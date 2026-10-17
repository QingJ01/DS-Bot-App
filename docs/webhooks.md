# Webhooks

A webhook lets a service outside DS Bot reach your team. The service POSTs to a URL on your
DSH host, and what it sends arrives in one Bot's chat or one group chat as a user message,
as if you had sent it. The Bot answers with its normal instructions, tools and memory.

Webhooks are off until you turn them on. They belong to the host plugin, not to the phone
bridge, and they listen on their own port.

## Turn it on

Add `hooks` to the `bot` entry in the profile's `cordis.patch.yml`.

**A DSH patch replaces the entire `bot.config`; it does not merge nested keys.** Keep every
option the profile already carries when you add `hooks`, and keep this machine-specific
file outside the repository.

```yaml
- id: bot
  config:
    hooks:
      enabled: true
      host: 0.0.0.0
      port: 8790
      publicUrl: https://hooks.example.com
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Turn the listener on. Nothing listens while it is off. |
| `host` | `127.0.0.1` | The address to bind. `0.0.0.0` accepts requests from outside this machine. |
| `port` | `8790` | The port to bind. |
| `publicUrl` | the bound address | The origin put into the URL you copy, when a domain or a reverse proxy sits in front. |

Restart the host after changing the file. A port that is already taken does not stop DS Bot;
the Webhooks screen shows why the listener is down.

## Create a webhook

Open **Settings → Webhooks** in the phone app, tap **＋ New webhook**, name it, choose the
Bot or the group it reaches, and write a message template if you want one. The host returns
the secret once. Copy it then: the host keeps only a digest, so it cannot show it again.

A team holds at most 50 webhooks. The same actions are on the plugin channel as
`hook-create`, `hook-update`, `hook-delete`, `hook-rotate` and `hooks-list`.

## Send a request

POST to the URL with the secret in an `Authorization: Bearer` header:

```sh
curl -X POST "$URL" -H "Authorization: Bearer $SECRET" \
  -H "content-type: application/json" \
  -d '{"text":"Build 42 is green"}'
```

- A JSON body may carry `text` or `message`. Anything else in it is passed on as JSON.
- A body that is not JSON is passed on as it came.
- `?token=` works in place of the header, for a service that cannot set one.
- A template replaces `{{text}}` with what the service sent and `{{name}}` with the
  webhook's name. Without a template the Bot reads `[Webhook: <name>] <what it sent>`.
- Only POST is answered. Anything longer than 64 KB is refused, and a single webhook is
  limited to 120 requests a minute.

The answer is `202` once the message has been handed to the team, `401` for a wrong secret,
`404` for an unknown or switched-off webhook, `413` for a body that is too large, and `429`
when a webhook is sending too fast. The secret is never repeated in an answer.

## What to watch

- **Bind loopback unless you mean it.** `0.0.0.0` opens the port on every interface, so
  anything that can reach the machine can try the URL. The secret is the only gate.
- **Put TLS in front.** The listener speaks plain HTTP, and a service like GitHub will not
  accept a self-signed certificate. Terminate TLS in a reverse proxy or a private VPN — see
  [HTTPS for the phone](mobile.md#provide-https) — or keep the listener on loopback and
  forward to it.
- **Rotate a secret that may have leaked.** Rotating stops the old secret at once.
- **A webhook is a message, not a decision.** It arrives as the user. It does not answer a
  question or approve a tool, so a Bot still needs its own approval to act.
- **A delivery does not rewrite the team file.** Delivery counts live in memory and start
  again at zero after a host restart.
