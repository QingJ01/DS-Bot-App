# Daily budgets

A Bot can be given a limit for one day. Once it has spent it, it takes no new work until the
next day: a message to it is refused with the reason, another Bot cannot hand it a task, and a
group turn that would reach it stops before it starts.

The budget is the companion of the limits DS Bot already has. Six hops per chain and forty
unattended messages bound *how far* a Bot goes on its own; a budget bounds *what it spends*
while getting there.

## What it counts

**Tokens, not money.** DS Bot's usage ledger counts what each model call spent — input, cache
reads, cache writes, output — and DS Bot does not know what a token costs: which models a
deployment runs, and their prices, belongs to DeepSeek Harness and to the provider. So a
budget is a token count, and the page that shows it says tokens.

The count is the same one the **Settings → Usage** page sums: it is derived from the Session
logs (so calls made before the budget existed count too) plus the calls that leave no log and
are metered while they stream. A Bot's budget covers all of its work — its own chat, its group
conversations, their earlier parts, and any Session forked or spawned under them.

**A day is the user's day.** The phone and the browser send their time zone with every team
read, and the team file keeps the last one it saw, so "today" ends at your midnight rather
than at the host's UTC one.

## Set one

```sh
# What every Bot may spend today, what it has spent, and whether it is stopped
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"budgets","payload":{"timeZone":"Asia/Riyadh"}}'

# 250,000 tokens a day for one Bot
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"budget-set","payload":{"id":"BOT_ID","tokens":250000}}'

# Take the budget back
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"budget-clear","payload":{"id":"BOT_ID"}}'
```

There is **no screen for it yet** — the same three requests are all there is today, and the
phone bridge passes them through for the screen that comes next. A Bot cannot set its own
budget, not even by asking another Bot: only the user decides what a Bot may spend.

## When the budget runs out

- **A turn that is already running finishes.** The check happens when work would *start*:
  cutting a model call in half would leave the team with a reply that makes no sense.
- **The team view says so.** Each Bot with a budget carries it in the team state, with
  `blocked: true` once the day is spent, so the sidebar and the phone can show it without
  waiting for a ledger scan.
- **It is written down once.** The first refusal of the day is recorded in the diagnostics
  log (`Settings → Feedback`, `logs/diagnostics.jsonl`) with the Bot, the budget and what it
  had spent. Later refusals in the same day are not repeated.
- **The next day starts clean** as soon as any check runs, and the marker is cleared with the
  new day's first count.

## What to watch

- **A budget is a hard stop.** A Bot that has spent it cannot answer, so a group that depends
  on it will stall until you raise the budget. Set the number above a normal day's use.
- **The count is as fresh as the ledger.** A check waits a few seconds for the usage scan and
  then answers with what the ledger has; a very large turn that lands right after the check
  can pass the budget by the size of that one turn.
- **It is not a security boundary.** A permission preset decides what a Bot may do; a budget
  only decides how much it may spend doing it.
