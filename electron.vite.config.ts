import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@holochain/client', 'nanoid', 'get-port'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {},
});
