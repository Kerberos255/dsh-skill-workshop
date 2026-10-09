# Skill Workshop for DeepSeek Harness

[简体中文](README.zh-CN.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [Security](SECURITY.md)

A native DSH **skill authoring and self-learning workshop**. Import, edit, and manage `SKILL.md`-based skills, or let completed tasks produce candidate procedures that can be promoted automatically after evidence checks.

## Features

- Browse, create, update, and import native DSH skills from Markdown, directories, and supported skill archives.
- Learn reusable workflows from completed tasks without granting a model direct write access to the published skill root.
- **Unattended auto-promotion by default:** the same skill needs evidence from at least **two distinct successful task turns**, each linked to genuine user requests and assistant results.
- Guard against uncontrolled growth: bounded candidates and managed skills, stale-candidate expiry, history pruning, and retirement of unused workshop-owned skills.
- Protect manual edits and externally managed skills from automated overwrite; recover interrupted publications using durable records and hash checks.

## Install

Requires native DSH skill and session services; runtime and peer requirements are listed in [package.json](package.json).

```sh
dsh plugin --profile desktop add github:Kerberos255/dsh-skill-workshop
```

Replace the profile name as needed, pin a commit if desired, and restart DSH after installing or upgrading code.

## Quick start

1. Open **Settings → Plugins → Skill Workshop**. Choose the project skill root (`.dsh/skills`) or user skill root (`DSH_HOME/skills`).
2. Run regular DSH tasks. Eligible successful turns may generate **skill candidates**; short, failed and interrupted tasks are skipped.
3. Once a candidate has independent evidence from two distinct turns and passes checks, the workshop **publishes it without asking for per-skill manual confirmation**.
4. Inspect candidate/managed counts and customize limits, or use the editor/import screen for manual skills. Manual import and external edits retain their review flow.

## Growth-control defaults

| Bound | Default |
| --- | --- |
| Pending auto-learned candidates per workspace | **32** |
| Workshop-managed skills per workspace | **64** |
| Candidate expiry without fresh evidence | **45 days** |
| Automatic learning cooldown / daily attempts | **60 minutes / 8** |
| Managed skill retirement / grace | **90 days idle / 7 days** |
| Processed automatic-learning records | **180 days** |

Candidate evidence is a **source and repetition safeguard**, **not proof that a procedure was re-executed or externally validated**. Automatic publication will not overwrite a manually edited skill, and reaching the managed cap blocks new automatic skills.

## Data and testing

Candidate and publication state live in local DSH SQLite; published skills remain files in the chosen native skill root. Interrupted changes are checked and may require human review **only for conflicts or unusual recovery states**. No secret/session database belongs in the public repository.

Run `npm test` for portable tests. Live model learning and DSH registry/UI behavior require separate integration testing. See [config.example.json](config.example.json) and [SECURITY.md](SECURITY.md).

Related: [Dream & Memory](https://github.com/Kerberos255/dsh-memory-dreaming) · [Instruction Files](https://github.com/Kerberos255/dsh-instruction-files).

MIT licensed. See [LICENSE](LICENSE).
