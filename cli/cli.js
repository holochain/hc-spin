#!/usr/bin/env node
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let electronBinary = process.env.ELECTRON_BINARY;

if (!electronBinary) {
  // Check whether electron is installed globally and compare with the expected version
  const electronHandleTemp = spawnSync('electron', ['--version']);

  if (electronHandleTemp.stdout) {
    if (!electronHandleTemp.stdout.toString().startsWith('v29.')) {
      console.warn(
        'WARNING: Found a globally installed electron version but it does not match the version requirements of hc-spin (v29.x). The electron binary from node_modules will be used instead.',
      );
    } else {
      electronBinary = 'electron';
    }
  }

  if (!electronBinary) {
    let pathStr =
      process.platform === 'win32'
        ? '../node_modules/electron/dist/electron.exe'
        : '../node_modules/.bin/electron';

    // recursively look for electron binary in node_modules folder
    for (let i = 0; i < 7; i++) {
      const maybeElectronBinary = path.resolve(__dirname, pathStr);
      if (fs.existsSync(maybeElectronBinary)) {
        electronBinary = maybeElectronBinary;
        break;
      } else {
        pathStr = '../' + pathStr;
      }
    }
  }
}

if (!electronBinary) {
  throw new Error('Failed to locate electron binary. __dirname: ', __dirname);
}

const child = spawn(
  electronBinary,
  [path.resolve(__dirname, 'main/index.js'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);

child.on('error', (err) => console.error('[electron]: ERROR: ', err));

// Handle child process exit
child.on('exit', (code, _signal) => {
  process.exit(code);
});
