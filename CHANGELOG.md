# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## \[Unreleased\]

### Added
### Fixed
### Changed
### Removed

## 2026-01-22: v0.600.2-rc.0

### Changed
- Added a CLI option `--transport` to choose between `quic` and `webrtc`. `quic` is used in combination with the iroh transport in Holochain, `webrtc` with tx5. The default transport in Holochain is iroh, so the default for hc-spin is `quic`. If no transport option is passed in on the command line, `quic` is used.

## 2026-01-22: v0.600.1-rc.0

### Changed

- Bumped to holochain 0.6.1-rc.0

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
