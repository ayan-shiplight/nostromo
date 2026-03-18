/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Terminal as RawXtermTerminal } from '@xterm/xterm';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import type { ITerminalContribution, ITerminalInstance, IXtermTerminal } from '../../../terminal/browser/terminal.js';
import { registerTerminalContribution, type ITerminalContributionContext } from '../../../terminal/browser/terminalExtensions.js';
import { TerminalInputNotificationSettingId } from '../common/terminalInputNotificationConfiguration.js';
import { IShellNotificationService } from '../../../../services/shell/browser/shellNotificationService.js';

/**
 * Detects when a background workbench terminal needs attention and sends a
 * notification to the shell sidebar so a bell badge is shown next to the
 * worktree entry.
 *
 * Detection mechanisms (any one triggers a notification):
 * 1. **Command finished** — shell integration detects a command completion,
 *    meaning the terminal is now at the shell prompt waiting for user input.
 * 2. **Terminal bell** — the program explicitly rings the terminal bell (BEL
 *    character), which is a standard signal for "attention needed."
 * 3. **Output silence** — terminal output stops for a configurable period
 *    (default 5 s), indicating the program may be waiting for user input.
 *    This catches interactive TUI programs (e.g. Claude Code) that prompt
 *    the user mid-session without exiting to the shell.
 *
 * Rules:
 * 1. Foreground/background status is tracked via shell.activeView messages
 *    (web) and vscode:shellActiveView IPC (Electron).
 * 2. A foreground workbench never sends notifications.
 * 3. Notifications are only dismissed when the user switches to the worktree.
 * 4. At most one notification fires per background period (guarded by
 *    `_notified`), reset when the view transitions foreground → background.
 */
class TerminalInputNotificationContribution extends Disposable implements ITerminalContribution {
	static readonly ID = 'terminal.inputNotification';

	static get(instance: ITerminalInstance): TerminalInputNotificationContribution | null {
		return instance.getContribution<TerminalInputNotificationContribution>(TerminalInputNotificationContribution.ID);
	}

	private _isBackground = false;
	private _hasNewOutput = false; // new terminal output since going background
	private _notified = false; // already sent one notification since going background
	private _silenceTimer: ReturnType<typeof setTimeout> | undefined;
	private _notificationActive = false;

	constructor(
		private readonly _ctx: ITerminalContributionContext,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IShellNotificationService private readonly _shellNotificationService: IShellNotificationService,
	) {
		super();
	}

	xtermReady(xterm: IXtermTerminal & { raw: RawXtermTerminal }): void {
		// --- Detection: output silence ---
		// Line feeds indicate real content being written to the terminal.
		this._register(xterm.raw.onLineFeed(() => {
			this._onTerminalOutput();
		}));

		// Title changes also indicate output activity.
		this._register(xterm.raw.onTitleChange(() => {
			this._onTerminalOutput();
		}));

		// --- Detection: terminal bell ---
		this._register(xterm.raw.onBell(() => {
			this._sendNotification();
		}));

		// User input — clear any active notification since the user is
		// interacting with this terminal directly.
		this._register(xterm.raw.onData(() => {
			this._clearSilenceTimer();
			this._clearNotification();
		}));

		// --- Detection: command finished (shell integration) ---
		const instance = this._ctx.instance;
		this._register(instance.capabilities.onDidAddCapability(e => {
			if (e.id === TerminalCapability.CommandDetection) {
				const cmdDetection = instance.capabilities.get(TerminalCapability.CommandDetection)!;
				this._register(cmdDetection.onCommandFinished(() => {
					this._sendNotification();
				}));
			}
		}));

		// If command detection is already available, register immediately.
		const cmdDetection = instance.capabilities.get(TerminalCapability.CommandDetection);
		if (cmdDetection) {
			this._register(cmdDetection.onCommandFinished(() => {
				this._sendNotification();
			}));
		}

		// Foreground/background tracking.
		const onActivated = () => {
			this._isBackground = false;
			this._hasNewOutput = false;
			this._notified = false;
			this._clearSilenceTimer();
			// Do NOT clear notification here — the shell dismisses the badge
			// only when the user switches to this worktree via switchToWorktree().
		};
		const onDeactivated = () => {
			this._isBackground = true;
			this._hasNewOutput = false;
			this._notified = false;
		};

		// Web shell: parent posts shell.activeView messages when switching iframes.
		const onMessage = (e: MessageEvent) => {
			if (e.data?.type === 'shell.activeView') {
				if (e.data.active) {
					onActivated();
				} else {
					onDeactivated();
				}
			}
		};
		mainWindow.addEventListener('message', onMessage);

		// Electron shell: main process sends IPC when switching WebContentsViews.
		const vscodeGlobal = (mainWindow as unknown as { vscode?: { ipcRenderer?: { on(channel: string, listener: (...args: unknown[]) => void): void; removeListener(channel: string, listener: (...args: unknown[]) => void): void } } }).vscode;
		const onIpcActiveView = (_event: unknown, active: unknown) => {
			if (active) {
				onActivated();
			} else {
				onDeactivated();
			}
		};
		vscodeGlobal?.ipcRenderer?.on('vscode:shellActiveView', onIpcActiveView);

		this._register({
			dispose: () => {
				mainWindow.removeEventListener('message', onMessage);
				vscodeGlobal?.ipcRenderer?.removeListener('vscode:shellActiveView', onIpcActiveView);
			}
		});
	}

	private _onTerminalOutput(): void {
		if (!this._isBackground) {
			return;
		}
		this._hasNewOutput = true;
		this._resetSilenceTimer();
	}

	private _resetSilenceTimer(): void {
		this._clearSilenceTimer();
		if (!this._isEnabled() || !this._isBackground || !this._hasNewOutput || this._notified) {
			return;
		}
		const silenceMs = this._configurationService.getValue<number>(TerminalInputNotificationSettingId.InputNotificationSilenceMs) ?? 5000;
		this._silenceTimer = setTimeout(() => {
			this._onSilenceDetected();
		}, silenceMs);
	}

	private _clearSilenceTimer(): void {
		if (this._silenceTimer !== undefined) {
			clearTimeout(this._silenceTimer);
			this._silenceTimer = undefined;
		}
	}

	private _onSilenceDetected(): void {
		if (!this._isEnabled() || !this._isBackground || !this._hasNewOutput || this._notified) {
			return;
		}
		this._sendNotification();
	}

	private _sendNotification(): void {
		if (!this._isEnabled() || !this._isBackground || this._notified) {
			return;
		}

		this._notified = true;
		this._notificationActive = true;
		this._shellNotificationService.notify({
			type: 'terminalInputWaiting',
			source: TerminalInputNotificationContribution.ID,
			active: true,
			severity: 'warning',
			message: `Terminal: ${this._ctx.instance.title || 'Terminal'} — Needs attention`,
		});
	}

	private _clearNotification(): void {
		if (!this._notificationActive) {
			return;
		}
		this._notificationActive = false;
		this._shellNotificationService.clear(TerminalInputNotificationContribution.ID);
	}

	private _isEnabled(): boolean {
		return this._configurationService.getValue<boolean>(TerminalInputNotificationSettingId.EnableInputNotification) === true;
	}

	override dispose(): void {
		this._clearSilenceTimer();
		this._clearNotification();
		super.dispose();
	}
}

registerTerminalContribution(TerminalInputNotificationContribution.ID, TerminalInputNotificationContribution);
