## Dev Setup

To setup the development environment to develop on the CLI itself:

1. Enter the nix shell:

```bash
nix develop
```

2. Install dependencies:

```bash
yarn
```

3. Build the CLI:

```bash
yarn build
```

4. Run the CLI:

```bash
yarn start <path to .webhapp file>
```

## Upgrade hc-spin to a new holochain version

0. Update the flake.nix file if necessary and run `nix flake update`.
1. Upgrade the upstream `@holochain/hc-spin-rust-utils` package [in this repo](https://github.com/holochain/hc-spin-rust-utils), following the instructions in its README. This may involve manual testing of a locally built `@holochain/hc-spin-rust-utils` here in the hc-spin repo. In that case, make sure to have entered nix shell with `nix develop` before testing, such that the correct holochain binary is being used by hc-spin.
2. Once the new `@holochain/hc-spin-rust-utils` package has been upgraded and released, update it accordingly in the `package.json` file.
3. Update `@holochain/client` in the `package.json` file to the appropriate version.
4. Check whether any code changes are necessary after updating the packages. Once the code has been adapted, test it with `yarn start <path to .webhapp file>`.
5. If testing succeeds, update the `version` field in `package.json`.
6. Make any changes as necessary to the README. The README is what is shown on npmjs.org as the package description so it should be up to date.
7. Build the hc-spin binary with `yarn build`.
8. And finally publish it with `npm publish`.
