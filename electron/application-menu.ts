import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';

const MENU_THEMES = [
  { id: 'harbor', label: 'Harbor' },
  { id: 'grove', label: 'Grove' },
  { id: 'sunrise', label: 'Sunrise' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'glacier', label: 'Glacier' },
] as const;

type ThemeId = (typeof MENU_THEMES)[number]['id'];

export type MenuAction =
  | 'new-project'
  | 'import-project'
  | 'export-project'
  | 'save'
  | 'check-for-updates'
  | 'cursor-api-key';

export interface MenuProject {
  id: string;
  title: string;
}

function sendMenuAction(window: BrowserWindow | null, action: MenuAction): void {
  window?.webContents.send('menu:action', action);
}

function sendOpenProject(window: BrowserWindow | null, projectId: string): void {
  window?.webContents.send('menu:open-project', projectId);
}

function sendTheme(window: BrowserWindow | null, themeId: ThemeId): void {
  window?.webContents.send('menu:theme', themeId);
}

export function rebuildApplicationMenu(
  getWindow: () => BrowserWindow | null,
  projects: MenuProject[],
  themeId: string,
): void {
  const activeTheme: ThemeId = MENU_THEMES.some((theme) => theme.id === themeId)
    ? themeId as ThemeId
    : 'harbor';
  const isMac = process.platform === 'darwin';
  const openProjectItems: MenuItemConstructorOptions[] = projects.length === 0
    ? [{ label: 'No saved projects', enabled: false }]
    : projects.map((project) => ({
        id: `open-project-${project.id}`,
        label: project.title,
        click: () => sendOpenProject(getWindow(), project.id),
      }));

  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      id: 'new-project',
      label: 'New Project',
      click: () => sendMenuAction(getWindow(), 'new-project'),
    },
    {
      id: 'open-project',
      label: 'Open Project',
      submenu: openProjectItems,
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
      id: 'save',
      label: 'Save',
      accelerator: 'CmdOrCtrl+S',
      enabled: false,
      click: () => sendMenuAction(getWindow(), 'save'),
    },
    { type: 'separator' },
    {
      id: 'check-for-updates',
      label: 'Check for Updates',
      click: () => sendMenuAction(getWindow(), 'check-for-updates'),
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

  const viewSubmenu: MenuItemConstructorOptions[] = MENU_THEMES.map((theme) => ({
    id: `theme-${theme.id}`,
    label: theme.label,
    type: 'radio',
    checked: theme.id === activeTheme,
    click: () => sendTheme(getWindow(), theme.id),
  }));

  const settingsSubmenu: MenuItemConstructorOptions[] = [
    {
      id: 'toggle-devtools',
      label: 'Developer Tools',
      accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
      click: () => getWindow()?.webContents.toggleDevTools(),
    },
  ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: fileSubmenu },
    { label: 'View', submenu: viewSubmenu },
    { label: 'Settings', submenu: settingsSubmenu },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function buildApplicationMenu(getWindow: () => BrowserWindow | null): void {
  rebuildApplicationMenu(getWindow, [], 'harbor');
}

export function setExportProjectEnabled(enabled: boolean): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById('export-project');
  if (item) item.enabled = enabled;
}

export function setSaveEnabled(enabled: boolean): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById('save');
  if (item) item.enabled = enabled;
}
