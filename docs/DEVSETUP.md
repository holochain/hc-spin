## Dev Setup

To setup the development environment to develop on the CLI itself:

1. Install dependencies:

```
yarn
```

2. Build Rust node add-ons (requires Rust + Go installed)

```
yarn setup
```

3. Run the CLI in development mode

```
yarn dev -- -- [your CLI arguments here]

```

for example

```
yarn dev -- -- --help
```

to invoke the help menu showing the available CLI arguments and options.

4. Building the CLI:

```
yarn build
```
