const fs = require('fs');

const packageJsonString = fs.readFileSync('package.json');
const packageJson = JSON.parse(packageJsonString);
const electronVersion = packageJson.dependencies.electron;
const majorElectronVersion = electronVersion.replace('^', '').slice(0, 3);
console.log('electron version: ', majorElectronVersion);

const cliJs = fs.readFileSync('./dist/cli.js', 'utf-8');
const modifiedCliJs = cliJs.replace('###REPLACE_AT_BUILD_TIME###', majorElectronVersion);
fs.writeFileSync('./dist/cli.js', modifiedCliJs);
