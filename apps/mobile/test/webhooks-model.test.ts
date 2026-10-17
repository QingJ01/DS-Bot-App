import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmKey,
  deliveryCount,
  hookPayload,
  hookTarget,
  initialHook,
  targetValue,
} from "../src/features/hooks-model.ts";
import type { WebhookItem } from "../src/types.ts";

const bots = [
  { id: "chief", name: "Chief" },
  { id: "writer", name: "Writer" },
];
const rooms = [{ id: "crew", name: "Crew" }];

test("a webhook form names one Bot or one group, never both", () => {
  assert.deepEqual(hookPayload({ name: " Build ", target: "writer", template: " {{text}} " }), {
    name: "Build",
    botId: "writer",
    template: "{{text}}",
  });
  assert.deepEqual(hookPayload({ name: "Alerts", target: "room:crew", template: "" }), {
    name: "Alerts",
    roomId: "crew",
    template: "",
  });
});

test("a webhook without a name or a target is refused before the host is asked", () => {
  assert.throws(() => hookPayload({ name: "  ", target: "chief", template: "" }), /name/i);
  assert.throws(() => hookPayload({ name: "Build", target: "", template: "" }), /reaches/i);
});

test("the target a row shows survives the round trip through the form", () => {
  assert.deepEqual(
    hookPayload({ name: "X", target: targetValue({ botId: "chief" }), template: "" }),
    { name: "X", botId: "chief", template: "" },
  );
  assert.deepEqual(
    hookPayload({ name: "X", target: targetValue({ roomId: "crew" }), template: "" }),
    { name: "X", roomId: "crew", template: "" },
  );
  assert.equal(hookTarget({ botId: "chief" }, bots, rooms).kind, "bot");
  assert.equal(hookTarget({ roomId: "crew" }, bots, rooms).kind, "room");
});

test("a target that is gone still says where the webhook points", () => {
  assert.deepEqual(hookTarget({ botId: "ghost" }, bots, rooms), {
    kind: "bot",
    name: "ghost",
  });
  assert.deepEqual(hookTarget({ roomId: "gone" }, bots, rooms), {
    kind: "room",
    name: "gone",
  });
  assert.deepEqual(hookTarget({}, bots, rooms), { kind: "none", name: "" });
});

test("rotating and deleting cannot confirm each other on the same row", () => {
  assert.notEqual(confirmKey("delete", "a"), confirmKey("rotate", "a"));
  assert.notEqual(confirmKey("delete", "a"), confirmKey("delete", "b"));
});

test("a webhook that never fired reads as no deliveries, not as a missing count", () => {
  const base = { id: "a", name: "A", template: "", enabled: true } as WebhookItem;
  assert.equal(deliveryCount(base), 0);
  assert.equal(deliveryCount({ ...base, deliveries: 3 }), 3);
  assert.equal(
    deliveryCount({ ...base, deliveries: Number.NaN as unknown as number }),
    0,
  );
});

test("a fresh form starts on the first Bot and holds nothing else", () => {
  assert.deepEqual(initialHook("chief"), {
    name: "",
    target: "chief",
    template: "",
  });
  assert.equal(initialHook().target, "");
});
