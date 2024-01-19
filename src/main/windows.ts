import path from 'path';
import fs from 'fs';
import { InstalledAppId } from '@holochain/client';
import { BrowserWindow, shell } from 'electron';

export type UISource =
  | {
      type: 'path';
      path: string;
    }
  | {
      type: 'port';
      port: number;
    };

export const createHappWindow = (
  uiSource: UISource,
  appId: InstalledAppId,
  agentNum: number,
  appPort: number,
  appDataRootDir: string,
): BrowserWindow => {
  if (uiSource.type !== 'port') throw new Error('Only UI port is currently implemented.');
  // TODO create mapping between installed-app-id's and window ids
  if (!appPort) throw new Error('App port not defined.');

  const partition = `persist:${agentNum}:${appId}`;

  // const ses = session.fromPartition(partition)
  // ses.protocol.handle('webhapp', async (request) => {
  //   // console.log("### Got file request: ", request);
  //   const uriWithoutProtocol = request.url.slice('webhapp://'.length);
  //   const filePathComponents = uriWithoutProtocol.split('/').slice(1);
  //   const filePath = join(...filePathComponents);
  //   const resource = net.fetch(
  //     url
  //       .pathToFileURL(join(launcherFileSystem.happUiDir(appId, holochainDataRoot), filePath))
  //       .toString(),
  //   );
  //   if (!filePath.endsWith('index.html')) {
  //     return resource;
  //   } else {
  //     const indexHtmlResponse = await resource;
  //     const indexHtml = await indexHtmlResponse.text();
  //     let modifiedContent = indexHtml.replace(
  //       '<head>',
  //       `<head><script type="module">window.__HC_LAUNCHER_ENV__ = { APP_INTERFACE_PORT: ${appPort}, INSTALLED_APP_ID: "${appId}", FRAMEWORK: "electron" };</script>`,
  //     );
  //     // remove title attribute to be able to set title to app id later
  //     modifiedContent = modifiedContent.replace(/<title>.*?<\/title>/i, '');
  //     return new Response(modifiedContent, indexHtmlResponse);
  //   }
  // });
  // Create the browser window.

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
  console.log('preloadPath: ', preloadPath);
  fs.writeFileSync(preloadPath, preloadScript);

  const happWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      partition,
    },
  });

  happWindow.menuBarVisible = false;

  happWindow.setTitle(`Agent ${agentNum} - ${appId}`);

  setLinkOpenHandlers(happWindow);

  happWindow.on('close', () => {
    console.log(`Happ window with frame id ${happWindow.id} about to be closed.`);
    // prevent closing here and hide instead in case notifications are to be received from this happ UI
  });

  happWindow.on('closed', () => {
    // remove protocol handler
    // ses.protocol.unhandle('webhapp');
    // happWindow = null;
  });
  // console.log('Loading happ window file');
  // happWindow.loadURL(`webhapp://webhappwindow/index.html`);
  happWindow.loadURL(`http://127.0.0.1:${uiSource.port}`);

  happWindow.webContents.openDevTools();
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
