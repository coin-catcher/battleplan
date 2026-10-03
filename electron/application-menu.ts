import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';

export type MenuAction = 'new-project' | 'import-project' | 'export-project' | 'cursor-api-key';

function sendMenuAction(window: BrowserWindow | null, action: MenuAction): void {
  window?.webContents.send('menu:action', action);
}

export function buildApplicationMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin';
  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      id: 'new-project',
      label: 'New Project',
      click: () => sendMenuAction(getWindow(), 'new-project'),
    },
    {
      id: 'import-project',
      label: 'Import Project',
      click: () => sendMenuAction(getWindow(), 'import-project'),
    },
    {
      id: 'export-project',
      label: 'Export Project',
      enabled: false,
      click: () => sendMenuAction(getWindow(), 'export-project'),
    },
    { type: 'separator' },
    {
      id: 'cursor-api-key',
      label: 'Cursor API Key',
      click: () => sendMenuAction(getWindow(), 'cursor-api-key'),
    },
  ];

  if (!isMac) {
    fileSubmenu.push({ type: 'separator' }, { role: 'quit', label: 'Exit' });
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: fileSubmenu,
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function setExportProjectEnabled(enabled: boolean): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById('export-project');
  if (item) item.enabled = enabled;
}
