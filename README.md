# Skill Workshop for DeepSeek Harness

[简体中文](README.zh-CN.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [Security](SECURITY.md)

Manage native DSH `SKILL.md` skills and **learn reusable procedures from completed tasks**.

## Features

- Create, edit, import and organize project or user skills from the plugin settings.
- **Automatic learning and publishing are enabled by default.** The same method needs evidence from at least **two independent, completed and source-verifiable tasks** before a skill can be published.
- Reinforce matching candidates with new evidence; reject failed, duplicate or non-reusable tasks. Malformed model JSON receives bounded recovery.
- Protect manually edited and externally managed skills. Interrupted publication is reconciled against existing files.
- Bound candidates and managed skills, expire stale candidates and retire unused workshop-owned skills to prevent unbounded growth.

## Install and use

```sh
dsh plugin --profile desktop add github:Kerberos255/dsh-skill-workshop
```

Replace `desktop` with your profile, then restart DSH.

1. Open **Settings → Plugins → Skill Workshop** and select the project `.dsh/skills` directory or your user skill directory.
2. Review the learning, auto-publishing and capacity settings (learning and publishing are on by default).
3. Continue normal tasks. The first eligible task creates an **experience candidate**; a later independent task can provide the evidence needed for publication.
4. Review candidates and managed skills in settings, or create/import skills manually.

Default limits per workspace: **64 candidates**, **64 workshop-managed skills**, a **60-minute** learning cooldown and up to **8** automatic attempts per day. Relevant limits are configurable.

## Safety and tests

- Two independent tasks establish a **source-evidence threshold**, not proof that the resulting procedure has been rerun or externally verified.
- Automatic cleanup does not overwrite or remove manual/external skills; ambiguous recovery conflicts require review.
- State lives in local SQLite; published skills remain native files. Automatic learning requires an available model and DSH host services.

Portable tests: `npm test`; host integration: `npm run test:host`. See [config.example.json](config.example.json) and [LICENSE](LICENSE).
