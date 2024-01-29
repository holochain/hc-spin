import { app, IpcMainInvokeEvent, ipcMain, protocol, Menu } from 'electron';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { Command, Option } from 'commander';
import contextMenu from 'electron-context-menu';
import split from 'split';
import * as childProcess from 'child_process';
import { ZomeCallNapi, ZomeCallSigner, ZomeCallUnsignedNapi } from '@holochain/hc-spin-rust-utils';
import { encode } from '@msgpack/msgpack';
import { createHappWindow } from './windows';
import getPort from 'get-port';
import {
  AgentPubKey,
  AppWebsocket,
  CallZomeRequest,
  CallZomeRequestSigned,
  getNonceExpiration,
  randomNonce,
} from '@holochain/client';
import { validateCliArgs } from './validateArgs';
import { menu } from './menu';

const rustUtils = require('@holochain/hc-spin-rust-utils');

const cli = new Command();

cli
  .name('hc-spin')
  .description('CLI to run Holochain apps during development.')
  .version(`0.100.4 (for holochain 0.1.x)`)
  .argument(
    '<path>',
    'Path to .webhapp or .happ file to launch. If a .happ file is passed, either a UI path must be specified via --ui-path or a port pointing to a localhost server via --ui-port',
  )
  .option(
    '--app-id <string>',
    'Install the app with a specific app id. By default the app id is derived from the name of the .webhapp/.happ file that you pass but this option allows you to set it explicitly',
  )
  .option('--holochain-path <path>', 'Set the path to the holochain binary [default: holochain].')
  .addOption(
    new Option('-n, --num-agents <number>', 'How many agents to spawn the app for.').argParser(
      parseInt,
    ),
  )
  .option('--ui-path <path>', "Path to the folder containing the index.html of the webhapp's UI.")
  .option(
    '--ui-port <number>',
    'Port pointing to a localhost dev server that serves your UI assets.',
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

async function spawnSandboxes(
  nAgents: number,
  happPath: string,
  appId: string,
): Promise<[childProcess.ChildProcessWithoutNullStreams, Array<string>, Array<number>]> {
  const generateArgs = [
    'sandbox',
    '--piped',
    'generate',
    '--num-sandboxes',
    nAgents.toString(),
    '--app-id',
    appId,
  ];

  const appPorts: number[] = [];
  let appPortsString = '';
  for (var i = 1; i <= nAgents; i++) {
    const appPort = await getPort();
    appPortsString += `${appPort},`;
    appPorts.push(appPort);
  }
  if (nAgents === 1) {
    generateArgs.push(`--run=${appPortsString.slice(0, appPortsString.length - 1)}`);
  } else {
    generateArgs.push('--run', appPortsString.slice(0, appPortsString.length - 1));
  }

  // const adminPorts: number[] = [];
  // let adminPortsString = '';
  // for (var i = 1; i <= nAgents; i++) {
  //   const adminPort = await getPort();
  //   adminPortsString += `${adminPort},`;
  //   adminPorts.push(adminPort);
  // }
  // generateArgs.push('--force-admin-ports', adminPortsString.slice(0, adminPortsString.length - 1));

  generateArgs.push(happPath, 'network', 'mdns');
  // console.log('GENERATE ARGS: ', generateArgs);

  let readyConductors = 0;
  const sandboxPaths: Array<string> = [];

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
      if (line.includes('Running conductor on admin port')) {
        readyConductors += 1;
        if (readyConductors === nAgents) resolve([sandboxHandle, sandboxPaths, appPorts]);
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

  const [sandboxHandle, sandboxPaths, appPorts] = await spawnSandboxes(
    CLI_OPTS.numAgents,
    happTargetDir ? happTargetDir : CLI_OPTS.happOrWebhappPath.path,
    CLI_OPTS.appId,
  );

  console.log('Got app ports: ', appPorts);

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

  // console.log('Got CLI_OPTS: ', CLI_OPTS);

  // open browser window for each sandbox
  //
  for (var i = 0; i < CLI_OPTS.numAgents; i++) {
    const zomeCallSigner = await rustUtils.ZomeCallSigner.connect(lairUrls[i], 'pass');

    const appWs = await AppWebsocket.connect(new URL(`ws://127.0.0.1:${appPorts[i]}`));
    const appInfo = await appWs.appInfo({ installed_app_id: CLI_OPTS.appId });
    const happWindow = await createHappWindow(
      CLI_OPTS.uiSource,
      CLI_OPTS.happOrWebhappPath,
      CLI_OPTS.appId,
      i + 1,
      appPorts[i],
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

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  app.quit();
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
