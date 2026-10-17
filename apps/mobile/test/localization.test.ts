import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import ts from "typescript";
import { localizedText, resolveLanguage, translate } from "../src/logic/localization.ts";
import { contrastText, luminance } from "../src/logic/colors.ts";
import { notificationTitle, notificationTransportLabel } from "../src/logic/notifications.ts";

// URL.pathname keeps a leading "/" before the drive letter on Windows, so it does not resolve.
const root = fileURLToPath(new URL("../src/", import.meta.url));
const catalog: Record<string, string> = Object.assign({}, ...["i18n.zh.json", "i18n.mobile.zh.json", "host-settings/locale.zh.json"].map(file => JSON.parse(readFileSync(join(root, file), "utf8"))));
const main = ts.createSourceFile("i18n.ts", readFileSync(join(root, "i18n.ts"), "utf8"), ts.ScriptTarget.Latest, true);
function collect(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) catalog[ts.isIdentifier(node.name) ? node.name.text : (node.name as ts.StringLiteral).text] = node.initializer.text;
  ts.forEachChild(node, collect);
}
collect(main);

test("plugin metadata follows the selected language with readable fallbacks", () => {
  const metadata = { "en-US": "Tools", "zh-CN": "工具" };
  assert.equal(localizedText(metadata, "zh"), "工具");
  assert.equal(localizedText(metadata, "en"), "Tools");
  assert.equal(localizedText({ zh: "技能", en: "Skills" }, "zh"), "技能");
  assert.equal(localizedText({ "zh-CN": "", "en-US": "Tools" }, "zh"), "Tools");
  assert.equal(localizedText("User plugin", "zh"), "User plugin");
  assert.equal(localizedText(undefined, "zh"), "");
});

test("explicit language overrides host and system; host system preference follows the phone", () => {
  assert.equal(resolveLanguage("en", "zh-CN", "zh-CN"), "en");
  assert.equal(resolveLanguage("zh", "en-US", "en-US"), "zh");
  assert.equal(resolveLanguage("host", "zh-CN", "en-US"), "zh");
  assert.equal(resolveLanguage("host", "system", "zh-Hans-CN"), "zh");
  assert.equal(resolveLanguage("system", "zh", "en-US"), "en");
  assert.equal(resolveLanguage("host", undefined, "zh-TW"), "zh");
});

test("switching language preserves names, interpolates zero and ignores inherited translation keys", () => {
  const key = "Use /{name}";
  assert.equal(translate(key, catalog, "zh", { name: "phone-checklist" }), "使用 /phone-checklist");
  assert.equal(translate(key, catalog, "en", { name: "phone-checklist" }), "Use /phone-checklist");
  assert.equal(translate("{seconds}s", catalog, "zh", { seconds: 0 }), "0 秒");
  assert.equal(translate("{name}", catalog, "en", Object.create({ name: "inherited" })), "{name}");
  assert.equal(translate("toString", catalog, "zh"), "toString");
  assert.equal(translate("用户自己设置的名称", catalog, "en"), "用户自己设置的名称");
});

test("every literal translated control and known error has Chinese catalog coverage", () => {
  const missing = new Set<string>();
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.tsx?$/.test(file) || /(?:i18n|locale)\.ts$/.test(file)) continue;
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node: ts.Node) {
        const literal = ts.isCallExpression(node) && node.expression.getText(source) === "tr" ? node.arguments[0]
          : ts.isNewExpression(node) && node.expression.getText(source) === "Error" ? node.arguments?.[0] : undefined;
        if (literal && ts.isStringLiteral(literal) && !Object.hasOwn(catalog, literal.text)) missing.add(literal.text);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  walk(root);
  assert.deepEqual([...missing].sort(), []);
});

test("notification titles and transport guidance have both language variants without transcript content", () => {
  for (const kind of ["reply", "question", "approval"]) {
    const key = notificationTitle(kind);
    assert.ok(translate(key, catalog, "zh") !== key);
    assert.equal(translate(key, catalog, "en"), key);
  }
  for (const platform of ["android", "ios", "web"]) {
    const key = notificationTransportLabel(platform, false);
    assert.ok(translate(key, catalog, "zh") !== key);
    assert.ok(!/[\u3400-\u9fff]/.test(key));
  }
});

test("normal text on medium accents meets contrast instead of choosing white at an arbitrary threshold", () => {
  for (const color of ["#999999", "#ffffff", "#141414", "#4d6bfe", "#d97757", "#1e86ff", "#c93942", "#ff7078"]) {
    const foreground = contrastText(color);
    const values = [luminance(color), luminance(foreground)].sort((a, b) => a - b);
    assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, color);
  }
  assert.equal(contrastText("#999999"), "#141414");
});
