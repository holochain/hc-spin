import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import path from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@holochain/client', 'nanoid', 'get-port'] })],
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
