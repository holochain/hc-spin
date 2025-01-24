import { BrowserWindow, Menu } from 'electron';

export const menu = Menu.buildFromTemplate([
  {
    label: 'Options',
    submenu: [
      {
        label: 'toggle dev tools (F12)',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.webContents.toggleDevTools();
          }
        },
        accelerator: 'F12',
      },
      {
        label: 'toggle dev tools (Ctrl+Shift+I)',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.webContents.toggleDevTools();
          }
        },
        visible: false,
        accelerator: 'CommandOrControl+Shift+I',
      },
      {
        label: 'Reload (F5)',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.webContents.reload();
          }
        },
        accelerator: 'F5',
      },
      {
        label: 'Reload (Ctrl+R)',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.webContents.reload();
          }
        },
        visible: false,
        accelerator: 'CommandOrControl+R',
      },
    ],
  },
  {
    label: "Edit",
    submenu: [
      {
        label: "Undo",
        role: "undo",
        accelerator: "Cmd+Z"
      },
      {
        label: "Redo",
        role: "redo",
        accelerator: "Cmd+Shift+Z"
      },
      {
        type: "separator"
      },
      {
        label: "Cut",
        role: "cut",
        accelerator: "Cmd+X"
      },
      {
        label: "Copy",
        role: "copy",
        accelerator: "Cmd+C"
      },
      {
        label: "Paste",
        role: "paste",
        accelerator: "Cmd+V"
      },
      {
        label: "Select All",
        role: "selectAll",
        accelerator: "Cmd+A"
      }
    ]
  }
]);
