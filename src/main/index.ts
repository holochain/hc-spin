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
import { AgentPubKey, AppWebsocket } from '@holochain/client';
import { validateCliArgs } from './validateArgs';

const rustUtils = require('hc-dev-cli-rust-utils');

const cli = new Command();

cli
  .name('hc-spin')
  .description('CLI to run Holochain aps during development.')
  .version(`${app.getVersion()} (for holochain 0.2.x)`)
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
  );

cli.parse();
console.log('Got CLI opts: ', cli.opts());
console.log('Got CLI args: ', cli.args);

// Garbage collect unused directories of previous runs
const files = fs.readdirSync(app.getPath('temp'));
const hcDevCliFolders = files.filter((file) => file.startsWith(`hc-dev-cli-`));
for (const folder of hcDevCliFolders) {
  const folderPath = path.join(app.getPath('temp'), folder);
  const folderFiles = fs.readdirSync(folderPath);
  if (folderFiles.includes('.abandoned')) {
    fs.rmSync(folderPath, { recursive: true, force: true, maxRetries: 4 });
  }
}

// Set app path to temp directory
const DATA_ROOT_DIR = path.join(app.getPath('temp'), `hc-dev-cli-${nanoid(8)}`);

app.setPath('userData', path.join(DATA_ROOT_DIR, 'electron'));

const CLI_OPTS = validateCliArgs(cli.args, cli.opts(), DATA_ROOT_DIR);

// const SANDBOX_DIRECTORIES: Array<string> = [];
const SANDBOX_PROCESSES: childProcess.ChildProcessWithoutNullStreams[] = [];
const WINDOW_INFO_MAP: Record<
  string,
  { agentPubKey: AgentPubKey; zomeCallSigner: ZomeCallSigner }
> = {};

contextMenu({
  showSaveImageAs: true,
  showSearchWithGoogle: false,
  showInspectElement: true,
});

const handleSignZomeCall = (e: IpcMainInvokeEvent, zomeCall: ZomeCallUnsignedNapi) => {
  const windowInfo = WINDOW_INFO_MAP[e.sender.id];
  if (zomeCall.provenance.toString() !== Array.from(windowInfo.agentPubKey).toString())
    return Promise.reject('Agent public key unauthorized.');
  return windowInfo.zomeCallSigner.signZomeCall(zomeCall);
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
  console.log('GENERATE ARGS: ', generateArgs);

  let readyConductors = 0;
  const portsInfo: Record<number, PortsInfo> = {};
  const sandboxPaths: Array<string> = [];
  const lairUrls: string[] = [];

  const sandboxHandle = childProcess.spawn('hc', generateArgs);
  sandboxHandle.stdin.write('pass');
  sandboxHandle.stdin.end();
  return new Promise((resolve) => {
    sandboxHandle.stdout.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-dev-cli] | [hc sandbox]: ${line}`);
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
      console.log(`[hc-dev-cli] | [hc sandbox] ERROR: ${line}`);
    });
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  ipcMain.handle('sign-zome-call', handleSignZomeCall);
  const [bootstrapUrl, signalingUrl] = await startLocalServices();
  // TODO unpack assets to UI dir if webhapp is passed

  //
  const [sandboxHandle, sandboxPaths, portsInfo] = await spawnSandboxes(
    CLI_OPTS.numAgents,
    CLI_OPTS.happOrWebhappPath.path,
    CLI_OPTS.bootstrapUrl ? CLI_OPTS.bootstrapUrl : bootstrapUrl,
    CLI_OPTS.singalingUrl ? CLI_OPTS.singalingUrl : signalingUrl,
    CLI_OPTS.appId,
  );

  const lairUrls: string[] = [];
  sandboxPaths.forEach((sandbox) => {
    console.log('sandbox: ', sandbox);
    const conductorConfigPath = path.join(sandbox, 'conductor-config.yaml');
    const configStr = fs.readFileSync(conductorConfigPath, 'utf-8');
    const lines = configStr.split('\n');
    for (const line of lines) {
      if (line.includes('connection_url')) {
        //   connection_url: unix:///tmp/NgYtyB9jdYSC6BlmNTyra/keystore/socket?k=c-B-bRZIObKsh9c5q899hWjAWsWT28DNQUSElAFLJic
        const lairUrl = line.split('connection_url:')[1].trim();
        lairUrls.push(lairUrl);
        console.log('Got lairUrl form conductor-config.yaml: ', lairUrl);
        break;
      }
    }
  });

  SANDBOX_PROCESSES.push(sandboxHandle);

  // open browser window for each sandbox
  //
  for (var i = 0; i < cli.opts().numAgents; i++) {
    const zomeCallSigner = await rustUtils.ZomeCallSigner.connect(lairUrls[i], 'pass');

    const appPort = portsInfo[i].app_ports[0];
    const appWs = await AppWebsocket.connect(new URL(`ws://127.0.0.1:${appPort}`));
    const appInfo = await appWs.appInfo({ installed_app_id: CLI_OPTS.appId });
    const happWindow = await createHappWindow(
      { type: 'port', port: cli.opts().uiPort },
      CLI_OPTS.appId,
      i + 1,
      appPort,
      DATA_ROOT_DIR,
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  fs.writeFileSync(
    path.join(DATA_ROOT_DIR, '.abandoned'),
    "I'm not in use anymore by an active hc-dev-cli process.",
  );
  // clean up sandboxes
  childProcess.spawnSync('hc', ['sandbox', 'clean']);
  // SANDBOX_PROCESSES.forEach((handle) => handle.kill());
});
