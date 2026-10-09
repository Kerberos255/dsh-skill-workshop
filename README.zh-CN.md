# DSH 技能工坊（Skill Workshop）

[English](README.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [安全说明](SECURITY.md)

用于管理 DSH 原生技能，并从已完成的任务**自动提炼可复用工作流程**。模型提出候选技能，插件负责核验、发布、容量限制与恢复；无需每次弹窗要求人工确认。

## 主要功能

- 查看、编辑、导入原生 `SKILL.md` 技能，支持 Markdown、目录和受支持的归档格式。
- 从工作区已完成、来源可核验的真实任务中学习；简单闲聊、失败和取消的任务跳过。
- **默认自动学习、自动发布**：同一技能需至少两个不同的成功任务轮次，且能对应原始用户需求与助手结果；同一轮反复归纳不计作新证据。
- 人工编辑过、其他插件创建或外部修改的技能不会被自动覆盖。
- 发布采用意图账本、路径锁和文件校验；断电/中断后优先核对现有文件，不用模型盲目覆盖。

## 安装与使用

需要 DSH 原生技能 Registry、Agent 与 Session 服务；实际运行环境看 [package.json](package.json)。

```sh
dsh plugin --profile desktop add github:Kerberos255/dsh-skill-workshop
```

在「设置 → 插件 → 技能工坊」选择保存范围（当前项目 `.dsh/skills` 或用户 `DSH_HOME/skills`），确认自动学习及发布开关，即可正常使用 DSH 完成任务。第一次独立经验成为待验证候选，后来有新的独立完成轮次达到条件后，插件自动晋升；不需要逐项审批。手动导入、编辑或发生文件冲突时仍保留人工审阅入口。

## 如何防止无限增长？

| 机制 | 默认规则 |
| --- | --- |
| 同工作区待验证自动候选 | 最多 **32** 个 |
| 同工作区自动受管技能 | 最多 **64** 个 |
| 候选未出现新证据 | **45 天**后过期 |
| 学习冷却和每日次数 | **60 分钟**、每日最多 **8 次** |
| 闲置受管技能 | **90 天**退役，额外保留 **7 天** |
| 自动整理已处理记录 | **180 天**裁剪 |

设置页可以调整对应上限。达到受管技能上限后，自动创建新技能会暂停，仍可继续更新未被人工修改的旧技能。人工技能和外部技能不在清理范围；关闭闲置淘汰会保留原有技能文件。

**注意**：两个独立成功轮次提供的是“来源与重复经验”门槛，不等于技能已在真实环境重新执行两次，也不代表外部客观验收通过。

## 数据、回退和测试

状态保存于 DSH 本地 `skill-workshop/state.sqlite`，技能文件落在选定的原生技能目录。进程中断后核对文件哈希并尝试恢复；若外部改动或路径不一致，暂停自动恢复并提示处理冲突。未发布候选不等于已安装技能。

运行 `npm test` 检查便携逻辑；真实模型学习与 UI、Registry 应在 DSH Host 中另行测试。配置：[config.example.json](config.example.json) · 安全：[SECURITY.md](SECURITY.md)。

相关：[Dream 与长期记忆](https://github.com/Kerberos255/dsh-memory-dreaming) · [指令文件与角色](https://github.com/Kerberos255/dsh-instruction-files)。

许可证：[MIT](LICENSE)。
