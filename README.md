# hc-spin

CLI to run Holochain apps in development mode.

## Installation

To install the latest version compatible with **holochain 0.4.x**:

⚠️ Requires `@holochain/client 0.18.0` or newer ⚠️

```
npm install --save-dev @holochain/hc-spin@">=0.400.0 <0.500.0"
```

To install the latest version compatible with **holochain 0.5.x**:

⚠️ Requires `@holochain/client 0.19.0-dev.7` or newer ⚠️

```
npm install --save-dev @holochain/hc-spin@">=0.500.0 <0.600.0"
```

## Usage (holochain 0.5)

```
Usage: hc-spin [options] <path>

CLI to run Holochain apps during development.

Arguments:
  path                       Path to .webhapp or .happ file to launch. If a .happ file is passed, either a UI path must be specified via
                             --ui-path or a port pointing to a localhost server via --ui-port

Options:
  -V, --version              output the version number
  --app-id <string>          Install the app with a specific app id. By default the app id is derived from the name of the .webhapp/.happ
                             file that you pass but this option allows you to set it explicitly
  --bootstrap-url <url>      Url of the bootstrap server to use. By default, hc spin spins up a local development bootstrap server for you
                             but this argument allows you to specify a custom one.
  --holochain-path <path>    Set the path to the holochain binary [default: holochain].
  -n, --num-agents <number>  How many agents to spawn the app for.
  --network-seed <string>    Install the app with a specific network seed.
  --ui-path <path>           Path to the folder containing the index.html of the webhapp's UI.
  --ui-port <number>         Port pointing to a localhost dev server that serves your UI assets.
  --signaling-url <url>      Url of the signaling server to use. By default, hc spin spins up a local development signaling server for you
                             but this argument allows you to specify a custom one.
  --open-devtools            Automatically open the devtools on startup.
  -h, --help                 display help for command
```

## Example Commands

Run a .happ file with 2 agents connected to the UI of your dev server running on port 8888:

```
hc-spin -n 2 --ui-port 8888 path/to/your/happ-file.happ
```

Run a fully packaged .webhapp for 2 agents:

```
hc-spin -n 2 path/to/your/webhapp-file.webhapp
```

Run a .happ file with 2 agents connected to the UI assets residing at the provided path:

```
hc-spin -n 2 --ui-path path/to/directory/containing/ui/assets path/to/your/happ-file.happ
```
