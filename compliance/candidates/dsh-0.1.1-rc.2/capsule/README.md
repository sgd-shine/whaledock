# dsh 0.1.1-rc.2 candidate compliance capsule

This directory is the immutable batch-4 candidate closure for the three approved native targets. It is not the production compliance directory and does not change WhaleDock's active dsh lock.

- `compliance/` contains the three native inventories, reachable embedded-component catalog, source/rebuild mapping and generated source disclosure.
- `licenses/` contains only the license material reachable from those inventories, including the fixed SPDX set and content-addressed package texts.
- `THIRD_PARTY_NOTICES.md` is generated from the candidate inventories in a clean mirror.
- `native-evidence-summary.json` preserves all aggregate tree fields, detected native binaries, target-native proofs and isolated `--dump-config` results while binding the full raw evidence by SHA-256.
- `evidence-provenance.json` binds the source workflow run, jobs and uploaded artifact digests. Raw artifacts are temporary Actions retention evidence; their exact content hashes remain in this capsule after expiry.
- `runtime-manifests/` preserves the three small runtime manifests whose hashes are bound by `capsule-manifest.json`.
- `material-manifests/` preserves each runner's candidate, inventory, runtime and referenced-license material vector. CI compares the complete stable vector while allowing only the fresh commit and raw-evidence hashes to vary.

The candidate lock, install-script allowlist and package-license overrides remain one directory above this capsule. CI rebuilds each target natively, aggregates fresh artifacts, byte-compares the exact lock/inventories/licenses, and compares stable projections of the native evidence summaries and runner manifests before batch 5 may open the production lock window.
