import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import path from 'path';

import packageJson from './package.json';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@holochain/client', 'nanoid', 'get-port'] })],
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
      __HOLOCHAIN_VERSION__: JSON.stringify(packageJson.holochainVersion),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          admin: path.resolve(__dirname, 'src/renderer/index.html'),
          splashscreen: path.resolve(__dirname, 'src/renderer/indexNotFound1.html'),
          selectmediasource: path.resolve(__dirname, 'src/renderer/indexNotFound2.html'),
        },
      },
    },
  },
});
