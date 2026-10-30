# Public source release

This is the standalone source distribution for dsh-skill-workshop.
Only plugin source and example configuration belong here. Do not commit user
sessions, credentials, databases, or a full DSH installation.

Requires a compatible DeepSeek Harness host providing the peer services from package.json.
The CI runs host-free tests; a passing result does not imply real Discord, Feishu, or browser integration.
The included client code is already generated, so standard installation needs no generator.
Replace <DSH_ROOT> in legacy documentation examples with your DSH install path.
Upstream third-party dependencies retain their own licenses.

UI generation: node tools/settings/build.mjs. Rebuilding the client preserves declared peer ranges and public package metadata. The example configuration is regenerated when matching DSH SDK peers are available; otherwise the checked-in example is retained.

Run npm test with Node 24 for host-free source, SQLite learning queues, migration, parser and settings-rebuild regressions. Run npm run test:host only in an environment that resolves matching DSH SDK peers. Neither suite uses live provider credentials or real conversation data.
