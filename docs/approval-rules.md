# Approval rules

DeepSeek Harness asks you before a tool call that its permission preset does not allow.
Inside a group chat the card would not be visible at all — a member's Session there is
hidden — so DS Bot answers those requests from the group chat itself.

Writing the same approval every turn is the annoyance this removes. An **approval rule**
lets a Bot answer some of those requests on its own:

> Lead may write in its own folder without asking. Anything else still asks.

Rules belong to the user. A Bot cannot write them, not even a Main Bot, and a rule never
changes a permission preset — it only decides calls that would otherwise have waited for
you.

## A rule

| Field | Values | Meaning |
| --- | --- | --- |
| `tool` | a tool name, or `*` | The tool the rule answers for. |
| `scope` | `folder` (default) or `anywhere` | Where that tool may act without asking. `folder` is the folder the Bot is working in: the group's folder there, else the Bot's own, else the team workspace. |

A Bot carries at most 20 rules. A call matches the first rule that names its tool — or
every tool, with `*`.

Two limits keep a rule honest:

- **A call that names no path is never answered by a `folder` rule.** A shell command, a
  fetch, a request to another service: none of them is a file inside the folder, so the
  user is still asked. Use `anywhere` if you really want those answered too.
- **A path outside the folder is never answered by a `folder` rule.** A Bot that wanders
  out of its folder asks, exactly as before.

## Set them

Rules are a host setting, kept with the Bot in `state.json`, so they travel with the team.
They are on the plugin channel — the same one the browser and the phone use — and there is
**no screen for them yet**: today you write them with a request to the host API.

```sh
# What is set now, and what a rule answered without asking
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"approval-rules","payload":{}}'

# Trust one Bot inside its own folder
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"approval-rule-set","payload":{"id":"BOT_ID","rules":[{"tool":"*","scope":"folder"}]}}'

# Take every rule back
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"approval-rule-clear","payload":{"id":"BOT_ID"}}'
```

Port and route: the browser's own DSH address and `POST /api/bot` (see
[Mobile](mobile.md) for the address a phone uses). `approval-rule-set` replaces the whole
list; send `{"rules":[]}` to clear it in one step. Setting rules is refused on a host that
another dsh has taken over, like every other change to the team.

## What is kept

- Every approval DSH asks passes the rules first, and every answer — from a rule or from
  you — is written to that Session's own log as an `approval/asked` and `approval/decided`
  pair. A rule changes who answers; it does not hide the decision.
- The host also keeps the last 20 calls a rule answered, with the Bot, the tool, the scope
  and the path, and shows them as `recent` on `approval-rules`. That list is in memory: it
  is news about what just happened, not part of the team, and it starts empty again after a
  restart. The team file is not rewritten when a rule answers a call.
- A rules value the team cannot read (a hand-edited `state.json`, an older shape) is
  dropped at load, so the Bot asks for everything again instead of acting on a rule nobody
  wrote.

## What to watch

- **A rule is a standing decision.** It answers every matching call while it exists,
  including a call you would have refused. Keep `*`/`anywhere` for a Bot you would trust
  with the machine anyway, and prefer `folder`.
- **A working folder can be moved by a Bot.** `update_bot` and `update_group` can change a
  folder (and DS Bot asks you first when that would widen where a Bot may write). A rule
  follows that folder, because it names the place, not a path.
- **Nothing about a rule is secret.** It is visible in the team view, the log and the host
  API. It is a setting, not a credential.
