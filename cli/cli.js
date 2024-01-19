#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const electronBinary = path.resolve(__dirname, '../node_modules/.bin/electron');

const child = spawn(
  electronBinary,
  [path.resolve(__dirname, 'main/index.js'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);

// Handle child process exit
child.on('exit', (code, _signal) => {
  process.exit(code);
});
