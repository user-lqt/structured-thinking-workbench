# skills 目录说明

工作台里每一个「产出」都对应一个 skill。skill 不是一段写在代码里的提示词，而是一个**可独立维护的技能包**。

## 目录规范

```
skills/
├─ registry.json          技能注册表：id、名称、类型、阶段、入口、状态
├─ README.md              本文件
├─ _template/             新建 skill 时复制这一份
│  └─ SKILL.md
├─ manifest/              已就绪
│  └─ SKILL.md
├─ wbs/                   已就绪
│  └─ SKILL.md
└─ <skill-id>/            待接入（已在 registry.json 登记）
   ├─ SKILL.md            ← 必需
   ├─ references/         ← 可选，按需加载的细节规范
   ├─ assets/             ← 可选，模板与示例
   └─ scripts/            ← 可选，自检脚本
```

## 分层原则

| 层 | 放什么 | 何时加载 |
|---|---|---|
| `registry.json` | 一行摘要 | 启动时 |
| `SKILL.md` | 何时使用、输出契约、写作要求、事实边界、验收清单 | 生成该产出时 |
| `references/*.md` | 具体格式规范、字段字典、写作细则 | SKILL.md 声明需要时 |
| `assets/*` | 模板、示例、参考成品 | 需要照抄结构时 |
| `scripts/*` | 校验脚本 | 生成后自检 |

**SKILL.md 只做路由，不要把所有内容塞进去。** 这样新增产出不会影响既有产出的上下文开销。

## 事实边界（所有 skill 共用，不得违反）

1. 只能使用用户已提供的事实。
2. 缺失的人名、单位、电话、金额、人数、依据一律写 `待确认`。
3. 不得编造任何可核查的具体信息。
4. 可以给结构性建议，但必须属于通用经验。

## SKILL.md 必备章节

- `## 何时使用`
- `## 输出契约`
- `## 事实边界`
- `## 验收清单`

## 新增一个 skill 的步骤

1. 复制 `_template/SKILL.md` 到 `skills/<skill-id>/SKILL.md`
2. 在 `registry.json` 里把该条目的 `status` 从 `planned` 改为 `ready`
3. 若需要，补充 `references/` 与 `assets/`
4. 工作台会自动识别并点亮该产出
