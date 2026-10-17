# 审批规则

DeepSeek Harness 在工具调用超出当前权限预设时会先询问你。而在群聊里这张卡片根本不会出现——成员在群里的会话是隐藏的——因此 DS Bot 会自己在群聊中回答这些请求。

每个回合都重复同样的批准，正是本功能要去掉的麻烦。**审批规则**让 Bot 自行回答其中一部分请求：

> 允许 Lead 在自己的目录里写入而不询问；其他一律照旧询问。

规则属于用户。Bot 不能编写规则，即使是 Main Bot 也不行；规则也不会改变权限预设——它只决定那些本来会等你回答的调用。

## 规则

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `tool` | 工具名，或 `*` | 这条规则要回答的工具。 |
| `scope` | `folder`（默认）或 `anywhere` | 该工具可以在哪里无需询问地行动。`folder` 指 Bot 当前工作的目录：该群聊的目录优先，其次是 Bot 自己的，再次是团队工作区。 |

每个 Bot 最多 20 条规则。一个调用由第一条命中其工具名（或 `*`）的规则决定。

两条限制让规则保持可信：

- **不涉及路径的调用永远不会被 `folder` 规则回答。** 一条 shell 命令、一次抓取、一次对外的请求：它们都不是目录里的文件，所以仍然会问你。若确实想让它们也被回答，使用 `anywhere`。
- **目录之外的路径永远不会被 `folder` 规则回答。** Bot 若走出自己的目录，仍会像以前一样询问。

## 设置

规则是主机端设置，随 Bot 保存在 `state.json` 中，因此会随团队一起迁移。它们位于插件通道上——与浏览器和手机使用的是同一个通道——并且**目前还没有界面**：现在需要通过主机 API 请求来编写。

```sh
# 查看当前规则，以及被规则自动回答的调用
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"approval-rules","payload":{}}'

# 信任某个 Bot 在自己的目录内操作
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"approval-rule-set","payload":{"id":"BOT_ID","rules":[{"tool":"*","scope":"folder"}]}}'

# 收回全部规则
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"approval-rule-clear","payload":{"id":"BOT_ID"}}'
```

端口与路由：浏览器使用自己的 DSH 地址与 `POST /api/bot`（手机使用的地址见[移动端](mobile.zh.md)）。`approval-rule-set` 会整份替换规则列表；发送 `{"rules":[]}` 可一步清空。与其他团队改动一样，若另一个 dsh 已接管团队，此操作会被拒绝。

## 保留了哪些记录

- DSH 的每一次审批都会先经过规则；无论由规则还是由你回答，都会写入该会话自己的日志（`approval/asked` 与 `approval/decided` 成对出现）。规则改变的是“谁来回答”，而不是“是否留痕”。
- 主机还会保留最近 20 条由规则回答的调用（Bot、工具、范围与路径），并在 `approval-rules` 的 `recent` 中返回。该列表只在内存中：它是刚刚发生的事，不属于团队数据，重启后重新为空。规则回答调用**不会**重写团队文件。
- 若规则值无法读取（手工改坏的 `state.json`、旧结构），加载时会将其丢弃，于是 Bot 回到“凡事都问”，而不会依据没人写过的规则行动。

## 需要注意

- **规则是一项长期决定。** 只要它存在，就会回答所有匹配的调用，包括你本会拒绝的那次。请把 `*` 与 `anywhere` 留给即使整机交给它也无妨的 Bot，优先使用 `folder`。
- **工作目录可以被 Bot 移动。** `update_bot` 与 `update_group` 都能修改目录（当这会扩大 Bot 的写入范围时，DS Bot 会先询问你）。规则跟随该目录，因为它指定的是“位置”，不是固定路径。
- **规则不是秘密。** 它出现在团队视图、日志与主机 API 中。它是设置，不是凭据。
