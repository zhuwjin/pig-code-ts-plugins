# Pig Code Plugins

Public source and distribution catalog for Pig Code plugins.

## Layout

- `index.json`: versioned marketplace catalog consumed by Pig Code.
- `packages/<plugin-id>/`: source, manifest and assets for one plugin.
- `releases/`: signed `.nshpkg` artifacts referenced by the catalog.

Packages are verified by Pig Code before installation. A valid signature does not grant capabilities automatically; the host still applies exact package-digest, scope and user permission checks.

## Trust and publishing

Never commit private keys, `*.secret` files, test credentials or host configuration. Production artifacts must be signed with a separately managed release key and certificate. Test fixtures and test signing keys are not marketplace trust roots.

Each package contains its `pig-plugin.json` manifest, compiled NSH code and signed assets. Package id, version and build must match the signed NSH app metadata and the catalog entry. Every release increments `build`.

The Moon example currently lives in `packages/moon-plugin`. It is source material for the first signed release and is not yet included in `index.json`.
