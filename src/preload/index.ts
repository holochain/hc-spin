// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { ZomeCallUnsignedNapi } from '@holochain/hc-spin-rust-utils';

import { CallZomeRequestUnsigned } from '@holochain/client';

contextBridge.exposeInMainWorld('__HC_ZOME_CALL_SIGNER__', {
  signZomeCall: (zomeCall: CallZomeRequestUnsigned) =>
    ipcRenderer.invoke('sign-zome-call', zomeCall),
});

contextBridge.exposeInMainWorld('electronAPI', {
  signZomeCall: (zomeCall: ZomeCallUnsignedNapi) =>
    ipcRenderer.invoke('sign-zome-call-legacy', zomeCall),
});
