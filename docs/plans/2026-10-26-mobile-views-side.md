# Mobile view cards and side chats

The mobile bridge preserves the behavior of the upstream view and side-chat
designs without exposing the Web renderer or a new code-execution surface.

## Cards

- Project pending cards only for recognized private Bot sessions. Carry the
  session, owning Bot and exact view ID; reject unknown, stale and read-only
  mutations before calling the existing host answer handler.
- Share the existing blueprint validator, formula interpreter and answer
  validation with React Native. Do not maintain a second formula language.
- Render confirmation, options, forms and submission buttons natively. Numbers,
  including sliders, use numeric entry with the original bounds. Inputs update
  formulas locally and only an explicit answer sends their values to the Bot.
- Tables and charts show bounded, horizontally scrollable data tables. HTML
  shows its summary and an explicit Web/desktop fallback; no model-written
  script or HTML runs in the phone. Source addresses remain visible as text.
- Historical successful tool results carry a validated blueprint independently
  of the generic truncated tool text. Historical answer controls cannot send.
  Invalid or unsupported cards show an explicit fallback instead of claiming
  they were displayed. Pending cards remain answerable after changing parts.
- Keep host single-answer claiming and rollback on failed delivery. Dismissal
  checks the supplied view ID so a stale phone cannot discard its replacement.

## Side chats

- Exact `/side` commands go through `side-ask`, never the normal submission
  queue. Refuse empty questions, group/agent chats, attachments and references;
  preserve the composer draft on rejection. `/sidechat` is ordinary text.
- Legacy clients submitting `/side` through the normal endpoint receive an
  explicit refusal. This prevents silent loss of the no-main-history/no-tools
  guarantee even before the phone is upgraded.
- Project bounded, redacted side-chat records for known Bots. Scope every
  action to the private Bot session; cancellation and deletion additionally
  check the chat and entry belong to that Bot.
- Reuse upstream side questions, follow-ups, cancellation and persistence.
  The mobile sheet exposes pending, failed and cancelled states, lets users
  recompose a failed question, and confirms deletion. Hiding the sheet does
  not delete its chat. Offline/read-only clients cannot mutate it.

Browser takeover/site grants, previous permission/import audit findings,
release version changes and publishing are outside this fix.
