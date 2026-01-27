import {
  AdminWebsocket,
  AgentPubKey,
  AppInfo,
  AppWebsocket,
  CallZomeRequest,
  CallZomeRequestSigned,
  getNonceExpiration,
  InstallAppRequest,
  randomNonce,
} from '@holochain/client';
import { ZomeCallSigner } from '@holochain/hc-spin-rust-utils';
import { encode } from '@msgpack/msgpack';
import * as childProcess from 'child_process';
import { Command, Option } from 'commander';
import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, Menu, protocol } from 'electron';
import contextMenu from 'electron-context-menu';
import fs from 'fs';
import getPort from 'get-port';
import { sha512 } from 'js-sha512';
import { nanoid } from 'nanoid';
import path from 'path';
import split from 'split';

import { menu } from './menu';
import { Transport, validateCliArgs } from './validateArgs';
import { createHappWindow, loadHappWindow } from './windows';

const rustUtils = require('@holochain/hc-spin-rust-utils');

const cli = new Command();

cli
  .name('hc-spin')
  .description('CLI to run Holochain apps during development.')
  .version(`${__PACKAGE_VERSION__} (built for holochain ${__HOLOCHAIN_VERSION__})`)
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
  .option(
    '--network-seeds <seeds...>',
    'Install the app with specific network seeds (one per agent). Comma-separated or space-separated values.',
  )
  .option(
    '--single-conductor',
    'Install all agents on the same conductor instead of creating separate conductors.',
  )
  .addOption(
    new Option(
      '-t, --target-arc-factor <number>',
      'Set the target arc factor for all conductors. In normal operation, leave this as the default 1. For leacher/zero-arc nodes that do not contribute to gossip, set to 0.',
    ).argParser(parseInt),
  )
  .option('--ui-path <path>', "Path to the folder containing the index.html of the webhapp's UI.")
  .option(
    '--ui-port <number>',
    'Port pointing to a localhost dev server that serves your UI assets.',
  )
  .option(
    '--signaling-url <url>',
    'Url of the signaling server to use. By default, hc spin spins up a local development signaling server for you but this argument allows you to specify a custom one.',
  )
  .option('--open-devtools', 'Automatically open the devtools on startup.')
  .option(
    '--transport <quic|webrtc>',
    'Configure network transport. Defaults to quic, compatible with the iroh transport used in in Holochain by default. Set to `webrtc` for tx5 transport.',
  );

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
    privileges: { standard: true, secure: true, stream: true },
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

const handleSignZomeCall = async (
  e: IpcMainInvokeEvent,
  request: CallZomeRequest,
): Promise<CallZomeRequestSigned> => {
  const windowInfo = WINDOW_INFO_MAP[e.sender.id];
  if (!request.provenance)
    return Promise.reject(
      'Call zome request has provenance field not set. This should be set by the js-client.',
    );
  if (request.provenance.toString() !== Array.from(windowInfo.agentPubKey).toString())
    return Promise.reject('Agent public key unauthorized.');

  const zomeCallToSign: CallZomeRequest = {
    cell_id: request.cell_id,
    zome_name: request.zome_name,
    fn_name: request.fn_name,
    payload: encode(request.payload),
    provenance: request.provenance,
    nonce: await randomNonce(),
    expires_at: getNonceExpiration(),
  };

  const zomeCallBytes = encode(zomeCallToSign);
  const bytesHash = sha512.array(zomeCallBytes);

  const signature: number[] = await windowInfo.zomeCallSigner.signZomeCall(
    bytesHash,
    Array.from(request.provenance),
  );

  const signedZomeCall: CallZomeRequestSigned = {
    bytes: zomeCallBytes,
    signature: Uint8Array.from(signature),
  };

  return signedZomeCall;
};

async function startLocalServices(transport: Transport): Promise<[string, string]> {
  const localServicesHandle = childProcess.spawn('kitsune2-bootstrap-srv');
  return new Promise((resolve) => {
    let bootStrapUrl;
    let signalUrl;
    let bootstrapRunning = false;
    let signalRunnig = false;
    localServicesHandle.stdout.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-spin] | [kitsune2-bootstrap-srv]: ${line}`);
      if (line.includes('#kitsune2_bootstrap_srv#listening#')) {
        const hostAndPort = line.split('#kitsune2_bootstrap_srv#listening#')[1].split('#')[0];
        bootStrapUrl = `http://${hostAndPort}`;
        signalUrl = transport === 'quic' ? `http://${hostAndPort}` : `ws://${hostAndPort}`;
      }
      if (line.includes('#kitsune2_bootstrap_srv#running#')) {
        bootstrapRunning = true;
        signalRunnig = true;
      }
      if (bootstrapRunning && signalRunnig && bootStrapUrl && signalUrl)
        resolve([bootStrapUrl, signalUrl]);
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

type SingleSandboxInfo = {
  sandboxHandle: childProcess.ChildProcessWithoutNullStreams;
  sandboxPath: string;
  lairUrl: string;
  adminPort: number;
  portsInfo: PortsInfo;
};

async function spawnSingleSandbox(
  happPath: string,
  bootStrapUrl: string,
  signalUrl: string,
  appId: string,
  transport: Transport,
  networkSeed?: string,
  targetArcFactor?: number,
): Promise<SingleSandboxInfo> {
  const generateArgs = [
    'sandbox',
    '--piped',
    'generate',
    '--num-sandboxes',
    '1',
    '--app-id',
    appId,
    '--run',
  ];
  const appPort = await getPort();
  generateArgs.push(appPort.toString());

  if (networkSeed) {
    generateArgs.push('--network-seed');
    generateArgs.push(networkSeed);
  }
  generateArgs.push(happPath, 'network');
  if (targetArcFactor !== undefined) {
    generateArgs.push('--target-arc-factor', targetArcFactor.toString());
  }
  generateArgs.push('--bootstrap', bootStrapUrl, transport, signalUrl);

  let sandboxPath: string | undefined;
  let lairUrl: string | undefined;
  let portsInfo: PortsInfo | undefined;

  const sandboxHandle = childProcess.spawn('hc', generateArgs);
  sandboxHandle.stdin.write('pass');
  sandboxHandle.stdin.end();
  return new Promise((resolve, reject) => {
    sandboxHandle.stdout.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-spin] | [hc sandbox]: ${line}`);
      if (line.includes('Created directory at:')) {
        sandboxPath = line.split('\x1B[1;4;48;5;254;38;5;4m')[1].split('\x1B[0m \x1B[1m')[0].trim();
      }
      if (line.includes('lair-keystore connection_url')) {
        lairUrl = line.split('#')[2].trim();
      }
      if (line.includes('Conductor launched')) {
        const split1 = line.split('{');
        portsInfo = JSON.parse(`{${split1[1]}`);
        if (sandboxPath && lairUrl && portsInfo) {
          resolve({
            sandboxHandle,
            sandboxPath,
            lairUrl,
            adminPort: portsInfo.admin_port,
            portsInfo,
          });
        }
      }
    });
    sandboxHandle.stderr.pipe(split()).on('data', async (line: string) => {
      console.log(`[hc-spin] | [hc sandbox] ERROR: ${line}`);
    });
    sandboxHandle.on('error', (error) => {
      reject(error);
    });
  });
}

async function spawnSandboxes(
  nAgents: number,
  happPath: string,
  bootStrapUrl: string,
  signalUrl: string,
  appId: string,
  transport: Transport,
  networkSeed?: string,
  targetArcFactor?: number,
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
  for (let i = 1; i <= nAgents; i++) {
    const appPort = await getPort();
    appPorts += `${appPort},`;
  }
  generateArgs.push(appPorts.slice(0, appPorts.length - 1));

  if (networkSeed) {
    generateArgs.push('--network-seed');
    generateArgs.push(networkSeed);
  }
  generateArgs.push(happPath, 'network');
  if (targetArcFactor !== undefined) {
    generateArgs.push('--target-arc-factor', targetArcFactor.toString());
  }
  generateArgs.push('--bootstrap', bootStrapUrl, transport, signalUrl);

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

type AgentInstallInfo = {
  installedAppId: string;
  agentPubKey: AgentPubKey;
  appInfo: AppInfo;
  appPort: number;
};

async function installAdditionalAgentsViaSandbox(
  adminPort: number,
  happPath: string,
  baseAppId: string,
  numAgents: number,
  networkSeeds?: string[],
  networkSeed?: string,
): Promise<AgentInstallInfo[]> {
  const adminWs = await AdminWebsocket.connect({
    url: new URL(`ws://localhost:${adminPort}`),
    wsClientOptions: {
      origin: 'hc-spin',
    },
  });

  const agentInfos: AgentInstallInfo[] = [];

  // First agent is already installed by spawnSingleSandbox, so start from agent 2
  for (let i = 2; i <= numAgents; i++) {
    const installedAppId = `${baseAppId}-agent-${i}`;

    // Generate agent key
    const agentPubKey = await adminWs.generateAgentPubKey();

    // Determine network seed for this agent
    const agentNetworkSeed =
      networkSeeds && networkSeeds[i - 1] ? networkSeeds[i - 1] : networkSeed;

    // Install app
    const installRequest: InstallAppRequest = {
      source: { type: 'path', value: happPath },
      agent_key: agentPubKey,
      installed_app_id: installedAppId,
      ...(agentNetworkSeed ? { network_seed: agentNetworkSeed } : {}),
    };

    const appInfo = await adminWs.installApp(installRequest);
    // enable app
    await adminWs.enableApp({
      installed_app_id: installedAppId,
    });
    // Attach app interface and get port
    const attachResponse = await adminWs.attachAppInterface({
      allowed_origins: '*',
      installed_app_id: installedAppId,
    });

    agentInfos.push({
      installedAppId,
      agentPubKey,
      appInfo,
      appPort: attachResponse.port,
    });
  }

  await adminWs.client.close();
  return agentInfos;
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  ipcMain.handle('sign-zome-call', handleSignZomeCall);

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

  const [bootstrapUrl, signalingUrl] = await startLocalServices(CLI_OPTS.transport);
  const happPath = happTargetDir ? happTargetDir : CLI_OPTS.happOrWebhappPath.path;

  if (CLI_OPTS.singleConductor) {
    // Single conductor mode: install all agents on one conductor
    const firstAgentNetworkSeed =
      CLI_OPTS.networkSeeds && CLI_OPTS.networkSeeds[0]
        ? CLI_OPTS.networkSeeds[0]
        : CLI_OPTS.networkSeed;

    const singleSandbox = await spawnSingleSandbox(
      happPath,
      CLI_OPTS.bootstrapUrl ? CLI_OPTS.bootstrapUrl : bootstrapUrl,
      CLI_OPTS.singalingUrl ? CLI_OPTS.singalingUrl : signalingUrl,
      CLI_OPTS.appId,
      CLI_OPTS.transport,
      firstAgentNetworkSeed,
      CLI_OPTS.targetArcFactor,
    );

    SANDBOX_PROCESSES.push(singleSandbox.sandboxHandle);

    // Get lair URL from conductor config
    const conductorConfigPath = path.join(singleSandbox.sandboxPath, 'conductor-config.yaml');
    const configStr = fs.readFileSync(conductorConfigPath, 'utf-8');
    const lines = configStr.split('\n');
    let lairUrl: string | undefined;
    for (const line of lines) {
      if (line.includes('connection_url')) {
        lairUrl = line.split('connection_url:')[1].trim();
        break;
      }
    }
    if (!lairUrl) throw new Error('Could not find lair URL in conductor config');

    // Install additional agents (agents 2 to N)
    const additionalAgents =
      CLI_OPTS.numAgents > 1
        ? await installAdditionalAgentsViaSandbox(
            singleSandbox.adminPort,
            happPath,
            CLI_OPTS.appId,
            CLI_OPTS.numAgents,
            CLI_OPTS.networkSeeds,
            CLI_OPTS.networkSeed,
          )
        : [];

    // Get first agent's info and attach app interface
    const adminWs = await AdminWebsocket.connect({
      url: new URL(`ws://localhost:${singleSandbox.adminPort}`),
      wsClientOptions: {
        origin: 'hc-spin',
      },
    });

    // Ensure app is enabled (though hc sandbox generate should already do this)
    await adminWs.enableApp({
      installed_app_id: CLI_OPTS.appId,
    });

    // Attach app interface for first agent
    const firstAgentAttachResponse = await adminWs.attachAppInterface({
      allowed_origins: '*',
      installed_app_id: CLI_OPTS.appId,
    });

    // Get first agent's app info
    const firstAgentAppWs = await AppWebsocket.connect({
      url: new URL(`ws://localhost:${firstAgentAttachResponse.port}`),
      wsClientOptions: {
        origin: 'hc-spin',
      },
      token: (
        await adminWs.issueAppAuthenticationToken({
          installed_app_id: CLI_OPTS.appId,
          single_use: false,
          expiry_seconds: 999999,
        })
      ).token,
    });
    const firstAgentAppInfo = await firstAgentAppWs.appInfo();
    if (!firstAgentAppInfo) throw new Error('First agent AppInfo is null.');

    // Verify all apps are installed
    const allApps = await adminWs.listApps({});
    console.log(
      `[hc-spin] | Installed apps: ${allApps.map((app) => app.installed_app_id).join(', ')}`,
    );

    // Create windows for all agents
    const zomeCallSigner = await rustUtils.ZomeCallSigner.connect(lairUrl, 'pass');

    // First agent
    const firstAgentToken = (
      await adminWs.issueAppAuthenticationToken({
        installed_app_id: CLI_OPTS.appId,
        single_use: false,
        expiry_seconds: 999999,
      })
    ).token;

    const firstHappWindow = await createHappWindow(
      CLI_OPTS.uiSource,
      CLI_OPTS.appId,
      1,
      firstAgentAttachResponse.port,
      firstAgentToken,
      DATA_ROOT_DIR,
    );
    WINDOW_INFO_MAP[firstHappWindow.webContents.id] = {
      agentPubKey: firstAgentAppInfo.agent_pub_key,
      zomeCallSigner,
    };
    await loadHappWindow(
      firstHappWindow,
      CLI_OPTS.uiSource,
      CLI_OPTS.happOrWebhappPath,
      1,
      CLI_OPTS.openDevtools,
    );

    // Additional agents
    for (const agentInfo of additionalAgents) {
      const agentNum = parseInt(agentInfo.installedAppId.split('-agent-')[1]);
      const agentToken = (
        await adminWs.issueAppAuthenticationToken({
          installed_app_id: agentInfo.installedAppId,
          single_use: false,
          expiry_seconds: 999999,
        })
      ).token;

      const happWindow = await createHappWindow(
        CLI_OPTS.uiSource,
        agentInfo.installedAppId,
        agentNum,
        agentInfo.appPort,
        agentToken,
        DATA_ROOT_DIR,
      );
      WINDOW_INFO_MAP[happWindow.webContents.id] = {
        agentPubKey: agentInfo.agentPubKey,
        zomeCallSigner,
      };
      await loadHappWindow(
        happWindow,
        CLI_OPTS.uiSource,
        CLI_OPTS.happOrWebhappPath,
        agentNum,
        CLI_OPTS.openDevtools,
      );
    }

    await adminWs.client.close();
  } else {
    // Multi-conductor mode: existing behavior
    const [sandboxHandle, sandboxPaths, portsInfo] = await spawnSandboxes(
      CLI_OPTS.numAgents,
      happPath,
      CLI_OPTS.bootstrapUrl ? CLI_OPTS.bootstrapUrl : bootstrapUrl,
      CLI_OPTS.singalingUrl ? CLI_OPTS.singalingUrl : signalingUrl,
      CLI_OPTS.appId,
      CLI_OPTS.transport,
      CLI_OPTS.networkSeed,
      CLI_OPTS.targetArcFactor,
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
    for (let i = 0; i < CLI_OPTS.numAgents; i++) {
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
        CLI_OPTS.appId,
        i + 1,
        appPort,
        appAuthTokenResponse.token,
        DATA_ROOT_DIR,
      );
      // We need to add the window to the window map before loading its UI, otherwise
      // zome calls can be made before handleSignZomeCall() can verify that the
      // zome call is made from an authorized window (https://github.com/holochain/hc-spin/issues/30)
      WINDOW_INFO_MAP[happWindow.webContents.id] = {
        agentPubKey: appInfo.agent_pub_key,
        zomeCallSigner,
      };
      await loadHappWindow(
        happWindow,
        CLI_OPTS.uiSource,
        CLI_OPTS.happOrWebhappPath,
        i + 1,
        CLI_OPTS.openDevtools,
      );
    }
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
