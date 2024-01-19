import { app, IpcMainInvokeEvent, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { Command, Option } from 'commander';
import contextMenu from 'electron-context-menu';
import split from 'split';
import * as childProcess from 'child_process';
import { ZomeCallSigner, ZomeCallUnsignedNapi } from 'hc-dev-cli-rust-utils';
import { createHappWindow } from './windows';
import getPort from 'get-port';
import { AdminWebsocket, AgentPubKey, AppWebsocket } from '@holochain/client';

const rustUtils = require('hc-dev-cli-rust-utils');

const cli = new Command();

cli
  .name('Holochain App Development CLI')
  .description('CLI to run Holochain aps during development.')
  .version(`${app.getVersion()} (for holochain 0.2.x)`)
  .argument(
    '<path>',
    'Path to .webhapp or .happ file to launch. If a .happ file is passed, either a UI path must be specified via --ui-path or a port pointing to a localhost server via --ui-port',
  )
  .addOption(
    new Option('-n, --num-agents <number>', 'How many agents to spawn the app for.').argParser(
      parseInt,
    ),
  )
  .option('--ui-path <path>', "Path to the folder containing the index.html of the webhapp's UI.")
  .option(
    '--ui-port <number>',
    'Port pointing to a localhost dev server that serves your UI assets.',
  );

cli.parse();
console.log('Got CLI opts: ', cli.opts());
console.log('Got CLI args: ', cli.args);

// Set app path to temp directory

const DATA_ROOT_DIR = path.join(app.getPath('temp'), `hc-dev-cli-${nanoid(8)}`);

app.setPath('userData', path.join(DATA_ROOT_DIR, 'electron'));

// const SANDBOX_DIRECTORIES: Array<string> = [];
const SANDBOX_PROCESSES: childProcess.ChildProcessWithoutNullStreams[] = [];
let LAIR_KEYSTORE_URL: string | undefined;
let ZOME_CALL_SIGNER: ZomeCallSigner | undefined;
const WINDOW_INFO_MAP: Record<string, AgentPubKey> = {};

contextMenu({
  showSaveImageAs: true,
  showSearchWithGoogle: false,
  showInspectElement: true,
});

const handleSignZomeCall = (e: IpcMainInvokeEvent, zomeCall: ZomeCallUnsignedNapi) => {
  const windowPubKey = WINDOW_INFO_MAP[e.sender.id];
  if (zomeCall.provenance.toString() !== Array.from(windowPubKey).toString())
    return Promise.reject('Agent public key unauthorized.');
  if (!ZOME_CALL_SIGNER) throw new Error('Zome call signer not ready.');
  return ZOME_CALL_SIGNER.signZomeCall(zomeCall);
};

async function startLocalServices(): Promise<[string, string]> {
  const localServicesHandle = childProcess.spawn('hc', ['run-local-services']);
  return new Promise((resolve) => {
    let bootStrapUrl;
    let signalUrl;
    let bootstrapRunning = false;
    let signalRunnig = false;
    localServicesHandle.stdout.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-dev-cli] | [hc run-local-services]: ${line}`);
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
      console.log(`[hc-dev-cli] | [hc run-local-services] ERROR: ${line}`);
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
): Promise<[childProcess.ChildProcessWithoutNullStreams, Array<PortsInfo>]> {
  console.log('GOT HAPP PATH: ', happPath);
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
  console.log('GENERATE ARGS: ', generateArgs);

  let readyConductors = 0;
  const portsInfo: PortsInfo[] = [];

  const sandboxHandle = childProcess.spawn('hc', generateArgs);
  sandboxHandle.stdin.write('pass');
  sandboxHandle.stdin.end();
  return new Promise((resolve) => {
    sandboxHandle.stdout.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-dev-cli] | [hc sandbox]: ${line}`);
      if (line.includes('lair-keystore connection_url')) {
        LAIR_KEYSTORE_URL = line.split('#')[2].trim();
        console.log('GOT LAIR_KEYSTORE_URL: ', LAIR_KEYSTORE_URL);
      }
      if (line.includes('Conductor launched')) {
        const ports: PortsInfo = JSON.parse(`{${line.split('{')[1]}`);
        console.log('READ PORTS: ', ports);
        portsInfo.push(ports);
        // hc-sandbox: Conductor launched #!1 {"admin_port":32805,"app_ports":[45309]}
        readyConductors += 1;
        if (readyConductors === nAgents) resolve([sandboxHandle, portsInfo]);
      }
    });
    sandboxHandle.stderr.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-dev-cli] | [hc sandbox] ERROR: ${line}`);
    });
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  ipcMain.handle('sign-zome-call', handleSignZomeCall);
  const [bootstrapUrl, signalUrl] = await startLocalServices();
  console.log('GOT BOOTSTRAP AND SIGNAL URL: ', bootstrapUrl, signalUrl);
  const [sandboxHandle, portsInfo] = await spawnSandboxes(
    2,
    cli.args[0],
    bootstrapUrl,
    signalUrl,
    'happ',
  );

  SANDBOX_PROCESSES.push(sandboxHandle);

  ZOME_CALL_SIGNER = await rustUtils.ZomeCallSigner.connect(LAIR_KEYSTORE_URL, 'pass');

  // open browser window for each sandbox
  //
  for (var i = 1; i <= cli.opts().numAgents; i++) {
    const appPort = portsInfo[i - 1].app_ports[0];
    const appWs = await AppWebsocket.connect(new URL(`ws://127.0.0.1:${appPort}`));
    const appInfo = await appWs.appInfo({ installed_app_id: 'happ' });
    const happWindow = createHappWindow(
      { type: 'port', port: cli.opts().uiPort },
      'happ',
      i,
      appPort,
      DATA_ROOT_DIR,
    );
    WINDOW_INFO_MAP[happWindow.webContents.id] = appInfo.agent_pub_key;
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  console.log('QUITTING.');
  // SANDBOX_PROCESSES.forEach((handle) => handle.kill());
  fs.rmSync(DATA_ROOT_DIR, { recursive: true, force: true, maxRetries: 4 });
});
