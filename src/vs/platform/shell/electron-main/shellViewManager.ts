/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, Notification, WebContents, WebContentsView } from 'electron';
import { createHash } from 'crypto';
import { FileAccess } from '../../../base/common/network.js';
import { validatedIpcMain } from '../../../base/parts/ipc/electron-main/ipcMain.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { IProtocolMainService } from '../../protocol/electron-main/protocol.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { getAllWindowsExcludingOffscreen } from '../../windows/electron-main/windows.js';
import { isMacintosh, isWindows, isLinux } from '../../../base/common/platform.js';
import { INativeWindowConfiguration } from '../../window/common/window.js';
import { URI } from '../../../base/common/uri.js';

export const IShellViewManager = createDecorator<IShellViewManager>('shellViewManager');

export interface IShellViewManager {
	readonly _serviceBrand: undefined;

	/**
	 * Returns the active child view's WebContents for a given window ID,
	 * or undefined if there is no active view.
	 */
	getActiveViewWebContents(windowId: number): WebContents | undefined;

	/**
	 * Returns true when the shell UI for the given window has an editable
	 * element focused (e.g. worktree rename input). Clipboard operations
	 * should target the shell's own webContents in this case.
	 */
	isShellEditing(windowId: number): boolean;
}

interface IManagedView {
	view: WebContentsView;
	folderPath: string;
	configDisposable: { dispose(): void };
}

/**
 * Manages WebContentsView instances embedded in BrowserWindows.
 * Each view hosts a full VS Code workbench for a specific worktree folder.
 * Hidden views keep their processes alive so agents continue running.
 */
export class ShellViewManager extends Disposable implements IShellViewManager {

	declare readonly _serviceBrand: undefined;

	private readonly views = new Map<string, IManagedView>(); // key: `${windowId}:${folderPath}`
	private readonly activeViews = new Map<number, string>(); // windowId -> active folderPath
	private readonly baseConfigs = new Map<number, INativeWindowConfiguration>(); // windowId -> config
	private readonly viewCounters = new Map<number, number>(); // windowId -> next view index
	private readonly keyboardForwardingWindows = new Set<number>(); // windowIds with listener installed
	private readonly shellEditingState = new Map<number, boolean>(); // windowId -> shell has editable focus

	constructor(
		@IProtocolMainService private readonly protocolMainService: IProtocolMainService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._registerIpcHandlers();
	}

	private _registerIpcHandlers(): void {
		validatedIpcMain.handle('vscode:shellView-setBaseConfig', async (_event, config: INativeWindowConfiguration) => {
			// Cache config keyed by the sender's window ID
			const senderWindow = BrowserWindow.fromWebContents(_event.sender);
			if (senderWindow) {
				this.baseConfigs.set(senderWindow.id, config);
			}
		});

		validatedIpcMain.handle('vscode:shellView-activateWorktree', (_event, windowId: number, folderPath: string) => {
			return this.activateWorktree(windowId, folderPath);
		});

		validatedIpcMain.handle('vscode:shellView-layoutActiveView', async (_event, windowId: number, x: number, y: number, width: number, height: number) => {
			this.layoutActiveView(windowId, x, y, width, height);
		});

		validatedIpcMain.handle('vscode:shellView-removeView', async (_event, windowId: number, folderPath: string) => {
			this.removeView(windowId, folderPath);
		});

		validatedIpcMain.handle('vscode:shellView-setActiveViewVisible', async (_event, windowId: number, visible: boolean) => {
			this.setActiveViewVisible(windowId, visible);
		});

		validatedIpcMain.handle('vscode:shellView-notifyShell', async (_event, notification: unknown) => {
			// Forward notification from a workbench WebContentsView to its parent shell window
			const senderWebContents = _event.sender;
			for (const [key, managed] of this.views) {
				if (managed.view.webContents === senderWebContents) {
					const windowId = parseInt(key.split(':')[0], 10);
					const parentWindow = this._getWindow(windowId);
					if (parentWindow) {
						parentWindow.webContents.send('vscode:shellNotification', notification);

						// Show OS notification for active notifications when window is not focused
						const shellNotification = notification as { active?: boolean; message?: string; worktreePath?: string };
						if (shellNotification.active && !parentWindow.isFocused()) {
							this._showOSNotification(parentWindow, shellNotification.message, shellNotification.worktreePath);
						}
					}
					break;
				}
			}
		});

		validatedIpcMain.handle('vscode:shellView-dockNotification', async (_event) => {
			const senderWindow = BrowserWindow.fromWebContents(_event.sender);
			if (senderWindow && !senderWindow.isFocused()) {
				this._triggerDockNotification(senderWindow);
			}
		});

		validatedIpcMain.handle('vscode:shellView-setShellEditing', async (_event, editing: boolean) => {
			const senderWindow = BrowserWindow.fromWebContents(_event.sender);
			if (senderWindow) {
				this.shellEditingState.set(senderWindow.id, editing);
			}
		});
	}

	isShellEditing(windowId: number): boolean {
		return this.shellEditingState.get(windowId) === true;
	}

	getActiveViewWebContents(windowId: number): WebContents | undefined {
		const activePath = this.activeViews.get(windowId);
		if (!activePath) {
			return undefined;
		}
		const viewKey = `${windowId}:${activePath}`;
		const managed = this.views.get(viewKey);
		return managed?.view.webContents;
	}

	async activateWorktree(windowId: number, folderPath: string): Promise<void> {
		const parentWindow = this._getWindow(windowId);
		if (!parentWindow) {
			this.logService.warn(`[ShellViewManager] Window ${windowId} not found`);
			return;
		}

		// Hide all views for this window and notify them they are inactive
		for (const [key, managed] of this.views) {
			if (key.startsWith(`${windowId}:`)) {
				managed.view.setVisible(false);
				managed.view.webContents.send('vscode:shellActiveView', false);
			}
		}

		const viewKey = `${windowId}:${folderPath}`;
		let managed = this.views.get(viewKey);

		if (!managed) {
			const baseConfig = this.baseConfigs.get(windowId);
			if (!baseConfig) {
				this.logService.warn('[ShellViewManager] No base config available, view may fail to load');
			}
			managed = this._createView(windowId, folderPath, parentWindow, baseConfig);
			this.views.set(viewKey, managed);
		}

		managed.view.setVisible(true);
		managed.view.webContents.send('vscode:shellActiveView', true);
		this.activeViews.set(windowId, folderPath);

		this.logService.trace(`[ShellViewManager] Activated worktree view for ${folderPath} in window ${windowId}`);
	}

	layoutActiveView(windowId: number, x: number, y: number, width: number, height: number): void {
		const activePath = this.activeViews.get(windowId);
		if (!activePath) {
			return;
		}

		const viewKey = `${windowId}:${activePath}`;
		const managed = this.views.get(viewKey);
		if (managed) {
			managed.view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
		}
	}

	setActiveViewVisible(windowId: number, visible: boolean): void {
		const activePath = this.activeViews.get(windowId);
		if (!activePath) {
			return;
		}

		const viewKey = `${windowId}:${activePath}`;
		const managed = this.views.get(viewKey);
		if (managed) {
			managed.view.setVisible(visible);
		}
	}

	removeView(windowId: number, folderPath: string): void {
		const viewKey = `${windowId}:${folderPath}`;
		const managed = this.views.get(viewKey);
		if (!managed) {
			return;
		}

		const parentWindow = this._getWindow(windowId);
		if (parentWindow) {
			parentWindow.contentView.removeChildView(managed.view);
		}

		managed.view.webContents.close({ waitForBeforeUnload: false });
		managed.configDisposable.dispose();
		this.views.delete(viewKey);

		if (this.activeViews.get(windowId) === folderPath) {
			this.activeViews.delete(windowId);
		}

		this.logService.trace(`[ShellViewManager] Removed view for ${folderPath} from window ${windowId}`);
	}

	private _createView(windowId: number, folderPath: string, parentWindow: Electron.BrowserWindow, baseConfig: INativeWindowConfiguration | undefined): IManagedView {
		// Create config object URL (same pattern as CodeWindow)
		const configObjectUrl = this.protocolMainService.createIPCObjectUrl<INativeWindowConfiguration>();

		// Build a full INativeWindowConfiguration by cloning the parent window's config
		// and replacing the workspace with the target folder.
		// '__empty__' is a sentinel for opening an empty workbench (no folder).
		const workspaceIdentifier = folderPath === '__empty__' ? undefined : (() => {
			const folderUri = URI.file(folderPath);
			const folderId = createHash('md5').update(folderUri.toString()).digest('hex');
			return { id: folderId, uri: folderUri };
		})();

		const view = new WebContentsView({
			webPreferences: {
				preload: FileAccess.asFileUri('vs/base/parts/sandbox/electron-browser/preload.js').fsPath,
				additionalArguments: [`--vscode-window-config=${configObjectUrl.resource.toString()}`],
				sandbox: true,
				enableWebSQL: false,
				spellcheck: false,
				enableBlinkFeatures: 'HighlightAPI',
				v8CacheOptions: this.environmentMainService.useCodeCache ? 'bypassHeatCheck' : 'none',
			}
		});

		// Use the WebContentsView's own webContents.id as the windowId for the
		// embedded workbench. This gives each view a unique identity so their
		// lifecycle events don't conflict. The utility process resolves the
		// webContents directly via webContents.fromId() for port delivery,
		// and finds the parent BrowserWindow for lifecycle binding.
		// Assign a unique port offset per view within this window
		const viewIndex = this.viewCounters.get(windowId) ?? 0;
		this.viewCounters.set(windowId, viewIndex + 1);

		if (baseConfig) {
			const viewConfig: INativeWindowConfiguration = {
				...baseConfig,
				windowId: view.webContents.id,
				workspace: workspaceIdentifier,
				portOffset: viewIndex * 10,
				// Clear file-open params from base config
				filesToOpenOrCreate: undefined,
				filesToDiff: undefined,
				filesToMerge: undefined,
				filesToWait: undefined,
				// Clear backup path (each view gets its own)
				backupPath: undefined,
			};
			configObjectUrl.update(viewConfig);
		}

		// Load the workbench HTML with ?embedded=true so services like
		// ShellNotificationService know this is an embedded shell view.
		const workbenchUrl = FileAccess.asBrowserUri(`vs/code/electron-browser/workbench/workbench${this.environmentMainService.isBuilt ? '' : '-dev'}.html`).toString(true);
		const embeddedUrl = workbenchUrl + (workbenchUrl.includes('?') ? '&' : '?') + 'embedded=true';
		this.logService.info(`[ShellViewManager] Loading workbench URL: ${embeddedUrl}`);
		view.webContents.loadURL(embeddedUrl);

		// Set up keyboard forwarding for clipboard shortcuts on the parent window
		this._setupKeyboardForwarding(windowId, parentWindow);

		// Add to parent window
		parentWindow.contentView.addChildView(view);

		this.logService.trace(`[ShellViewManager] Created WebContentsView for ${folderPath}`);

		return {
			view,
			folderPath,
			configDisposable: configObjectUrl
		};
	}

	private _setupKeyboardForwarding(windowId: number, parentWindow: BrowserWindow): void {
		if (this.keyboardForwardingWindows.has(windowId)) {
			return;
		}
		this.keyboardForwardingWindows.add(windowId);

		parentWindow.webContents.on('before-input-event', (event, input) => {
			if (input.type !== 'keyDown') {
				return;
			}

			const modifier = isMacintosh ? input.meta : input.control;
			if (!modifier) {
				return;
			}

			// Don't forward when the shell has an editable element focused
			// (e.g. renaming a worktree) — let the shell handle it natively.
			if (this.shellEditingState.get(windowId)) {
				return;
			}

			const activeWc = this.getActiveViewWebContents(windowId);
			if (!activeWc || activeWc.isDestroyed()) {
				return;
			}

			switch (input.key.toLowerCase()) {
				case 'c': activeWc.copy(); event.preventDefault(); break;
				case 'v': activeWc.paste(); event.preventDefault(); break;
				case 'x': activeWc.cut(); event.preventDefault(); break;
				case 'a': activeWc.selectAll(); event.preventDefault(); break;
				case 'z':
					if (input.shift) {
						activeWc.redo();
					} else {
						activeWc.undo();
					}
					event.preventDefault();
					break;
			}
		});
	}

	private _showOSNotification(win: BrowserWindow, message?: string, worktreePath?: string): void {
		if (!Notification.isSupported()) {
			return;
		}

		const branchName = worktreePath?.split('/').pop() ?? 'Worktree';
		const toast = new Notification({
			title: branchName,
			body: message || 'Terminal needs attention',
		});
		toast.on('click', () => {
			win.show();
			win.focus();
		});
		toast.show();
	}

	private _triggerDockNotification(win: BrowserWindow): void {
		if (isMacintosh) {
			app.dock?.bounce('informational');
			app.dock?.setBadge('\u2022');
		}
		if (isWindows || isLinux) {
			win.flashFrame(true);
		}

		// Auto-clear on focus
		const onFocus = () => {
			if (isMacintosh) {
				app.dock?.setBadge('');
			}
			if (isWindows || isLinux) {
				win.flashFrame(false);
			}
			win.removeListener('focus', onFocus);
		};
		win.on('focus', onFocus);
	}

	private _getWindow(windowId: number): Electron.BrowserWindow | undefined {
		return getAllWindowsExcludingOffscreen().find(w => w.id === windowId);
	}

	override dispose(): void {
		for (const [key, managed] of this.views) {
			const windowId = parseInt(key.split(':')[0], 10);
			const parentWindow = this._getWindow(windowId);
			if (parentWindow) {
				parentWindow.contentView.removeChildView(managed.view);
			}
			managed.view.webContents.close({ waitForBeforeUnload: false });
			managed.configDisposable.dispose();
		}
		this.views.clear();
		this.activeViews.clear();

		validatedIpcMain.removeHandler('vscode:shellView-setBaseConfig');
		validatedIpcMain.removeHandler('vscode:shellView-activateWorktree');
		validatedIpcMain.removeHandler('vscode:shellView-layoutActiveView');
		validatedIpcMain.removeHandler('vscode:shellView-removeView');
		validatedIpcMain.removeHandler('vscode:shellView-setActiveViewVisible');
		validatedIpcMain.removeHandler('vscode:shellView-notifyShell');
		validatedIpcMain.removeHandler('vscode:shellView-dockNotification');
		validatedIpcMain.removeHandler('vscode:shellView-setShellEditing');
		super.dispose();
	}
}
