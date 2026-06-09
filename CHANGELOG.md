# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## \[[0.700.0-dev.8](https://github.com/holochain/hc-spin/compare/v0.700.0-dev.1...v0.700.0-dev.8)\] - 2026-06-09

### Miscellaneous Tasks

- Release v0.700.0-dev.7
- Release v0.700.0-dev.6
- Release v0.700.0-dev.5 by @cdunster in [#73](https://github.com/holochain/hc-spin/pull/73)
- Release v0.700.0-dev.4 by @cdunster in [#71](https://github.com/holochain/hc-spin/pull/71)
- Release v0.700.0-dev.3 by @cdunster in [#69](https://github.com/holochain/hc-spin/pull/69)
- Add direnv support to use the Nix devShell by @cdunster
- Release v0.700.0-dev.2 by @cdunster in [#67](https://github.com/holochain/hc-spin/pull/67)
- Add prepublish script to try to ensure an up-to-date publish by @ThetaSinner

### CI

- Update release automation actions and remove NPM_TOKEN secret by @cdunster in [#72](https://github.com/holochain/hc-spin/pull/72)
  - The latest version of the release automation workflow uses trusted publishers to publish packages instead of a token.
- Update checkout action in test workflow by @cdunster in [#70](https://github.com/holochain/hc-spin/pull/70)
- Update release automation actions to fix publish issue by @cdunster
  - Publishing was failing due to how the release notes were generated and packaged. v1.11.0 fixes that issue.
- Fix string formatting in release-prepare workflow by @cdunster in [#68](https://github.com/holochain/hc-spin/pull/68)
- Add formatting check step to PR tests by @cdunster
- Update the Node.js release workflows by @cdunster in [#64](https://github.com/holochain/hc-spin/pull/64)
- Add missing write permissions in release workflows by @cdunster
- Add workflow to publish the prepared release by @cdunster in [#63](https://github.com/holochain/hc-spin/pull/63)
- Add workflow to prepare a release by @cdunster

### Other Changes

- Revert "WIP: inline the publish workflow to test"
- Copy peerkit publish workflow
- Add verbose logging to publish
- Remove label check
- Inline the publish workflow to test
- Trigger publish on this branch too, for testing
- Use a branch to test without PRs

### First-time Contributors

- @cdunster made their first contribution in [#73](https://github.com/holochain/hc-spin/pull/73)
- @ThetaSinner made their first contribution

## \[[0.700.0-dev.1](https://github.com/holochain/hc-spin/compare/v0.600.1-rc.0...v0.700.0-dev.1)\] - 2026-02-18

### Features

- Holochain uses iroh transport, replace --signaling-url with --relay-url by @mattyg in [#56](https://github.com/holochain/hc-spin/pull/56)

### Build System

- Release v0.700.0-dev.1 by @mattyg in [#59](https://github.com/holochain/hc-spin/pull/59)
- Bump flake lock by @mattyg

## \[[0.600.1-rc.0](https://github.com/holochain/hc-spin/compare/v0.600.0...v0.600.1-rc.0)\] - 2026-01-13

### Features

- Bump to holochain 0.7.0-dev.7 by @matthme in [#52](https://github.com/holochain/hc-spin/pull/52)
- New argument --force-admin-ports which is passed to 'hc sandbox' (#50) by @mattyg in [#50](https://github.com/holochain/hc-spin/pull/50)
  - Feat: new argument --force-admin-ports which is passed to 'hc sandbox'
  - Docs: changelog
  - Chore: lint

### Documentation

- Added documentation about how to update to a new holochain version by @matthme in [#51](https://github.com/holochain/hc-spin/pull/51)

## \[[0.700.0-dev.7](https://github.com/holochain/hc-spin/compare/v0.700.0-dev.6...v0.700.0-dev.7)\] - 2026-06-09

## \[[0.700.0-dev.6](https://github.com/holochain/hc-spin/compare/v0.700.0-dev.4...v0.700.0-dev.6)\] - 2026-06-09

### Miscellaneous Tasks

- Release v0.700.0-dev.5 by @cdunster in [#73](https://github.com/holochain/hc-spin/pull/73)

### CI

- Update release automation actions and remove NPM_TOKEN secret by @cdunster in [#72](https://github.com/holochain/hc-spin/pull/72)
  - The latest version of the release automation workflow uses trusted publishers to publish packages instead of a token.

### Other Changes

- Revert "WIP: inline the publish workflow to test"
- Copy peerkit publish workflow
- Add verbose logging to publish
- Remove label check
- Inline the publish workflow to test
- Trigger publish on this branch too, for testing
- Use a branch to test without PRs

## \[[0.700.0-dev.5](https://github.com/holochain/hc-spin/compare/v0.700.0-dev.4...v0.700.0-dev.5)\] - 2026-06-09

### CI

- Update release automation actions and remove NPM_TOKEN secret by @cdunster in [#72](https://github.com/holochain/hc-spin/pull/72)
  - The latest version of the release automation workflow uses trusted publishers to publish packages instead of a token.

## \[[0.700.0-dev.4](https://github.com/holochain/hc-spin/compare/v0.700.0-dev.3...v0.700.0-dev.4)\] - 2026-06-08

### CI

- Update checkout action in test workflow by @cdunster in [#70](https://github.com/holochain/hc-spin/pull/70)
- Update release automation actions to fix publish issue by @cdunster
  - Publishing was failing due to how the release notes were generated and packaged. v1.11.0 fixes that issue.

## \[[0.700.0-dev.3](https://github.com/holochain/hc-spin/compare/v0.700.0-dev.2...v0.700.0-dev.3)\] - 2026-06-08

### Miscellaneous Tasks

- Add direnv support to use the Nix devShell by @cdunster

### CI

- Fix string formatting in release-prepare workflow by @cdunster in [#68](https://github.com/holochain/hc-spin/pull/68)
- Add formatting check step to PR tests by @cdunster

## \[[0.700.0-dev.2](https://github.com/holochain/hc-spin/compare/v0.700.0-dev.1...v0.700.0-dev.2)\] - 2026-06-04

### Miscellaneous Tasks

- Add prepublish script to try to ensure an up-to-date publish by @ThetaSinner

### CI

- Update the Node.js release workflows by @cdunster in [#64](https://github.com/holochain/hc-spin/pull/64)
- Add missing write permissions in release workflows by @cdunster
- Add workflow to publish the prepared release by @cdunster in [#63](https://github.com/holochain/hc-spin/pull/63)
- Add workflow to prepare a release by @cdunster

### First-time Contributors

- @cdunster made their first contribution in [#64](https://github.com/holochain/hc-spin/pull/64)
- @ThetaSinner made their first contribution

## 2026-02-13: v0.700.0-dev.1

### Changed

- Holochain is now run with the iroh transport. The argument `--signaling-url` has been replaced with `--relay-url`.

## 2026-01-13: v0.700.0-dev.0

### Changed

- Updated to holochain 0.7.0-dev.7

## 2025-11-20: v0.600.0

### Added

- A new argument `--force-admin-ports` takes a comma-separated list of port numbers, to force generated conductors to use specific admin ports. [#50](https://github.com/holochain/hc-spin/pull/50)

## 2025-11-06: v0.600.0-rc.0

### Added

- A new argument `--target-arc-factor` to support overriding the conductor configuration `network.target_arc_factor` in all launched conductors.

### Fixed

- Fixed development environment setup and developer documentation outlining how to use it.

### Changed

- Check linting in CI workflow

## 2025-10-13: v0.600.0-dev.0

### Changed

- Bumped to holochain 0.6.0-dev.28

## 2025-07-31: v0.500.3

### Fixed

- The `--network-seed` argument to hc sandbox was not actually passed on to hc sandbox. Fixed with [#33](https://github.com/holochain/hc-spin/pull/33)

## 2025-07-09: v0.500.2

### Fixed

- Fixes issue [#31](https://github.com/holochain/hc-spin/issues/30) that made initial zome calls fail in cases where the UI loaded faster than the zome call signing logic was ready (PR [#31](https://github.com/holochain/hc-spin/pull/31))

## 2025-04-30: v0.500.1

### Fixed

- Fixed an error that could prevent hc-spin to start up properly (`ERROR: error: invalid value 'undefined' for '--bootstrap <BOOTSTRAP>': relative URL without a base`) ([#25](https://github.com/holochain/hc-spin/pull/25))

## 2025-04-10: v0.500.0-rc.0

### Changed

- Updated to be compatible with holochain 0.5.0-rc.0

## 2025-03-05: v0.500.0-dev.1

### Changed

- Updated `@holochain/client` and `@holochain/hc-spin-rust-utils` to be compatible with holochain 0.5.0-dev.21
