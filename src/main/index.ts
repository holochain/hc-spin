import { app, IpcMainInvokeEvent, ipcMain, protocol, Menu, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { Command, Option } from 'commander';
import contextMenu from 'electron-context-menu';
import split from 'split';
import * as childProcess from 'child_process';
import { ZomeCallNapi, ZomeCallSigner, ZomeCallUnsignedNapi } from '@holochain/hc-spin-rust-utils';
import { createHappWindow } from './windows';
import getPort from 'get-port';
import {
  AdminWebsocket,
  AgentPubKey,
  AppWebsocket,
  CallZomeRequest,
  CallZomeRequestSigned,
  getNonceExpiration,
  randomNonce,
} from '@holochain/client';
import { validateCliArgs } from './validateArgs';
import { encode } from '@msgpack/msgpack';
import { menu } from './menu';

const rustUtils = require('@holochain/hc-spin-rust-utils');

const cliPackageJsonPath = path.resolve(path.join(app.getAppPath(), '../../package.json'));
const cliPackageJson = require(cliPackageJsonPath);

const cli = new Command();

cli
  .name('hc-spin')
  .description('CLI to run Holochain aps during development.')
  .version(`${cliPackageJson.version} (built for holochain ${cliPackageJson.holochainVersion})`)
  .argument(
    '<path>',
    'Path to .webhapp or .happ file to launch. If a .happ file is passed, either a UI path must be specified via --ui-path or a port pointing to a localhost server via --ui-port',
  )
  .option(
    '--app-id <string>',
    'Install the app with a specific app id. By default the app id is derived from the name of the .webhapp/.happ file that you pass but this option allows you to set it explicitly',
  )
  .option(
    '--bootstrap-url <url>',
    'Url of the bootstrap server to use. By default, hc spin spins up a local development bootstrap server for you but this argument allows you to specify a custom one.',
  )
  .option('--holochain-path <path>', 'Set the path to the holochain binary [default: holochain].')
  .addOption(
    new Option('-n, --num-agents <number>', 'How many agents to spawn the app for.').argParser(
      parseInt,
    ),
  )
  .option('--network-seed <string>', 'Install the app with a specific network seed.')
  .option('--ui-path <path>', "Path to the folder containing the index.html of the webhapp's UI.")
  .option(
    '--ui-port <number>',
    'Port pointing to a localhost dev server that serves your UI assets.',
  )
  .option(
    '--signaling-url <url>',
    'Url of the signaling server to use. By default, hc spin spins up a local development signaling server for you but this argument allows you to specify a custom one.',
  )
  .option('--open-devtools', 'Automatically open the devtools on startup.');

cli.parse();
// console.log('Got CLI opts: ', cli.opts());
// console.log('Got CLI args: ', cli.args);

// In nix shell and on Windows SIGINT does not seem to be emitted so it is read from the command line instead.
// https://stackoverflow.com/questions/10021373/what-is-the-windows-equivalent-of-process-onsigint-in-node-js
const rl = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on('SIGINT', function () {
  process.emit('SIGINT');
});

process.on('SIGINT', () => {
  app.quit();
});

// Garbage collect unused directories of previous runs
const files = fs.readdirSync(app.getPath('temp'));
const hcSpinFolders = files.filter((file) => file.startsWith(`hc-spin-`));
for (const folder of hcSpinFolders) {
  const folderPath = path.join(app.getPath('temp'), folder);
  const folderFiles = fs.readdirSync(folderPath);
  if (folderFiles.includes('.abandoned')) {
    fs.rmSync(folderPath, { recursive: true, force: true, maxRetries: 4 });
  }
}

// Set app path to temp directory
const DATA_ROOT_DIR = path.join(app.getPath('temp'), `hc-spin-${nanoid(8)}`);

app.setPath('userData', path.join(DATA_ROOT_DIR, 'electron'));

Menu.setApplicationMenu(menu);

const CLI_OPTS = validateCliArgs(cli.args, cli.opts(), DATA_ROOT_DIR);

// const SANDBOX_DIRECTORIES: Array<string> = [];
const SANDBOX_PROCESSES: childProcess.ChildProcessWithoutNullStreams[] = [];
const WINDOW_INFO_MAP: Record<
  string,
  { agentPubKey: AgentPubKey; zomeCallSigner: ZomeCallSigner }
> = {};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'webhapp',
    privileges: { standard: true },
  },
]);

contextMenu({
  showSaveImageAs: true,
  showSearchWithGoogle: false,
  showInspectElement: true,
  append: (_defaultActions, _parameters, browserWindow) => [
    {
      label: 'Reload',
      click: () => (browserWindow as BrowserWindow).reload(),
    },
  ],
});

const handleSignZomeCall = async (e: IpcMainInvokeEvent, request: CallZomeRequest) => {
  const windowInfo = WINDOW_INFO_MAP[e.sender.id];
  if (request.provenance.toString() !== Array.from(windowInfo.agentPubKey).toString())
    return Promise.reject('Agent public key unauthorized.');

  // console.log("Got zome call request: ", request);
  const zomeCallUnsignedNapi: ZomeCallUnsignedNapi = {
    provenance: Array.from(request.provenance),
    cellId: [Array.from(request.cell_id[0]), Array.from(request.cell_id[1])],
    zomeName: request.zome_name,
    fnName: request.fn_name,
    payload: Array.from(encode(request.payload)),
    nonce: Array.from(await randomNonce()),
    expiresAt: getNonceExpiration(),
  };

  const zomeCallSignedNapi: ZomeCallNapi =
    await windowInfo.zomeCallSigner.signZomeCall(zomeCallUnsignedNapi);

  const zomeCallSigned: CallZomeRequestSigned = {
    provenance: Uint8Array.from(zomeCallSignedNapi.provenance),
    cap_secret: null,
    cell_id: [
      Uint8Array.from(zomeCallSignedNapi.cellId[0]),
      Uint8Array.from(zomeCallSignedNapi.cellId[1]),
    ],
    zome_name: zomeCallSignedNapi.zomeName,
    fn_name: zomeCallSignedNapi.fnName,
    payload: Uint8Array.from(zomeCallSignedNapi.payload),
    signature: Uint8Array.from(zomeCallSignedNapi.signature),
    expires_at: zomeCallSignedNapi.expiresAt,
    nonce: Uint8Array.from(zomeCallSignedNapi.nonce),
  };

  return zomeCallSigned;
};

// https://github.com/holochain/holochain-client-js/issues/221
const handleSignZomeCallLegacy = async (e: IpcMainInvokeEvent, request: ZomeCallUnsignedNapi) => {
  const windowInfo = WINDOW_INFO_MAP[e.sender.id];
  if (request.provenance.toString() !== Array.from(windowInfo.agentPubKey).toString())
    return Promise.reject('Agent public key unauthorized.');

  return windowInfo.zomeCallSigner.signZomeCall(request);
};

async function startLocalServices(): Promise<[string, string]> {
  const localServicesHandle = childProcess.spawn('hc', ['run-local-services']);
  return new Promise((resolve) => {
    let bootStrapUrl;
    let signalUrl;
    let bootstrapRunning = false;
    let signalRunnig = false;
    localServicesHandle.stdout.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-spin] | [hc run-local-services]: ${line}`);
      if (line.includes('HC BOOTSTRAP - ADDR:')) {
        bootStrapUrl = line.split('# HC BOOTSTRAP - ADDR:')[1].trim();
      }
      if (line.includes('HC SIGNAL - ADDR:')) {
        signalUrl = line.split('# HC SIGNAL - ADDR:')[1].trim();
      }
      if (line.includes('HC BOOTSTRAP - RUNNING')) {
        bootstrapRunning = true;
      }
      if (line.includes('HC SIGNAL - RUNNING')) {
        signalRunnig = true;
      }
      if (bootstrapRunning && signalRunnig) resolve([bootStrapUrl, signalUrl]);
    });
    localServicesHandle.stderr.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-spin] | [hc run-local-services] ERROR: ${line}`);
    });
  });
}

type PortsInfo = {
  admin_port: number;
  app_ports: number[];
};

async function spawnSandboxes(
  nAgents: number,
  happPath: string,
  bootStrapUrl: string,
  signalUrl: string,
  appId: string,
  networkSeed?: string,
): Promise<
  [childProcess.ChildProcessWithoutNullStreams, Array<string>, Record<number, PortsInfo>]
> {
  const generateArgs = [
    'sandbox',
    '--piped',
    'generate',
    '--num-sandboxes',
    nAgents.toString(),
    '--app-id',
    appId,
    '--run',
  ];
  let appPorts = '';
  for (var i = 1; i <= nAgents; i++) {
    const appPort = await getPort();
    appPorts += `${appPort},`;
  }
  generateArgs.push(appPorts.slice(0, appPorts.length - 1));

  if (networkSeed) {
    generateArgs.push('--network-seed');
    generateArgs.push(networkSeed);
  }
  generateArgs.push(happPath, 'network', '--bootstrap', bootStrapUrl, 'webrtc', signalUrl);
  // console.log('GENERATE ARGS: ', generateArgs);

  let readyConductors = 0;
  const portsInfo: Record<number, PortsInfo> = {};
  const sandboxPaths: Array<string> = [];
  const lairUrls: string[] = [];

  const sandboxHandle = childProcess.spawn('hc', generateArgs);
  sandboxHandle.stdin.write('pass');
  sandboxHandle.stdin.end();
  return new Promise((resolve) => {
    sandboxHandle.stdout.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-spin] | [hc sandbox]: ${line}`);
      if (line.includes('Created directory at:')) {
        // hc-sandbox: Created directory at: /tmp/v7cLY7ls3onZFMmyrFi5y Keep this path to rerun the same sandbox. It has also been saved to a file called `.hc` in your current working directory.
        const sanboxPath = line
          .split('\x1B[1;4;48;5;254;38;5;4m')[1]
          .split('\x1B[0m \x1B[1m')[0]
          .trim();

        sandboxPaths.push(sanboxPath);
      }
      if (line.includes('lair-keystore connection_url')) {
        const lairKeystoreUrl = line.split('#')[2].trim();
        lairUrls.push(lairKeystoreUrl);
      }
      if (line.includes('Conductor launched')) {
        // hc-sandbox: Conductor launched #!1 {"admin_port":37045,"app_ports":[]}
        const split1 = line.split('{');
        const ports: PortsInfo = JSON.parse(`{${split1[1]}`);
        const conductorNum = split1[0].split('#!')[1].trim();
        portsInfo[conductorNum] = ports;
        // hc-sandbox: Conductor launched #!1 {"admin_port":32805,"app_ports":[45309]}
        readyConductors += 1;
        if (readyConductors === nAgents) resolve([sandboxHandle, sandboxPaths, portsInfo]);
      }
    });
    sandboxHandle.stderr.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-spin] | [hc sandbox] ERROR: ${line}`);
    });
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  ipcMain.handle('sign-zome-call', handleSignZomeCall);
  ipcMain.handle('sign-zome-call-legacy', handleSignZomeCallLegacy);

  let happTargetDir: string | undefined;
  // TODO unpack assets to UI dir if webhapp is passed
  if (CLI_OPTS.happOrWebhappPath.type === 'webhapp') {
    happTargetDir = path.join(DATA_ROOT_DIR, 'apps', CLI_OPTS.appId);
    const uiTargetDir = path.join(happTargetDir, 'ui');
    await rustUtils.saveHappOrWebhapp(
      CLI_OPTS.happOrWebhappPath.path,
      CLI_OPTS.appId,
      uiTargetDir,
      happTargetDir,
    );
  }

  const [bootstrapUrl, signalingUrl] = await startLocalServices();

  const [sandboxHandle, sandboxPaths, portsInfo] = await spawnSandboxes(
    CLI_OPTS.numAgents,
    happTargetDir ? happTargetDir : CLI_OPTS.happOrWebhappPath.path,
    CLI_OPTS.bootstrapUrl ? CLI_OPTS.bootstrapUrl : bootstrapUrl,
    CLI_OPTS.singalingUrl ? CLI_OPTS.singalingUrl : signalingUrl,
    CLI_OPTS.appId,
  );

  const lairUrls: string[] = [];
  sandboxPaths.forEach((sandbox) => {
    const conductorConfigPath = path.join(sandbox, 'conductor-config.yaml');
    const configStr = fs.readFileSync(conductorConfigPath, 'utf-8');
    const lines = configStr.split('\n');
    for (const line of lines) {
      if (line.includes('connection_url')) {
        //   connection_url: unix:///tmp/NgYtyB9jdYSC6BlmNTyra/keystore/socket?k=c-B-bRZIObKsh9c5q899hWjAWsWT28DNQUSElAFLJic
        const lairUrl = line.split('connection_url:')[1].trim();
        lairUrls.push(lairUrl);
        // console.log('Got lairUrl form conductor-config.yaml: ', lairUrl);
        break;
      }
    }
  });

  SANDBOX_PROCESSES.push(sandboxHandle);

  // open browser window for each sandbox
  //
  for (var i = 0; i < CLI_OPTS.numAgents; i++) {
    const zomeCallSigner = await rustUtils.ZomeCallSigner.connect(lairUrls[i], 'pass');

    const adminPort = portsInfo[i].admin_port;
    const adminWs = await AdminWebsocket.connect({
      url: new URL(`ws://localhost:${adminPort}`),
      wsClientOptions: {
        origin: 'hc-spin',
      },
    });

    const appAuthTokenResponse = await adminWs.issueAppAuthenticationToken({
      installed_app_id: CLI_OPTS.appId,
      single_use: false,
      expiry_seconds: 999999,
    });

    const appPort = portsInfo[i].app_ports[0];
    const appWs = await AppWebsocket.connect({
      url: new URL(`ws://localhost:${appPort}`),
      wsClientOptions: {
        origin: 'hc-spin',
      },
      token: appAuthTokenResponse.token,
    });
    const appInfo = await appWs.appInfo();
    if (!appInfo) throw new Error('AppInfo is null.');
    const happWindow = await createHappWindow(
      CLI_OPTS.uiSource,
      CLI_OPTS.happOrWebhappPath,
      CLI_OPTS.appId,
      i + 1,
      appPort,
      appAuthTokenResponse.token,
      DATA_ROOT_DIR,
      CLI_OPTS.openDevtools,
    );
    WINDOW_INFO_MAP[happWindow.webContents.id] = {
      agentPubKey: appInfo.agent_pub_key,
      zomeCallSigner,
    };
  }

  // app.on('activate', function () {
  //   // On macOS it's common to re-create a window in the app when the
  //   // dock icon is clicked and there are no other windows open.
  //   if (BrowserWindow.getAllWindows().length === 0) createWindow();
  // });
});

app.on('quit', () => {
  fs.writeFileSync(
    path.join(DATA_ROOT_DIR, '.abandoned'),
    "I'm not in use anymore by an active hc-spin process.",
  );
  // clean up sandboxes
  SANDBOX_PROCESSES.forEach((handle) => handle.kill());
  childProcess.spawnSync('hc', ['sandbox', 'clean']);
});
