# Pig Code Plugins

Public source and distribution catalog for Pig Code plugins.

## Layout

- `index.json`: versioned marketplace catalog consumed by Pig Code.
- `packages/<plugin-id>/`: source, manifest and assets for one plugin.
- `packages/<plugin-id>/*.nshpkg`: signed artifacts referenced by the catalog.

Packages are verified by Pig Code before installation. A valid signature does not grant capabilities automatically; the host still applies exact package-digest, scope and user permission checks.

## Trust and publishing

Never commit private keys, `*.secret` files, test credentials or host configuration. Production artifacts must be signed with a separately managed release key and certificate. Test fixtures and test signing keys are not marketplace trust roots.

Each package contains its `pig-plugin.json` manifest, compiled NSH code and signed assets. Package id, version and build must match the signed NSH app metadata and the catalog entry. Every release increments `build`.

The Moon example lives in `packages/moon-plugin`. It customizes only `composer.sendButton` with a moon icon. Its signed build 1 artifact is included in `index.json`.

The Token Stats example lives in `packages/token-stats-plugin`. It uses the generic session statistics API and owns all summary and detail popovers; without it, the host shows no turn or session statistics. Its signed build 1 artifact is included in `index.json`.

The build 2 source uses native Surface contributions and the versioned `pig.host` API, with no backend Engine. It mounts `status.activity`, `status.usage`, `status.context` and `message.turnStats`; details open through the host's anchored overlay. Its new signed artifact still needs to be produced before updating `index.json`.
