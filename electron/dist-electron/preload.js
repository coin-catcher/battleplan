"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const bridge = {
    isElectron: true,
    platform: process.platform,
    invoke(channel, ...args) {
        return electron_1.ipcRenderer.invoke(channel, ...args);
    },
    on(channel, listener) {
        const wrapped = (_event, ...payload) => listener(...payload);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
};
electron_1.contextBridge.exposeInMainWorld('battleplan', bridge);
