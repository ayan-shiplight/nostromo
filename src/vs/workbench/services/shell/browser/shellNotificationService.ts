/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

/**
 * Notification sent from a workbench instance to the shell sidebar.
 */
export interface IShellNotification {
	type: string;
	source: string;
	worktreePath: string;
	active: boolean;
	severity?: 'info' | 'warning';
	message?: string;
}

export const IShellNotificationService = createDecorator<IShellNotificationService>('shellNotificationService');

export interface IShellNotificationService {
	readonly _serviceBrand: undefined;

	/**
	 * Send a notification to the shell sidebar.
	 */
	notify(notification: Omit<IShellNotification, 'worktreePath'>): void;

	/**
	 * Clear notifications from a given source, optionally filtered by type.
	 */
	clear(source: string, type?: string): void;
}

class ShellNotificationService implements IShellNotificationService {

	declare readonly _serviceBrand: undefined;

	private readonly _worktreePath: string | undefined;
	private readonly _embedded: boolean;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		// Determine the workspace folder path (used as worktree identifier)
		const workspace = this._workspaceContextService.getWorkspace();
		const firstFolder = workspace.folders[0];
		this._worktreePath = firstFolder?.uri.path;

		// Check if we're running inside the shell (embedded mode).
		// Try URL search params first, fall back to checking the full href
		// in case location.search doesn't parse correctly for custom schemes.
		if (typeof mainWindow !== 'undefined') {
			try {
				const search = mainWindow.location.search || '';
				const href = mainWindow.location.href || '';
				this._embedded = new URLSearchParams(search).has('embedded')
					|| href.includes('embedded=true');
			} catch {
				this._embedded = false;
			}
		} else {
			this._embedded = false;
		}
	}

	notify(notification: Omit<IShellNotification, 'worktreePath'>): void {
		if (!this._embedded || !this._worktreePath) {
			return;
		}

		const fullNotification: IShellNotification = {
			...notification,
			worktreePath: this._worktreePath,
		};

		this._send(fullNotification);
	}

	clear(source: string, type?: string): void {
		if (!this._embedded || !this._worktreePath) {
			return;
		}

		const notification: IShellNotification = {
			type: type ?? '',
			source,
			worktreePath: this._worktreePath,
			active: false,
		};

		this._send(notification);
	}

	private _send(notification: IShellNotification): void {
		// Web mode: postMessage to parent shell
		if (mainWindow.parent !== mainWindow) {
			mainWindow.parent.postMessage({ type: 'shell.notification', notification }, '*');
			return;
		}

		// Electron mode: use IPC if available
		const vscodeGlobal = (mainWindow as unknown as { vscode?: { ipcRenderer?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } } }).vscode;
		if (vscodeGlobal?.ipcRenderer) {
			vscodeGlobal.ipcRenderer.invoke('vscode:shellView-notifyShell', notification);
		}
	}
}

registerSingleton(IShellNotificationService, ShellNotificationService, InstantiationType.Delayed);
