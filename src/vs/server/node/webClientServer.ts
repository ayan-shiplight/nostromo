/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createReadStream, promises } from 'fs';
import type * as http from 'http';
import * as url from 'url';
import * as cookie from 'cookie';
import * as crypto from 'crypto';
import * as os from 'os';
import { execFile } from 'child_process';
import { isEqualOrParent } from '../../base/common/extpath.js';
import { getMediaMime } from '../../base/common/mime.js';
import { isLinux } from '../../base/common/platform.js';
import { ILogService, LogLevel } from '../../platform/log/common/log.js';
import { IServerEnvironmentService } from './serverEnvironmentService.js';
import { extname, dirname, join, normalize, posix, relative, resolve } from '../../base/common/path.js';
import { FileAccess, connectionTokenCookieName, connectionTokenQueryName, Schemas, builtinExtensionsPath } from '../../base/common/network.js';
import { generateUuid } from '../../base/common/uuid.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { ServerConnectionToken, ServerConnectionTokenType } from './serverConnectionToken.js';
import { asTextOrError, IRequestService } from '../../platform/request/common/request.js';
import { IHeaders } from '../../base/parts/request/common/request.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { URI } from '../../base/common/uri.js';
import { streamToBuffer } from '../../base/common/buffer.js';
import { IProductConfiguration } from '../../base/common/product.js';
import { isString, Mutable } from '../../base/common/types.js';
import { CharCode } from '../../base/common/charCode.js';
import { IExtensionManifest } from '../../platform/extensions/common/extensions.js';
import { ICSSDevelopmentService } from '../../platform/cssDev/node/cssDevService.js';

const textMimeType: { [ext: string]: string | undefined } = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
};

/**
 * Return an error to the client.
 */
export async function serveError(req: http.IncomingMessage, res: http.ServerResponse, errorCode: number, errorMessage: string): Promise<void> {
	res.writeHead(errorCode, { 'Content-Type': 'text/plain' });
	res.end(errorMessage);
}

export const enum CacheControl {
	NO_CACHING, ETAG, NO_EXPIRY
}

/**
 * Serve a file at a given path or 404 if the file is missing.
 */
export async function serveFile(filePath: string, cacheControl: CacheControl, logService: ILogService, req: http.IncomingMessage, res: http.ServerResponse, responseHeaders: Record<string, string>): Promise<void> {
	try {
		const stat = await promises.stat(filePath); // throws an error if file doesn't exist
		if (cacheControl === CacheControl.ETAG) {

			// Check if file modified since
			const etag = `W/"${[stat.ino, stat.size, stat.mtime.getTime()].join('-')}"`; // weak validator (https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
			if (req.headers['if-none-match'] === etag) {
				res.writeHead(304);
				return void res.end();
			}

			responseHeaders['Etag'] = etag;
		} else if (cacheControl === CacheControl.NO_EXPIRY) {
			responseHeaders['Cache-Control'] = 'public, max-age=31536000';
		} else if (cacheControl === CacheControl.NO_CACHING) {
			responseHeaders['Cache-Control'] = 'no-store';
		}

		responseHeaders['Content-Type'] = textMimeType[extname(filePath)] || getMediaMime(filePath) || 'text/plain';

		res.writeHead(200, responseHeaders);

		// Data
		createReadStream(filePath).pipe(res);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			logService.error(error);
			console.error(error.toString());
		} else {
			console.error(`File not found: ${filePath}`);
		}

		res.writeHead(404, { 'Content-Type': 'text/plain' });
		return void res.end('Not found');
	}
}

const APP_ROOT = dirname(FileAccess.asFileUri('').fsPath);

const STATIC_PATH = `/static`;
const CALLBACK_PATH = `/callback`;
const WEB_EXTENSION_PATH = `/web-extension-resource`;

export class WebClientServer {

	private readonly _webExtensionResourceUrlTemplate: URI | undefined;

	constructor(
		private readonly _connectionToken: ServerConnectionToken,
		private readonly _basePath: string,
		private readonly _productPath: string,
		@IServerEnvironmentService private readonly _environmentService: IServerEnvironmentService,
		@ILogService private readonly _logService: ILogService,
		@IRequestService private readonly _requestService: IRequestService,
		@IProductService private readonly _productService: IProductService,
		@ICSSDevelopmentService private readonly _cssDevService: ICSSDevelopmentService
	) {
		this._webExtensionResourceUrlTemplate = this._productService.extensionsGallery?.resourceUrlTemplate ? URI.parse(this._productService.extensionsGallery.resourceUrlTemplate) : undefined;
	}

	/**
	 * Handle web resources (i.e. only needed by the web client).
	 * **NOTE**: This method is only invoked when the server has web bits.
	 * **NOTE**: This method is only invoked after the connection token has been validated.
	 * @param parsedUrl The URL to handle, including base and product path
	 * @param pathname The pathname of the URL, without base and product path
	 */
	async handle(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: url.UrlWithParsedQuery, pathname: string): Promise<void> {
		try {
			if (pathname.startsWith(STATIC_PATH) && pathname.charCodeAt(STATIC_PATH.length) === CharCode.Slash) {
				return this._handleStatic(req, res, pathname.substring(STATIC_PATH.length));
			}
			if (pathname === '/') {
				// Redirect bare / (no ?folder= or ?workspace=) to /worktrees
				if (!parsedUrl.query['folder'] && !parsedUrl.query['workspace']) {
					const basePath = (req.headers['x-forwarded-prefix'] as string) || this._basePath;
					const shellPath = posix.join(basePath, this._productPath, '/worktrees');
					const queryString = parsedUrl.search || '';
					res.writeHead(302, { 'Location': shellPath + queryString });
					return void res.end();
				}
				return this._handleRoot(req, res, parsedUrl);
			}
			if (pathname === '/worktrees') {
				return this._handleShell(req, res);
			}
			if (pathname === '/api/worktrees') {
				return this._handleWorktreeApi(req, res);
			}
			if (pathname === '/api/browse') {
				return this._handleBrowseApi(req, res);
			}
			if (pathname === '/api/clone') {
				return this._handleCloneApi(req, res);
			}
			if (pathname === '/api/worktree-remove') {
				return this._handleWorktreeRemoveApi(req, res);
			}
			if (pathname === '/api/worktree-add') {
				return this._handleWorktreeAddApi(req, res);
			}
			if (pathname === '/api/branches') {
				return this._handleBranchesApi(req, res);
			}
			if (pathname === '/api/rename-branch') {
				return this._handleRenameBranchApi(req, res);
			}
			if (pathname === '/api/shell-settings') {
				return this._handleShellSettingsApi(req, res);
			}
			if (pathname === CALLBACK_PATH) {
				// callback support
				return this._handleCallback(res);
			}
			if (pathname.startsWith(WEB_EXTENSION_PATH) && pathname.charCodeAt(WEB_EXTENSION_PATH.length) === CharCode.Slash) {
				// extension resource support
				return this._handleWebExtensionResource(req, res, pathname.substring(WEB_EXTENSION_PATH.length));
			}

			return serveError(req, res, 404, 'Not found.');
		} catch (error) {
			this._logService.error(error);
			console.error(error.toString());

			return serveError(req, res, 500, 'Internal Server Error.');
		}
	}
	/**
	 * Handle HTTP requests for /static/*
	 * @param resourcePath The path after /static/
	 */
	private async _handleStatic(req: http.IncomingMessage, res: http.ServerResponse, resourcePath: string): Promise<void> {
		const headers: Record<string, string> = Object.create(null);

		// Strip the this._staticRoute from the path
		const normalizedPathname = decodeURIComponent(resourcePath); // support paths that are uri-encoded (e.g. spaces => %20)

		const filePath = join(APP_ROOT, normalizedPathname); // join also normalizes the path
		if (!isEqualOrParent(filePath, APP_ROOT, !isLinux)) {
			return serveError(req, res, 400, `Bad request.`);
		}

		return serveFile(filePath, this._environmentService.isBuilt ? CacheControl.NO_EXPIRY : CacheControl.ETAG, this._logService, req, res, headers);
	}

	private _getResourceURLTemplateAuthority(uri: URI): string | undefined {
		const index = uri.authority.indexOf('.');
		return index !== -1 ? uri.authority.substring(index + 1) : undefined;
	}

	/**
	 * Handle extension resources
	 * @param resourcePath The path after /web-extension-resource/
	 */
	private async _handleWebExtensionResource(req: http.IncomingMessage, res: http.ServerResponse, resourcePath: string): Promise<void> {
		if (!this._webExtensionResourceUrlTemplate) {
			return serveError(req, res, 500, 'No extension gallery service configured.');
		}

		const normalizedPathname = decodeURIComponent(resourcePath); // support paths that are uri-encoded (e.g. spaces => %20)
		const path = normalize(normalizedPathname);
		const uri = URI.parse(path).with({
			scheme: this._webExtensionResourceUrlTemplate.scheme,
			authority: path.substring(0, path.indexOf('/')),
			path: path.substring(path.indexOf('/') + 1)
		});

		if (this._getResourceURLTemplateAuthority(this._webExtensionResourceUrlTemplate) !== this._getResourceURLTemplateAuthority(uri)) {
			return serveError(req, res, 403, 'Request Forbidden');
		}

		const headers: IHeaders = {};
		const setRequestHeader = (header: string) => {
			const value = req.headers[header];
			if (value && (isString(value) || value[0])) {
				headers[header] = isString(value) ? value : value[0];
			} else if (header !== header.toLowerCase()) {
				setRequestHeader(header.toLowerCase());
			}
		};
		setRequestHeader('X-Client-Name');
		setRequestHeader('X-Client-Version');
		setRequestHeader('X-Machine-Id');
		setRequestHeader('X-Client-Commit');

		const context = await this._requestService.request({
			type: 'GET',
			url: uri.toString(true),
			headers
		}, CancellationToken.None);

		const status = context.res.statusCode || 500;
		if (status !== 200) {
			let text: string | null = null;
			try {
				text = await asTextOrError(context);
			} catch (error) {/* Ignore */ }
			return serveError(req, res, status, text || `Request failed with status ${status}`);
		}

		const responseHeaders: Record<string, string | string[]> = Object.create(null);
		const setResponseHeader = (header: string) => {
			const value = context.res.headers[header];
			if (value) {
				responseHeaders[header] = value;
			} else if (header !== header.toLowerCase()) {
				setResponseHeader(header.toLowerCase());
			}
		};
		setResponseHeader('Cache-Control');
		setResponseHeader('Content-Type');
		res.writeHead(200, responseHeaders);
		const buffer = await streamToBuffer(context.stream);
		return void res.end(buffer.buffer);
	}

	/**
	 * Handle HTTP requests for /
	 */
	private async _handleRoot(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: url.UrlWithParsedQuery): Promise<void> {

		const getFirstHeader = (headerName: string) => {
			const val = req.headers[headerName];
			return Array.isArray(val) ? val[0] : val;
		};

		// Prefix routes with basePath for clients
		const basePath = getFirstHeader('x-forwarded-prefix') || this._basePath;

		const queryConnectionToken = parsedUrl.query[connectionTokenQueryName];
		if (typeof queryConnectionToken === 'string') {
			// We got a connection token as a query parameter.
			// We want to have a clean URL, so we strip it
			const responseHeaders: Record<string, string> = Object.create(null);
			responseHeaders['Set-Cookie'] = cookie.serialize(
				connectionTokenCookieName,
				queryConnectionToken,
				{
					sameSite: 'lax',
					maxAge: 60 * 60 * 24 * 7 /* 1 week */
				}
			);

			const newQuery = Object.create(null);
			for (const key in parsedUrl.query) {
				if (key !== connectionTokenQueryName) {
					newQuery[key] = parsedUrl.query[key];
				}
			}
			const newLocation = url.format({ pathname: basePath, query: newQuery });
			responseHeaders['Location'] = newLocation;

			res.writeHead(302, responseHeaders);
			return void res.end();
		}

		const replacePort = (host: string, port: string) => {
			const index = host?.indexOf(':');
			if (index !== -1) {
				host = host?.substring(0, index);
			}
			host += `:${port}`;
			return host;
		};

		const useTestResolver = (!this._environmentService.isBuilt && this._environmentService.args['use-test-resolver']);
		let remoteAuthority = (
			useTestResolver
				? 'test+test'
				: (getFirstHeader('x-original-host') || getFirstHeader('x-forwarded-host') || req.headers.host)
		);
		if (!remoteAuthority) {
			return serveError(req, res, 400, `Bad request.`);
		}
		const forwardedPort = getFirstHeader('x-forwarded-port');
		if (forwardedPort) {
			remoteAuthority = replacePort(remoteAuthority, forwardedPort);
		}

		function asJSON(value: unknown): string {
			return JSON.stringify(value).replace(/"/g, '&quot;');
		}

		let _wrapWebWorkerExtHostInIframe: undefined | false = undefined;
		if (this._environmentService.args['enable-smoke-test-driver']) {
			// integration tests run at a time when the built output is not yet published to the CDN
			// so we must disable the iframe wrapping because the iframe URL will give a 404
			_wrapWebWorkerExtHostInIframe = false;
		}

		if (this._logService.getLevel() === LogLevel.Trace) {
			['x-original-host', 'x-forwarded-host', 'x-forwarded-port', 'host'].forEach(header => {
				const value = getFirstHeader(header);
				if (value) {
					this._logService.trace(`[WebClientServer] ${header}: ${value}`);
				}
			});
			this._logService.trace(`[WebClientServer] Request URL: ${req.url}, basePath: ${basePath}, remoteAuthority: ${remoteAuthority}`);
		}

		const staticRoute = posix.join(basePath, this._productPath, STATIC_PATH);
		const callbackRoute = posix.join(basePath, this._productPath, CALLBACK_PATH);
		const webExtensionRoute = posix.join(basePath, this._productPath, WEB_EXTENSION_PATH);

		const resolveWorkspaceURI = (defaultLocation?: string) => defaultLocation && URI.file(resolve(defaultLocation)).with({ scheme: Schemas.vscodeRemote, authority: remoteAuthority });

		const filePath = FileAccess.asFileUri(`vs/code/browser/workbench/workbench${this._environmentService.isBuilt ? '' : '-dev'}.html`).fsPath;
		const authSessionInfo = !this._environmentService.isBuilt && this._environmentService.args['github-auth'] ? {
			id: generateUuid(),
			providerId: 'github',
			accessToken: this._environmentService.args['github-auth'],
			scopes: [['user:email'], ['repo']]
		} : undefined;

		const productConfiguration: Partial<Mutable<IProductConfiguration>> = {
			embedderIdentifier: 'server-distro',
			extensionsGallery: this._webExtensionResourceUrlTemplate && this._productService.extensionsGallery ? {
				...this._productService.extensionsGallery,
				resourceUrlTemplate: this._webExtensionResourceUrlTemplate.with({
					scheme: 'http',
					authority: remoteAuthority,
					path: `${webExtensionRoute}/${this._webExtensionResourceUrlTemplate.authority}${this._webExtensionResourceUrlTemplate.path}`
				}).toString(true)
			} : undefined
		};

		const proposedApi = this._environmentService.args['enable-proposed-api'];
		if (proposedApi?.length) {
			productConfiguration.extensionsEnabledWithApiProposalVersion ??= [];
			productConfiguration.extensionsEnabledWithApiProposalVersion.push(...proposedApi);
		}

		if (!this._environmentService.isBuilt) {
			try {
				const productOverrides = JSON.parse((await promises.readFile(join(APP_ROOT, 'product.overrides.json'))).toString());
				Object.assign(productConfiguration, productOverrides);
			} catch (err) {/* Ignore Error */ }
		}

		const workbenchWebConfiguration = {
			remoteAuthority,
			serverBasePath: basePath,
			_wrapWebWorkerExtHostInIframe,
			developmentOptions: { enableSmokeTestDriver: this._environmentService.args['enable-smoke-test-driver'] ? true : undefined, logLevel: this._logService.getLevel() },
			settingsSyncOptions: !this._environmentService.isBuilt && this._environmentService.args['enable-sync'] ? { enabled: true } : undefined,
			enableWorkspaceTrust: false,
			folderUri: resolveWorkspaceURI(this._environmentService.args['default-folder']),
			workspaceUri: resolveWorkspaceURI(this._environmentService.args['default-workspace']),
			productConfiguration,
			callbackRoute: callbackRoute
		};

		const cookies = cookie.parse(req.headers.cookie || '');
		const locale = cookies['vscode.nls.locale'] || req.headers['accept-language']?.split(',')[0]?.toLowerCase() || 'en';
		let WORKBENCH_NLS_BASE_URL: string | undefined;
		let WORKBENCH_NLS_URL: string;
		if (!locale.startsWith('en') && this._productService.nlsCoreBaseUrl) {
			WORKBENCH_NLS_BASE_URL = this._productService.nlsCoreBaseUrl;
			WORKBENCH_NLS_URL = `${WORKBENCH_NLS_BASE_URL}${this._productService.commit}/${this._productService.version}/${locale}/nls.messages.js`;
		} else {
			WORKBENCH_NLS_URL = ''; // fallback will apply
		}

		const values: { [key: string]: string } = {
			WORKBENCH_WEB_CONFIGURATION: asJSON(workbenchWebConfiguration),
			WORKBENCH_AUTH_SESSION: authSessionInfo ? asJSON(authSessionInfo) : '',
			WORKBENCH_WEB_BASE_URL: staticRoute,
			WORKBENCH_NLS_URL,
			WORKBENCH_NLS_FALLBACK_URL: `${staticRoute}/out/nls.messages.js`
		};

		// DEV ---------------------------------------------------------------------------------------
		// DEV: This is for development and enables loading CSS via import-statements via import-maps.
		// DEV: The server needs to send along all CSS modules so that the client can construct the
		// DEV: import-map.
		// DEV ---------------------------------------------------------------------------------------
		if (this._cssDevService.isEnabled) {
			const cssModules = await this._cssDevService.getCssModules();
			values['WORKBENCH_DEV_CSS_MODULES'] = JSON.stringify(cssModules);
		}

		if (useTestResolver) {
			const bundledExtensions: { extensionPath: string; packageJSON: IExtensionManifest }[] = [];
			for (const extensionPath of ['vscode-test-resolver', 'github-authentication']) {
				const packageJSON = JSON.parse((await promises.readFile(FileAccess.asFileUri(`${builtinExtensionsPath}/${extensionPath}/package.json`).fsPath)).toString());
				bundledExtensions.push({ extensionPath, packageJSON });
			}
			values['WORKBENCH_BUILTIN_EXTENSIONS'] = asJSON(bundledExtensions);
		}

		let data;
		try {
			const workbenchTemplate = (await promises.readFile(filePath)).toString();
			data = workbenchTemplate.replace(/\{\{([^}]+)\}\}/g, (_, key) => values[key] ?? 'undefined');
		} catch (e) {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			return void res.end('Not found');
		}

		const webWorkerExtensionHostIframeScriptSHA = 'sha256-2Q+j4hfT09+1+imS46J2YlkCtHWQt0/BE79PXjJ0ZJ8=';

		const cspDirectives = [
			'default-src \'self\';',
			'img-src \'self\' https: data: blob:;',
			'media-src \'self\';',
			`script-src 'self' 'unsafe-eval' ${WORKBENCH_NLS_BASE_URL ?? ''} blob: 'nonce-1nline-m4p' ${this._getScriptCspHashes(data).join(' ')} '${webWorkerExtensionHostIframeScriptSHA}' 'sha256-/r7rqQ+yrxt57sxLuQ6AMYcy/lUpvAIzHjIJt/OeLWU=' ${useTestResolver ? '' : `http://${remoteAuthority}`};`,  // the sha is the same as in src/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html
			'child-src \'self\';',
			`frame-src 'self' https://*.vscode-cdn.net data:;`,
			'worker-src \'self\' data: blob:;',
			'style-src \'self\' \'unsafe-inline\';',
			'connect-src \'self\' ws: wss: https:;',
			'font-src \'self\' blob:;',
			'manifest-src \'self\';'
		].join(' ');

		const headers: http.OutgoingHttpHeaders = {
			'Content-Type': 'text/html',
			'Content-Security-Policy': cspDirectives
		};
		if (this._connectionToken.type !== ServerConnectionTokenType.None) {
			// At this point we know the client has a valid cookie
			// and we want to set it prolong it to ensure that this
			// client is valid for another 1 week at least
			headers['Set-Cookie'] = cookie.serialize(
				connectionTokenCookieName,
				this._connectionToken.value,
				{
					sameSite: 'lax',
					maxAge: 60 * 60 * 24 * 7 /* 1 week */
				}
			);
		}

		res.writeHead(200, headers);
		return void res.end(data);
	}

	/**
	 * Handle HTTP requests for /worktrees
	 */
	private async _handleShell(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const getFirstHeader = (headerName: string) => {
			const val = req.headers[headerName];
			return Array.isArray(val) ? val[0] : val;
		};

		const basePath = getFirstHeader('x-forwarded-prefix') || this._basePath;

		const useTestResolver = (!this._environmentService.isBuilt && this._environmentService.args['use-test-resolver']);
		let remoteAuthority = (
			useTestResolver
				? 'test+test'
				: (getFirstHeader('x-original-host') || getFirstHeader('x-forwarded-host') || req.headers.host)
		);
		if (!remoteAuthority) {
			return serveError(req, res, 400, 'Bad request.');
		}
		const forwardedPort = getFirstHeader('x-forwarded-port');
		if (forwardedPort) {
			const index = remoteAuthority.indexOf(':');
			if (index !== -1) {
				remoteAuthority = remoteAuthority.substring(0, index);
			}
			remoteAuthority += `:${forwardedPort}`;
		}

		const shellConfiguration = {
			remoteAuthority,
			serverBasePath: basePath,
			productPath: this._productPath
		};

		const staticRoute = posix.join(basePath, this._productPath, STATIC_PATH);

		const filePath = FileAccess.asFileUri('vs/code/browser/workbench/shell.html').fsPath;

		const values: { [key: string]: string } = {
			SHELL_CONFIGURATION: JSON.stringify(shellConfiguration).replace(/"/g, '&quot;'),
			SHELL_WEB_BASE_URL: staticRoute
		};

		let data;
		try {
			const shellTemplate = (await promises.readFile(filePath)).toString();
			data = shellTemplate.replace(/\{\{([^}]+)\}\}/g, (_, key) => values[key] ?? 'undefined');
		} catch (e) {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			return void res.end('Not found');
		}

		const cspDirectives = [
			'default-src \'self\';',
			'img-src \'self\' https: data: blob:;',
			`script-src 'self' 'unsafe-eval' blob: ${this._getScriptCspHashes(data).join(' ')};`,
			`frame-src 'self' https://*.vscode-cdn.net data:;`,
			'style-src \'self\' \'unsafe-inline\';',
			'connect-src \'self\' ws: wss: https:;',
			'font-src \'self\' blob:;'
		].join(' ');

		const headers: http.OutgoingHttpHeaders = {
			'Content-Type': 'text/html',
			'Content-Security-Policy': cspDirectives
		};
		if (this._connectionToken.type !== ServerConnectionTokenType.None) {
			headers['Set-Cookie'] = cookie.serialize(
				connectionTokenCookieName,
				this._connectionToken.value,
				{
					sameSite: 'lax',
					maxAge: 60 * 60 * 24 * 7 /* 1 week */
				}
			);
		}

		res.writeHead(200, headers);
		return void res.end(data);
	}

	private _readRequestBody(req: http.IncomingMessage): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			let data = '';
			req.on('data', chunk => { data += chunk; });
			req.on('end', () => resolve(data));
			req.on('error', reject);
		});
	}

	/**
	 * Handle POST requests for /api/worktrees
	 */
	private async _handleWorktreeApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			return serveError(req, res, 405, 'Method not allowed');
		}

		const body = await this._readRequestBody(req);

		let repoUris: string[];
		try {
			const parsed = JSON.parse(body);
			repoUris = parsed.repoUris;
			if (!Array.isArray(repoUris)) {
				throw new Error('repoUris must be an array');
			}
		} catch (e) {
			return serveError(req, res, 400, 'Invalid request body');
		}

		interface IWorktreeInfo {
			path: string;
			head: string;
			branch: string;
			isBare: boolean;
		}

		interface IRepoWorktreeResult {
			repoUri: string;
			worktrees: IWorktreeInfo[];
			error?: string;
		}

		const results: IRepoWorktreeResult[] = [];

		for (const repoUri of repoUris) {
			const repoPath = URI.parse(repoUri).fsPath;
			try {
				const stdout = await new Promise<string>((resolveExec, rejectExec) => {
					execFile('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath }, (err, stdout) => {
						if (err) {
							rejectExec(err);
						} else {
							resolveExec(stdout);
						}
					});
				});

				const worktrees: IWorktreeInfo[] = [];
				const blocks = stdout.split('\n\n').filter(b => b.trim());
				for (const block of blocks) {
					const lines = block.split('\n');
					let wtPath = '';
					let head = '';
					let branch = '';
					let isBare = false;
					for (const line of lines) {
						if (line.startsWith('worktree ')) {
							wtPath = line.substring('worktree '.length);
						} else if (line.startsWith('HEAD ')) {
							head = line.substring('HEAD '.length);
						} else if (line.startsWith('branch ')) {
							branch = line.substring('branch '.length);
						} else if (line === 'bare') {
							isBare = true;
						}
					}
					if (wtPath) {
						worktrees.push({ path: wtPath, head, branch, isBare });
					}
				}

				results.push({ repoUri, worktrees });
			} catch (err) {
				results.push({ repoUri, worktrees: [], error: String(err) });
			}
		}

		const responseData = JSON.stringify(results);
		res.writeHead(200, {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(responseData)
		});
		return void res.end(responseData);
	}

	/**
	 * Handle POST requests for /api/browse — list directory contents
	 */
	private async _handleBrowseApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			return serveError(req, res, 405, 'Method not allowed');
		}

		const body = await this._readRequestBody(req);

		let browsePath: string;
		let showHidden = false;
		try {
			const parsed = JSON.parse(body);
			browsePath = parsed.path || os.homedir();
			showHidden = !!parsed.showHidden;
		} catch (e) {
			return serveError(req, res, 400, 'Invalid request body');
		}

		try {
			const resolvedPath = resolve(browsePath);
			const entries = await promises.readdir(resolvedPath, { withFileTypes: true });
			const dirs = entries
				.filter(e => e.isDirectory() && (showHidden || !e.name.startsWith('.')))
				.map(e => ({ name: e.name, isDirectory: true }))
				.sort((a, b) => a.name.localeCompare(b.name));

			const parent = dirname(resolvedPath) !== resolvedPath ? dirname(resolvedPath) : null;

			const responseData = JSON.stringify({ path: resolvedPath, entries: dirs, parent });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		} catch (error) {
			if (error.code === 'ENOENT') {
				return serveError(req, res, 404, 'Directory not found');
			}
			if (error.code === 'EACCES') {
				return serveError(req, res, 403, 'Permission denied');
			}
			return serveError(req, res, 500, String(error));
		}
	}

	/**
	 * Handle POST requests for /api/worktree-remove — remove a git worktree
	 */
	private async _handleWorktreeRemoveApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			return serveError(req, res, 405, 'Method not allowed');
		}

		const body = await this._readRequestBody(req);

		let repoPath: string;
		let worktreePath: string;
		try {
			const parsed = JSON.parse(body);
			repoPath = parsed.repoPath;
			worktreePath = parsed.worktreePath;
			if (!repoPath || !worktreePath) {
				throw new Error('repoPath and worktreePath are required');
			}
		} catch (e) {
			return serveError(req, res, 400, 'Invalid request body');
		}

		try {
			await new Promise<void>((resolveRemove, rejectRemove) => {
				execFile('git', ['worktree', 'remove', worktreePath], { cwd: repoPath, timeout: 30000 }, (err) => {
					if (err) {
						rejectRemove(err);
					} else {
						resolveRemove();
					}
				});
			});

			const responseData = JSON.stringify({ success: true });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		} catch (error) {
			const responseData = JSON.stringify({ success: false, error: String(error) });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		}
	}

	/**
	 * Handle POST requests for /api/worktree-add — create a new git worktree
	 */
	private async _handleWorktreeAddApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			return serveError(req, res, 405, 'Method not allowed');
		}

		const body = await this._readRequestBody(req);

		let repoPath: string;
		let branchName: string;
		let newBranch: boolean;
		try {
			const parsed = JSON.parse(body);
			repoPath = parsed.repoPath;
			branchName = parsed.branchName;
			newBranch = !!parsed.newBranch;
			if (!repoPath || !branchName) {
				throw new Error('repoPath and branchName are required');
			}
		} catch (e) {
			return serveError(req, res, 400, 'Invalid request body');
		}

		const sanitized = branchName.replace(/\//g, '-');
		const worktreePath = `${repoPath}-${sanitized}`;

		try {
			const args = newBranch
				? ['worktree', 'add', '-b', branchName, worktreePath]
				: ['worktree', 'add', worktreePath, branchName];

			await new Promise<void>((resolveAdd, rejectAdd) => {
				execFile('git', args, { cwd: repoPath, timeout: 30000 }, (err) => {
					if (err) {
						rejectAdd(err);
					} else {
						resolveAdd();
					}
				});
			});

			// Copy .env files from the main worktree (best-effort)
			try {
				await this._copyEnvFiles(repoPath, worktreePath);
			} catch (envErr) {
				this._logService.warn('[WebClientServer] Failed to copy .env files:', envErr);
			}

			const responseData = JSON.stringify({ success: true, path: worktreePath });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		} catch (error) {
			const responseData = JSON.stringify({ success: false, error: String(error) });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		}
	}

	/**
	 * Handle POST requests for /api/branches — list branches for a repo
	 */
	private async _handleBranchesApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			return serveError(req, res, 405, 'Method not allowed');
		}

		const body = await this._readRequestBody(req);

		let repoPath: string;
		try {
			const parsed = JSON.parse(body);
			repoPath = parsed.repoPath;
			if (!repoPath) {
				throw new Error('repoPath is required');
			}
		} catch (e) {
			return serveError(req, res, 400, 'Invalid request body');
		}

		try {
			const stdout = await new Promise<string>((resolveExec, rejectExec) => {
				execFile('git', ['branch', '-a', '--no-color'], { cwd: repoPath }, (err, out) => {
					if (err) {
						rejectExec(err);
					} else {
						resolveExec(out);
					}
				});
			});

			const branches = stdout
				.split('\n')
				.map(line => line.replace(/^[*+]?\s+/, '').trim())
				.filter(line => line && !line.includes(' -> '))
				.map(line => line.replace(/^remotes\/origin\//, ''));
			// Deduplicate
			const unique = [...new Set(branches)];

			const responseData = JSON.stringify({ branches: unique });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		} catch (error) {
			const responseData = JSON.stringify({ branches: [], error: String(error) });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		}
	}

	/**
	 * Handle POST requests for /api/rename-branch — rename a git branch
	 */
	private async _handleRenameBranchApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			return serveError(req, res, 405, 'Method not allowed');
		}

		const body = await this._readRequestBody(req);

		let worktreePath: string;
		let oldBranch: string;
		let newBranch: string;
		try {
			const parsed = JSON.parse(body);
			worktreePath = parsed.worktreePath;
			oldBranch = parsed.oldBranch;
			newBranch = parsed.newBranch;
			if (!worktreePath || !oldBranch || !newBranch) {
				throw new Error('worktreePath, oldBranch, and newBranch are required');
			}
		} catch (e) {
			return serveError(req, res, 400, 'Invalid request body');
		}

		try {
			await new Promise<string>((resolveExec, rejectExec) => {
				execFile('git', ['branch', '-m', oldBranch, newBranch], { cwd: worktreePath }, (err, out) => {
					if (err) {
						rejectExec(err);
					} else {
						resolveExec(out);
					}
				});
			});

			const responseData = JSON.stringify({ success: true });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		} catch (error) {
			const responseData = JSON.stringify({ success: false, error: String(error) });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		}
	}

	/**
	 * Handle POST requests for /api/clone — clone a git repository
	 */
	private async _handleCloneApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== 'POST') {
			return serveError(req, res, 405, 'Method not allowed');
		}

		const body = await this._readRequestBody(req);

		let cloneUrl: string;
		let destPath: string;
		try {
			const parsed = JSON.parse(body);
			cloneUrl = parsed.url;
			destPath = parsed.destPath;
			if (!cloneUrl || !destPath) {
				throw new Error('url and destPath are required');
			}
		} catch (e) {
			return serveError(req, res, 400, 'Invalid request body');
		}

		try {
			await new Promise<void>((resolveClone, rejectClone) => {
				execFile('git', ['clone', cloneUrl, destPath], { timeout: 120000 }, (err) => {
					if (err) {
						rejectClone(err);
					} else {
						resolveClone();
					}
				});
			});

			const responseData = JSON.stringify({ success: true, path: destPath });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		} catch (error) {
			const responseData = JSON.stringify({ success: false, path: destPath, error: String(error) });
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(responseData)
			});
			return void res.end(responseData);
		}
	}

	private static readonly ENV_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out']);

	/**
	 * Recursively find and copy .env* files from source to dest worktree,
	 * preserving relative directory structure. Skips files that already exist.
	 */
	private async _copyEnvFiles(sourcePath: string, destPath: string): Promise<void> {
		const walk = async (dir: string): Promise<void> => {
			let entries: import('fs').Dirent[];
			try {
				entries = await promises.readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.isDirectory()) {
					if (!WebClientServer.ENV_SKIP_DIRS.has(entry.name)) {
						await walk(join(dir, entry.name));
					}
				} else if (entry.isFile() && entry.name.startsWith('.env')) {
					const relPath = relative(sourcePath, join(dir, entry.name));
					const destFile = join(destPath, relPath);
					try {
						await promises.access(destFile);
						// File already exists — skip
					} catch {
						await promises.mkdir(dirname(destFile), { recursive: true });
						await promises.copyFile(join(dir, entry.name), destFile);
						this._logService.info(`[WebClientServer] Copied ${relPath} to new worktree`);
					}
				}
			}
		};
		await walk(sourcePath);
	}

	/**
	 * Handle GET/POST requests for /api/shell-settings — persist shell sidebar settings
	 */
	private async _handleShellSettingsApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const settingsPath = join(this._environmentService.appSettingsHome.fsPath, 'shellSettings.json');

		if (req.method === 'GET') {
			try {
				const data = await promises.readFile(settingsPath, 'utf-8');
				const responseData = data;
				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(responseData)
				});
				return void res.end(responseData);
			} catch {
				const responseData = JSON.stringify({ trackedRepositories: [], lastBrowsePath: '' });
				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(responseData)
				});
				return void res.end(responseData);
			}
		}

		if (req.method === 'POST') {
			const body = await this._readRequestBody(req);
			try {
				// Validate JSON
				JSON.parse(body);
				const dir = dirname(settingsPath);
				await promises.mkdir(dir, { recursive: true });
				await promises.writeFile(settingsPath, body, 'utf-8');
				const responseData = JSON.stringify({ success: true });
				res.writeHead(200, {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(responseData)
				});
				return void res.end(responseData);
			} catch (e) {
				return serveError(req, res, 400, 'Invalid request body');
			}
		}

		return serveError(req, res, 405, 'Method not allowed');
	}

	private _getScriptCspHashes(content: string): string[] {
		// Compute the CSP hashes for line scripts. Uses regex
		// which means it isn't 100% good.
		const regex = /<script>([\s\S]+?)<\/script>/img;
		const result: string[] = [];
		let match: RegExpExecArray | null;
		while (match = regex.exec(content)) {
			const hasher = crypto.createHash('sha256');
			// This only works on Windows if we strip `\r` from `\r\n`.
			const script = match[1].replace(/\r\n/g, '\n');
			const hash = hasher
				.update(Buffer.from(script))
				.digest().toString('base64');

			result.push(`'sha256-${hash}'`);
		}
		return result;
	}

	/**
	 * Handle HTTP requests for /callback
	 */
	private async _handleCallback(res: http.ServerResponse): Promise<void> {
		const filePath = FileAccess.asFileUri('vs/code/browser/workbench/callback.html').fsPath;
		const data = (await promises.readFile(filePath)).toString();
		const cspDirectives = [
			'default-src \'self\';',
			'img-src \'self\' https: data: blob:;',
			'media-src \'none\';',
			`script-src 'self' ${this._getScriptCspHashes(data).join(' ')};`,
			'style-src \'self\' \'unsafe-inline\';',
			'font-src \'self\' blob:;'
		].join(' ');

		res.writeHead(200, {
			'Content-Type': 'text/html',
			'Content-Security-Policy': cspDirectives
		});
		return void res.end(data);
	}
}
