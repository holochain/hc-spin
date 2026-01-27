import fs from 'fs';
import path from 'path';

import { UISource } from './windows';

export type Transport = 'quic' | 'webrtc';

export type CliOpts = {
  appId?: string;
  holochainPath?: string;
  numAgents?: number;
  networkSeed?: string;
  networkSeeds?: string[];
  targetArcFactor?: number;
  uiPath?: string;
  uiPort?: number;
  signalingUrl?: string;
  bootstrapUrl?: string;
  openDevtools?: boolean;
  singleConductor?: boolean;
  transport?: Transport;
};

export type CliOptsValidated = {
  appId: string;
  holochainPath: string | undefined;
  numAgents: number;
  networkSeed: string | undefined;
  networkSeeds: string[] | undefined;
  targetArcFactor: number | undefined;
  uiSource: UISource;
  singalingUrl: string | undefined;
  bootstrapUrl: string | undefined;
  happOrWebhappPath: HappOrWebhappPath;
  openDevtools: boolean;
  singleConductor: boolean;
  transport: Transport;
};

export type HappOrWebhappPath = {
  type: 'happ' | 'webhapp';
  path: string;
};

export function validateCliArgs(
  cliArgs: string[],
  cliOpts: CliOpts,
  appDataRootDir: string,
): CliOptsValidated {
  if (cliArgs.length !== 1) {
    throw new Error(
      `hc spin takes exactly one argument (the path to the .happ or .webhapp file) but got ${cliArgs.length} arguments: ${cliArgs}`,
    );
  }
  const happOrWebhappPath = cliArgs[0];
  if (!happOrWebhappPath.endsWith('.happ') && !happOrWebhappPath.endsWith('.webhapp')) {
    throw new Error(
      `The path passed to hc spin must either be a .happ or a .webhapp file but got path '${happOrWebhappPath}'`,
    );
  }
  if (!fs.existsSync(happOrWebhappPath)) {
    throw new Error(
      `Path to .happ or .webhapp file passed as argument does not exist: ${happOrWebhappPath}`,
    );
  }
  if (
    cliOpts.numAgents !== undefined &&
    (typeof cliOpts.numAgents !== 'number' || Number.isNaN(cliOpts.numAgents))
  ) {
    throw new Error(
      `The --num-agents (-n) option must be of type number but got: ${cliOpts.numAgents}`,
    );
  }
  if (
    cliOpts.targetArcFactor !== undefined &&
    (typeof cliOpts.targetArcFactor !== 'number' || Number.isNaN(cliOpts.targetArcFactor))
  ) {
    throw new Error(
      `The --target-arc-factor (-t) option must be a valid number but got: ${cliOpts.targetArcFactor}`,
    );
  }
  const isHapp = happOrWebhappPath.endsWith('.happ');
  if (isHapp && !cliOpts.uiPath && !cliOpts.uiPort) {
    throw new Error(
      'If you pass a .happ file as argument, you must also provide either the --ui-port or the --ui-path option pointing to the UI assets.',
    );
  }
  if (cliOpts.uiPath && cliOpts.uiPort) {
    throw new Error(
      'Only one of --ui-port and --ui-path is allowed at the same time but got values for both.',
    );
  }
  if (
    cliOpts.transport !== undefined &&
    cliOpts.transport !== 'quic' &&
    cliOpts.transport !== 'webrtc'
  ) {
    throw new Error(
      `The --transport option must be either 'quic' or 'webrtc' but got: ${cliOpts.transport}`,
    );
  }

  const appId = cliOpts.appId ? cliOpts.appId : path.parse(path.basename(cliArgs[0])).name;
  const holochainPath = cliOpts.holochainPath;
  const numAgents = cliOpts.numAgents ? cliOpts.numAgents : 2;

  // Parse network-seeds if provided (can be comma-separated string or array)
  let networkSeeds: string[] | undefined;
  if (cliOpts.networkSeeds) {
    if (Array.isArray(cliOpts.networkSeeds)) {
      // Handle space-separated values that commander might split
      networkSeeds = cliOpts.networkSeeds.flatMap((seed) =>
        seed.includes(',') ? seed.split(',').map((s) => s.trim()) : [seed],
      );
    }
  }

  return {
    appId,
    holochainPath,
    numAgents,
    networkSeed: cliOpts.networkSeed,
    networkSeeds,
    targetArcFactor: cliOpts.targetArcFactor,
    singleConductor: cliOpts.singleConductor ? true : false,
    uiSource: cliOpts.uiPath
      ? { type: 'path', path: cliOpts.uiPath }
      : cliOpts.uiPort
        ? { type: 'port', port: cliOpts.uiPort }
        : { type: 'path', path: path.join(appDataRootDir, 'apps', appId, 'ui') },
    singalingUrl: cliOpts.signalingUrl,
    bootstrapUrl: cliOpts.bootstrapUrl,
    happOrWebhappPath: isHapp
      ? { type: 'happ', path: happOrWebhappPath }
      : { type: 'webhapp', path: happOrWebhappPath },
    openDevtools: cliOpts.openDevtools ? true : false,
    transport: cliOpts.transport || 'quic',
  };
}
