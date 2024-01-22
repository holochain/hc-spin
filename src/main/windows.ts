import path from 'path';
import fs from 'fs';
import url from 'url';
import { InstalledAppId } from '@holochain/client';
import { BrowserWindow, net, session, shell } from 'electron';
import { is } from '@electron-toolkit/utils';
import { HappOrWebhappPath } from './validateArgs';

export type UISource =
  | {
      type: 'path';
      path: string;
    }
  | {
      type: 'port';
      port: number;
    };

export const createHappWindow = async (
  uiSource: UISource,
  happOrWebhappPath: HappOrWebhappPath,
  appId: InstalledAppId,
  agentNum: number,
  appPort: number,
  appDataRootDir: string,
): Promise<BrowserWindow> => {
  // TODO create mapping between installed-app-id's and window ids
  if (!appPort) throw new Error('App port not defined.');

  const partition = `persist:${agentNum}:${appId}`;

  if (uiSource.type === 'path') {
    const ses = session.fromPartition(partition);
    ses.protocol.handle('webhapp', async (request) => {
      const uriWithoutProtocol = request.url.slice('webhapp://'.length);
      const filePathComponents = uriWithoutProtocol.split('/').slice(1);
      const filePath = path.join(...filePathComponents);
      return net.fetch(url.pathToFileURL(path.join(uiSource.path, filePath)).toString());
    });
  }

  // Extend preload script to add window.__HC_LAUNCHER_ENV__
  let preloadScript = fs.readFileSync(path.join(__dirname, '../preload/index.js')).toString();

  preloadScript += `
electron.contextBridge.exposeInMainWorld("__HC_LAUNCHER_ENV__", {
  APP_INTERFACE_PORT: ${appPort},
  INSTALLED_APP_ID: "${appId}",
  FRAMEWORK: "electron"
});
    `;

  const preloadPath = path.join(appDataRootDir, `preload-${agentNum}-${appId}.js`);

  fs.writeFileSync(preloadPath, preloadScript);

  const happWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: `Agent ${agentNum} - ${appId}`,
    webPreferences: {
      preload: preloadPath,
      partition,
    },
  });

  const [windowPositionX, windowPositionY] = happWindow.getPosition();
  const windowPositionXMoved = windowPositionX + agentNum * 20;
  const windowPositionYMoved = windowPositionY + agentNum * 20;
  happWindow.setPosition(windowPositionXMoved, windowPositionYMoved);

  happWindow.menuBarVisible = false;

  setLinkOpenHandlers(happWindow);

  happWindow.on('page-title-updated', (evt) => {
    evt.preventDefault();
  });

  happWindow.webContents.openDevTools();

  if (uiSource.type === 'port') {
    try {
      // Check whether dev server is responsive and index.html exists
      await net.fetch(`http://127.0.0.1:${uiSource.port}/index.html`);
    } catch (e) {
      console.error(`No index.html file found at http://127.0.0.1:${uiSource.port}/index.html`, e);
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        happWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
      } else {
        happWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
      }
      happWindow.show();
      return happWindow;
    }
    await happWindow.loadURL(`http://127.0.0.1:${uiSource.port}`);
  } else if (uiSource.type === 'path') {
    try {
      await happWindow.loadURL(`webhapp://webhappwindow/index.html`);
    } catch (e) {
      console.error('[ERROR] Failed to fetch index.html');

      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        happWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
      } else {
        const notFoundPath =
          happOrWebhappPath.type === 'webhapp'
            ? path.join(__dirname, '../renderer/indexNotFound1.html')
            : path.join(__dirname, '../renderer/indexNotFound2.html');
        happWindow.loadFile(notFoundPath);
      }

      happWindow.show();
      return happWindow;
    }
  } else {
    throw new Error('Unsupported uiSource type: ', (uiSource as any).type);
  }

  happWindow.show();

  return happWindow;
};

export function setLinkOpenHandlers(browserWindow: BrowserWindow): void {
  // links in happ windows should open in the system default application
  // instead of the webview
  browserWindow.webContents.on('will-navigate', (e) => {
    if (e.url.startsWith('http://localhost') || e.url.startsWith('http://127.0.0.1')) {
      // ignore dev server reload
      return;
    }
    if (
      e.url.startsWith('http://') ||
      e.url.startsWith('https://') ||
      e.url.startsWith('mailto://')
    ) {
      e.preventDefault();
      shell.openExternal(e.url);
    }
  });

  // Links with target=_blank should open in the system default browser and
  // happ windows are not allowed to spawn new electron windows
  browserWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
      shell.openExternal(details.url);
    }
    return { action: 'deny' };
  });
}
