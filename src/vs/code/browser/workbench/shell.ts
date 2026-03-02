/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax, no-restricted-globals */

export interface IWorktreeInfo {
	path: string;
	head: string;
	branch: string;
	isBare: boolean;
}

export interface IRepoWorktreeResult {
	repoUri: string;
	worktrees: IWorktreeInfo[];
	error?: string;
}

export interface IBrowseResult {
	path: string;
	entries: { name: string; isDirectory: boolean }[];
	parent: string | null;
}

export interface IShellNotification {
	type: string;
	source: string;
	worktreePath: string;
	active: boolean;
	severity?: 'info' | 'warning';
	message?: string;
}

/**
 * Backend abstraction for the shell sidebar.
 * Web mode uses fetch() to server APIs + iframe creation.
 * Electron mode uses IPC calls + WebContentsView management.
 */
export interface IShellSettings {
	trackedRepositories: string[];
	lastBrowsePath: string;
	lastActiveWorktree?: string;
}

export interface IShellBackend {
	listDirectory(path: string, showHidden: boolean): Promise<IBrowseResult>;
	getWorktrees(repoUris: string[]): Promise<IRepoWorktreeResult[]>;
	addWorktree(repoPath: string, branchName: string, newBranch: boolean): Promise<{ success: boolean; path?: string; error?: string }>;
	removeWorktree(repoPath: string, worktreePath: string): Promise<{ success: boolean; error?: string }>;
	listBranches(repoPath: string): Promise<{ branches: string[] }>;
	renameBranch(repoPath: string, worktreePath: string, oldBranch: string, newBranch: string): Promise<{ success: boolean; error?: string }>;
	cloneRepo(url: string, destPath: string): Promise<{ success: boolean; path?: string; error?: string }>;
	loadSettings(): Promise<IShellSettings>;
	saveSettings(settings: IShellSettings): Promise<void>;
	switchToWorktree(worktreePath: string): void;
	onWorktreeRemoved(worktreePath: string): void;
	/** Native folder dialog (electron only). Returns selected path or null. */
	showOpenDialog?(): Promise<string | null>;
	/** Hide/show the active WebContentsView so HTML overlays are visible (electron only). */
	setActiveViewVisible?(visible: boolean): void;
	/** Register a handler for notifications from workbench instances. */
	onNotification?(handler: (notification: IShellNotification) => void): void;
	/** Request OS dock badge / taskbar flash when a notification is active. */
	requestDockNotification?(): void;
}

interface IShellConfiguration {
	remoteAuthority: string;
	serverBasePath: string;
	productPath: string;
	connectionToken?: string;
	partsSplash?: {
		colorInfo?: {
			background?: string;
			foreground?: string;
			sideBarBackground?: string;
			sideBarBorder?: string;
			titleBarBackground?: string;
			titleBarBorder?: string;
		};
	};
}

// --- Worktree naming schemes ---
// Each repo is assigned a random scheme. Within that scheme, names are picked randomly.

const WORKTREE_NAMING_SCHEMES: Record<string, string[]> = {
	// Celestial bodies & space objects
	cosmos: [
		'andromeda', 'apollo', 'ariel', 'asteroid', 'callisto', 'cassini', 'celeste', 'centauri',
		'ceres', 'comet', 'cosmos', 'deimos', 'eclipse', 'europa', 'galaxy', 'ganymede',
		'halley', 'hubble', 'io', 'juno', 'kepler', 'luna', 'mars', 'meteor',
		'miranda', 'nebula', 'neptune', 'nova', 'oberon', 'orbit', 'orion', 'phoebe',
		'pluto', 'pulsar', 'quasar', 'saturn', 'sirius', 'solstice', 'stellar', 'supernova',
		'titan', 'triton', 'umbra', 'vega', 'venus', 'vesta', 'voyager', 'zenith',
		'zodiac', 'aurora', 'equinox', 'parsec', 'photon', 'corona',
	],
	// World cities
	cities: [
		'amsterdam', 'athens', 'austin', 'bali', 'barcelona', 'berlin', 'bogota', 'boston',
		'cairo', 'capetown', 'chicago', 'copenhagen', 'denver', 'dublin', 'edinburgh', 'florence',
		'geneva', 'havana', 'helsinki', 'hongkong', 'istanbul', 'jakarta', 'kyoto', 'lagos',
		'lima', 'lisbon', 'london', 'madrid', 'manila', 'marrakech', 'melbourne', 'miami',
		'milan', 'montreal', 'mumbai', 'nairobi', 'nashville', 'oslo', 'paris', 'portland',
		'prague', 'rio', 'rome', 'santiago', 'seattle', 'seoul', 'shanghai', 'singapore',
		'stockholm', 'sydney', 'taipei', 'tokyo', 'toronto', 'vienna',
	],
	// Fruits & berries
	fruits: [
		'apple', 'apricot', 'avocado', 'banana', 'blackberry', 'blueberry', 'cantaloupe', 'cherry',
		'clementine', 'coconut', 'cranberry', 'currant', 'date', 'dragonfruit', 'elderberry', 'fig',
		'gooseberry', 'grape', 'grapefruit', 'guava', 'honeydew', 'jackfruit', 'kiwi', 'kumquat',
		'lemon', 'lime', 'loquat', 'lychee', 'mandarin', 'mango', 'melon', 'mulberry',
		'nectarine', 'olive', 'orange', 'papaya', 'passionfruit', 'peach', 'pear', 'persimmon',
		'pineapple', 'plum', 'pomegranate', 'quince', 'rambutan', 'raspberry', 'starfruit', 'strawberry',
		'tangerine', 'watermelon', 'yuzu', 'tamarind', 'boysenberry', 'durian',
	],
	// Musical genres & terms
	music: [
		'adagio', 'allegro', 'ballad', 'bebop', 'blues', 'bolero', 'bossa', 'cadence',
		'calypso', 'cantata', 'chord', 'concerto', 'crescendo', 'disco', 'dubstep', 'encore',
		'etude', 'falsetto', 'fandango', 'forte', 'fugue', 'funk', 'groove', 'harmony',
		'hymn', 'indie', 'jazz', 'jingle', 'keynote', 'largo', 'lyric', 'mambo',
		'melody', 'minuet', 'motown', 'nocturne', 'octave', 'opera', 'overture', 'polka',
		'prelude', 'quartet', 'reggae', 'requiem', 'riff', 'rumba', 'salsa', 'samba',
		'sonata', 'soprano', 'staccato', 'swing', 'symphony', 'tempo',
	],
	// Gemstones & minerals
	gems: [
		'agate', 'alexandrite', 'amber', 'amethyst', 'aquamarine', 'azurite', 'beryl', 'calcite',
		'carnelian', 'citrine', 'copper', 'crystal', 'diamond', 'emerald', 'feldspar', 'fluorite',
		'garnet', 'granite', 'gypsum', 'heliodor', 'iolite', 'ivory', 'jacinth', 'jade',
		'jasper', 'kunzite', 'labradorite', 'lapis', 'larimar', 'malachite', 'marble', 'moonstone',
		'obsidian', 'onyx', 'opal', 'pearl', 'peridot', 'pyrite', 'quartz', 'rhodonite',
		'ruby', 'rutile', 'sapphire', 'selenite', 'spinel', 'sunstone', 'tanzanite', 'topaz',
		'tourmaline', 'turquoise', 'zircon', 'beryllium', 'corundum', 'diamond',
	],
	// Mythology characters
	myths: [
		'achilles', 'aphrodite', 'apollo', 'ares', 'artemis', 'athena', 'atlas', 'aurora',
		'bacchus', 'calypso', 'cassandra', 'cerberus', 'clio', 'cronus', 'cupid', 'daphne',
		'demeter', 'diana', 'echo', 'electra', 'europa', 'flora', 'fortuna', 'freya',
		'gaia', 'hades', 'hecate', 'helios', 'hera', 'hermes', 'hyperion', 'icarus',
		'iris', 'janus', 'juno', 'loki', 'luna', 'medusa', 'mercury', 'minerva',
		'morpheus', 'nemesis', 'nike', 'nyx', 'odin', 'olympus', 'orpheus', 'pandora',
		'pegasus', 'phoenix', 'prometheus', 'rhea', 'selene', 'thor',
	],
	// Ocean & sea life
	ocean: [
		'anchovy', 'anemone', 'barracuda', 'beluga', 'bonito', 'bream', 'clownfish', 'conch',
		'coral', 'cuttlefish', 'dolphin', 'dorado', 'dugong', 'eel', 'flounder', 'grouper',
		'guppy', 'halibut', 'hammerhead', 'herring', 'jellyfish', 'kelp', 'krill', 'lobster',
		'mackerel', 'mahi', 'manta', 'marlin', 'mollusk', 'moray', 'narwhal', 'nautilus',
		'octopus', 'orca', 'oyster', 'pelican', 'penguin', 'plankton', 'puffer', 'reef',
		'sailfish', 'salmon', 'scallop', 'seahorse', 'seal', 'shark', 'shrimp', 'squid',
		'starfish', 'stingray', 'sturgeon', 'swordfish', 'tuna', 'walrus',
	],
	// Spices & herbs
	spices: [
		'anise', 'basil', 'bay', 'bergamot', 'cardamom', 'cayenne', 'chamomile', 'chervil',
		'chili', 'chive', 'cilantro', 'cinnamon', 'clove', 'comfrey', 'coriander', 'cumin',
		'curry', 'dill', 'fennel', 'ginger', 'harissa', 'hyssop', 'jasmine', 'juniper',
		'lavender', 'lemon', 'marjoram', 'mint', 'mustard', 'nutmeg', 'oregano', 'paprika',
		'parsley', 'pepper', 'pimento', 'rosemary', 'saffron', 'sage', 'sesame', 'sorrel',
		'sumac', 'tamarind', 'tarragon', 'thyme', 'turmeric', 'vanilla', 'verbena', 'wasabi',
		'yarrow', 'zaatar', 'galangal', 'lemongrass', 'fenugreek', 'mace',
	],
	// Mountains & peaks
	peaks: [
		'aconcagua', 'alps', 'andes', 'annapurna', 'atlas', 'baker', 'blanc', 'cascade',
		'chimborazo', 'cotopaxi', 'denali', 'dolomite', 'elbrus', 'eiger', 'everest', 'fuji',
		'hood', 'k2', 'kangchenjunga', 'kazbek', 'kenya', 'kilimanjaro', 'kinabalu', 'lhotse',
		'logan', 'makalu', 'manaslu', 'matterhorn', 'mckinley', 'meru', 'olympus', 'orizaba',
		'parnassus', 'piton', 'rainier', 'rocky', 'rosa', 'rushmore', 'shasta', 'sierra',
		'sinai', 'snowdon', 'summit', 'tahoma', 'teide', 'timpanogos', 'toubkal', 'ural',
		'vinson', 'whitney', 'zugspitze', 'baldy', 'cenis', 'pikes',
	],
	// Dog breeds
	dogs: [
		'akita', 'basenji', 'beagle', 'boxer', 'briard', 'borzoi', 'bulldog', 'chihuahua',
		'collie', 'corgi', 'dachshund', 'dalmatian', 'deerhound', 'doberman', 'greyhound', 'harrier',
		'havanese', 'husky', 'keeshond', 'kelpie', 'komondor', 'labrador', 'leonberger', 'lhasa',
		'lurcher', 'malamute', 'maltese', 'mastiff', 'mudi', 'newfie', 'otterhound', 'papillon',
		'pekingese', 'pharaoh', 'pointer', 'pomeranian', 'poodle', 'puggle', 'retriever', 'ridgeback',
		'rottweiler', 'saluki', 'samoyed', 'schipperke', 'schnauzer', 'setter', 'shiba', 'shihtzu',
		'spaniel', 'terrier', 'vizsla', 'weimaraner', 'whippet', 'wolfhound',
	],
	// Dinosaurs
	dinos: [
		'allo', 'ankylo', 'apato', 'archaeo', 'baryonyx', 'brachio', 'bronco', 'carno',
		'cera', 'coelo', 'compy', 'deinony', 'diloph', 'diplo', 'draco', 'edmonto',
		'galli', 'gigano', 'hadro', 'herrera', 'iguano', 'kentro', 'lambeo', 'lepto',
		'megalo', 'micro', 'mosa', 'nano', 'ornitho', 'oviraptor', 'pachy', 'parasaur',
		'plated', 'plesio', 'proto', 'ptero', 'raptor', 'rex', 'sauro', 'spino',
		'stego', 'styraco', 'sucho', 'thero', 'toro', 'trex', 'tricera', 'trodon',
		'tyranno', 'utah', 'veloci', 'vulcano', 'xeno', 'zephyro',
	],
	// Coffee & tea drinks
	cafe: [
		'affogato', 'americano', 'assam', 'barista', 'bourbon', 'breve', 'cappuccino', 'caramel',
		'chai', 'chemex', 'cold-brew', 'cortado', 'darjeeling', 'decaf', 'doppio', 'earl-grey',
		'espresso', 'flat-white', 'frappe', 'galao', 'genmaicha', 'gyokuro', 'hojicha', 'horchata',
		'irish', 'jasmine', 'kopi', 'latte', 'lungo', 'macchiato', 'matcha', 'mazagran',
		'mocha', 'nitro', 'oolong', 'piccolo', 'pourover', 'puerh', 'ristretto', 'roast',
		'robusta', 'rooibos', 'sencha', 'siphon', 'single-origin', 'steamer', 'toddy', 'turkish',
		'turmeric', 'vanilla-latte', 'vienna', 'yerba', 'yuanyang', 'cascara',
	],
};

const SCHEME_NAMES = Object.keys(WORKTREE_NAMING_SCHEMES);
const REPO_SCHEME_STORAGE_KEY = 'worktreeNamingSchemes';

function getSchemeForRepo(repoPath: string): string {
	let assignments: Record<string, string> = {};
	try {
		const stored = localStorage.getItem(REPO_SCHEME_STORAGE_KEY);
		if (stored) {
			assignments = JSON.parse(stored);
		}
	} catch {
		// Corrupted storage, start fresh
	}

	// Already assigned?
	if (assignments[repoPath] && WORKTREE_NAMING_SCHEMES[assignments[repoPath]]) {
		return assignments[repoPath];
	}

	// Pick a scheme not yet used by another repo
	const usedSchemes = new Set(Object.values(assignments));
	const available = SCHEME_NAMES.filter(s => !usedSchemes.has(s));
	const scheme = available.length > 0
		? available[Math.floor(Math.random() * available.length)]
		: SCHEME_NAMES[Math.floor(Math.random() * SCHEME_NAMES.length)]; // all used, allow reuse

	assignments[repoPath] = scheme;
	try {
		localStorage.setItem(REPO_SCHEME_STORAGE_KEY, JSON.stringify(assignments));
	} catch {
		// Storage full or unavailable
	}

	return scheme;
}

function generateWorktreeName(existingBranches: Set<string>, repoPath: string): string {
	const scheme = getSchemeForRepo(repoPath);
	const words = WORKTREE_NAMING_SCHEMES[scheme];

	const maxAttempts = words.length;
	for (let i = 0; i < maxAttempts; i++) {
		const word = words[Math.floor(Math.random() * words.length)];
		if (!existingBranches.has(word)) {
			return word;
		}
	}
	// Fallback: all names used, generate with random suffix
	const word = words[Math.floor(Math.random() * words.length)];
	return `${word}-${Math.floor(Math.random() * 1000)}`;
}

const MAX_IFRAMES = 5;

/**
 * Creates a web-based backend that communicates with the server via HTTP APIs
 * and creates iframes for workbench instances.
 */
function createWebBackend(config: IShellConfiguration, iframeContainer: HTMLElement, iframes: Map<string, HTMLIFrameElement>, iframeLRU: string[]): IShellBackend {

	function buildPath(...segments: string[]): string {
		const joined = segments.join('/');
		return joined.replace(/(?<!:)\/\/+/g, '/');
	}

	function apiUrl(apiPath: string): string {
		let url = buildPath(config.serverBasePath, config.productPath, apiPath);
		if (config.connectionToken) {
			const separator = url.includes('?') ? '&' : '?';
			url += `${separator}tkn=${encodeURIComponent(config.connectionToken)}`;
		}
		return url;
	}

	async function fetchJson<T>(apiPath: string, body: object): Promise<T> {
		const url = apiUrl(apiPath);
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(text || `HTTP ${response.status}`);
		}

		return response.json();
	}

	return {
		listDirectory: (path, showHidden) => fetchJson<IBrowseResult>('/api/browse', { path, showHidden }),
		getWorktrees: repoUris => fetchJson<IRepoWorktreeResult[]>('/api/worktrees', { repoUris }),
		addWorktree: (repoPath, branchName, newBranch) => fetchJson('/api/worktree-add', { repoPath, branchName, newBranch }),
		removeWorktree: (repoPath, worktreePath) => fetchJson('/api/worktree-remove', { repoPath, worktreePath }),
		listBranches: repoPath => fetchJson('/api/branches', { repoPath }),
		renameBranch: (repoPath, worktreePath, oldBranch, newBranch) => fetchJson('/api/rename-branch', { repoPath, worktreePath, oldBranch, newBranch }),
		cloneRepo: (url, destPath) => fetchJson('/api/clone', { url, destPath }),

		async loadSettings(): Promise<IShellSettings> {
			const settingsUrl = apiUrl('/api/shell-settings');
			const response = await fetch(settingsUrl);
			if (!response.ok) {
				return { trackedRepositories: [], lastBrowsePath: '' };
			}
			return response.json();
		},

		async saveSettings(settings: IShellSettings): Promise<void> {
			const settingsUrl = apiUrl('/api/shell-settings');
			await fetch(settingsUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(settings)
			});
		},

		switchToWorktree(worktreePath: string): void {
			// Hide all iframes and notify them they are inactive
			for (const iframe of iframes.values()) {
				iframe.classList.add('hidden');
				iframe.contentWindow?.postMessage({ type: 'shell.activeView', active: false }, '*');
			}

			// Show or create the iframe
			let iframe = iframes.get(worktreePath);
			if (iframe) {
				iframe.classList.remove('hidden');
				const idx = iframeLRU.indexOf(worktreePath);
				if (idx !== -1) {
					iframeLRU.splice(idx, 1);
				}
				iframeLRU.push(worktreePath);
			} else {
				// Evict if at capacity
				while (iframes.size >= MAX_IFRAMES && iframeLRU.length > 0) {
					const evictPath = iframeLRU.shift()!;
					const evictIframe = iframes.get(evictPath);
					if (evictIframe) {
						evictIframe.remove();
						iframes.delete(evictPath);
					}
				}

				iframe = document.createElement('iframe');
				let iframeUrl: string;
				if (worktreePath === '__empty__') {
					iframeUrl = buildPath(config.serverBasePath, config.productPath, '/?embedded=true');
				} else {
					const folderUri = `vscode-remote://${config.remoteAuthority}${worktreePath}`;
					iframeUrl = buildPath(config.serverBasePath, config.productPath, `/?folder=${encodeURIComponent(folderUri)}&embedded=true`);
				}
				if (config.connectionToken) {
					iframeUrl += `&tkn=${encodeURIComponent(config.connectionToken)}`;
				}
				iframe.src = iframeUrl;
				iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
				iframeContainer.appendChild(iframe);
				iframes.set(worktreePath, iframe);
				iframeLRU.push(worktreePath);
			}

			// Notify the now-visible iframe that it's active
			iframe.contentWindow?.postMessage({ type: 'shell.activeView', active: true }, '*');

			// Update browser URL
			const newUrl = new URL(window.location.href);
			if (worktreePath === '__empty__') {
				newUrl.searchParams.delete('folder');
			} else {
				const folderUri = `vscode-remote://${config.remoteAuthority}${worktreePath}`;
				newUrl.searchParams.set('folder', folderUri);
			}
			history.replaceState(null, '', newUrl.toString());
		},

		onWorktreeRemoved(worktreePath: string): void {
			const iframe = iframes.get(worktreePath);
			if (iframe) {
				iframe.remove();
				iframes.delete(worktreePath);
				const lruIdx = iframeLRU.indexOf(worktreePath);
				if (lruIdx !== -1) {
					iframeLRU.splice(lruIdx, 1);
				}
			}
		}
	};
}

export class ShellApplication {

	private readonly backend: IShellBackend;
	private readonly repoListEl: HTMLElement;
	private readonly iframeContainer: HTMLElement;
	private readonly iframes = new Map<string, HTMLIFrameElement>();
	private readonly iframeLRU: string[] = [];
	private activeWorktreePath: string | null = null;
	private trackedRepos: string[] = [];
	private repoWorktrees = new Map<string, IWorktreeInfo[]>();
	private _activePopupDismiss: (() => void) | null = null;
	/** Active notifications keyed by `worktreePath:source` */
	private readonly _notifications = new Map<string, IShellNotification>();

	private lastBrowsePath = '';

	constructor(backend?: IShellBackend) {
		this.repoListEl = document.getElementById('repo-list')!;
		this.iframeContainer = document.getElementById('iframe-container')!;

		if (backend) {
			this.backend = backend;
		} else {
			// Web mode: read config from meta element
			const configElement = document.getElementById('vscode-shell-configuration');
			const configAttr = configElement?.getAttribute('data-settings');
			if (!configAttr) {
				throw new Error('Missing shell configuration element');
			}
			const config: IShellConfiguration = JSON.parse(configAttr);
			this.backend = createWebBackend(config, this.iframeContainer, this.iframes, this.iframeLRU);

			// Apply theme colors: try config first, then localStorage splash data
			const colorInfo = config.partsSplash?.colorInfo ?? this._readSplashFromStorage();
			if (colorInfo) {
				ShellApplication._applyThemeColors(colorInfo);
			}
		}

		this._setupEventListeners();

		// Register notification handler
		this.backend.onNotification?.(notification => this._handleNotification(notification));

		// Check if URL has ?folder= param — auto-activate that worktree
		const urlParams = new URLSearchParams(window.location.search);
		const folderParam = urlParams.get('folder');
		if (folderParam) {
			try {
				const folderUrl = new URL(folderParam);
				if (folderUrl.protocol === 'vscode-remote:') {
					this.activeWorktreePath = folderUrl.pathname;
				} else {
					this.activeWorktreePath = folderParam;
				}
			} catch {
				this.activeWorktreePath = folderParam;
			}
		}

		// Load settings from backend (async)
		this._loadInitialSettings();
	}

	private async _loadInitialSettings(): Promise<void> {
		try {
			const settings = await this.backend.loadSettings();
			this.trackedRepos = settings.trackedRepositories ?? [];
			this.lastBrowsePath = settings.lastBrowsePath ?? '';
			if (this.trackedRepos.length > 0) {
				await this.refreshWorktrees();
				// Auto-activate if no worktree is active from URL param
				if (!this.activeWorktreePath) {
					this._restoreOrShowEmpty(settings.lastActiveWorktree);
				}
			} else {
				// No repos — show empty workbench for menu support
				this._showEmptyWorkbench();
			}
		} catch (err) {
			console.error('Failed to load shell settings:', err);
			this._showEmptyWorkbench();
		}
	}

	private _restoreOrShowEmpty(lastActiveWorktree?: string): void {
		// Try to restore the last active worktree if it still exists
		if (lastActiveWorktree) {
			for (const worktrees of this.repoWorktrees.values()) {
				if (worktrees.some(wt => wt.path === lastActiveWorktree)) {
					this.switchToWorktree(lastActiveWorktree);
					return;
				}
			}
		}
		// Last active worktree was removed or never set — show empty workbench
		this._showEmptyWorkbench();
	}

	private _readSplashFromStorage(): Record<string, string | undefined> | undefined {
		try {
			const raw = localStorage.getItem('monaco-parts-splash');
			if (raw) {
				const splash = JSON.parse(raw);
				return splash?.colorInfo;
			}
		} catch {
			// ignore parse errors
		}
		return undefined;
	}

	static _applyThemeColors(colorInfo: Record<string, string | undefined>): void {
		const vars: Record<string, string | undefined> = {
			'--shell-background': colorInfo.background,
			'--shell-foreground': colorInfo.foreground,
			'--shell-sidebar-bg': colorInfo.sideBarBackground,
			'--shell-sidebar-border': colorInfo.sideBarBorder,
			'--shell-titlebar-bg': colorInfo.titleBarBackground,
			'--shell-titlebar-border': colorInfo.titleBarBorder,
			'--shell-hover-bg': colorInfo.listHoverBackground,
			'--shell-active-bg': colorInfo.listActiveSelectionBackground,
		};
		const root = document.documentElement;
		for (const [prop, value] of Object.entries(vars)) {
			if (value) {
				root.style.setProperty(prop, value);
			}
		}
	}

	private _setupEventListeners(): void {
		document.getElementById('add-repo-btn')!.addEventListener('click', () => {
			this._showAddRepoMenu();
		});

		document.getElementById('refresh-btn')?.addEventListener('click', () => {
			this.refreshWorktrees();
		});

		window.addEventListener('message', event => {
			if (event.data?.type === 'shell.switchWorktree') {
				this.switchToWorktree(event.data.path);
			} else if (event.data?.type === 'shell.notification') {
				this._handleNotification(event.data.notification);
			}
		});

		// Resize handle drag
		const resizeHandle = document.getElementById('resize-handle')!;
		const sidebar = document.getElementById('shell-sidebar')!;
		let startX = 0;
		let startWidth = 0;

		const onMouseMove = (e: MouseEvent) => {
			const newWidth = startWidth + (e.clientX - startX);
			const clamped = Math.max(200, Math.min(400, newWidth));
			sidebar.style.width = `${clamped}px`;
		};

		const onMouseUp = () => {
			resizeHandle.classList.remove('dragging');
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			this.iframeContainer.style.pointerEvents = '';
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};

		resizeHandle.addEventListener('mousedown', e => {
			e.preventDefault();
			startX = e.clientX;
			startWidth = sidebar.getBoundingClientRect().width;
			resizeHandle.classList.add('dragging');
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			this.iframeContainer.style.pointerEvents = 'none';
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});
	}

	private _showEmptyWorkbench(): void {
		if (this.iframeContainer.querySelectorAll('iframe').length === 0) {
			// Load an empty workbench so menus and keybindings work immediately
			this.backend.switchToWorktree('__empty__');
		}
	}

	/**
	 * Temporarily hides the active WebContentsView (if any) while showing
	 * an HTML overlay, then restores it. No-op in web mode.
	 */
	private async _withOverlay<T>(fn: () => Promise<T>): Promise<T> {
		this.backend.setActiveViewVisible?.(false);
		try {
			return await fn();
		} finally {
			this.backend.setActiveViewVisible?.(true);
		}
	}

	private _dismissActivePopup(): void {
		if (this._activePopupDismiss) {
			this._activePopupDismiss();
			this._activePopupDismiss = null;
		}
	}

	private _showAddRepoMenu(): void {
		this._dismissActivePopup();

		const footer = document.querySelector('.sidebar-footer') as HTMLElement;
		if (!footer) {
			return;
		}

		const menu = document.createElement('div');
		menu.className = 'add-repo-menu';

		const items = [
			{ label: 'Browse Folder...', action: () => { dismiss(); this._browseAndAddRepo(); } },
			{ label: 'Clone Repository...', action: () => { dismiss(); this._showCloneFlow(); } }
		];

		let focusedIndex = -1;

		const updateFocus = () => {
			menu.querySelectorAll('.add-repo-menu-item').forEach((el, i) => {
				el.classList.toggle('focused', i === focusedIndex);
			});
		};

		for (const item of items) {
			const el = document.createElement('div');
			el.className = 'add-repo-menu-item';
			el.textContent = item.label;
			el.addEventListener('click', item.action);
			menu.appendChild(el);
		}

		const dismiss = () => {
			menu.remove();
			document.removeEventListener('mousedown', outsideClickHandler);
			document.removeEventListener('keydown', keyHandler);
			this._activePopupDismiss = null;
		};

		const outsideClickHandler = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				dismiss();
			}
		};

		const keyHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				dismiss();
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
				updateFocus();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				focusedIndex = Math.max(focusedIndex - 1, 0);
				updateFocus();
			} else if (e.key === 'Enter' && focusedIndex >= 0) {
				e.preventDefault();
				items[focusedIndex].action();
			}
		};

		setTimeout(() => {
			document.addEventListener('mousedown', outsideClickHandler);
		}, 0);
		document.addEventListener('keydown', keyHandler);

		footer.appendChild(menu);
		this._activePopupDismiss = dismiss;
	}

	private async _browseAndAddRepo(): Promise<void> {
		let selectedPath: string | null;
		if (this.backend.showOpenDialog) {
			selectedPath = await this.backend.showOpenDialog();
		} else {
			selectedPath = await this._showFolderPicker('browse');
		}
		if (!selectedPath) {
			return;
		}
		const repoUri = `file://${selectedPath}`;
		if (!this.trackedRepos.includes(repoUri)) {
			this.trackedRepos.push(repoUri);
			this._saveSettings();
		}
		await this.refreshWorktrees();
	}

	private async _showFolderPicker(mode: 'browse' | 'cloneDest'): Promise<string | null> {
		return new Promise<string | null>(resolve => {
			const overlay = document.createElement('div');
			overlay.className = 'folder-picker-overlay';

			const picker = document.createElement('div');
			picker.className = 'folder-picker';

			// Header
			const header = document.createElement('div');
			header.className = 'folder-picker-header';

			const pathInput = document.createElement('input');
			pathInput.className = 'folder-picker-path-input';
			pathInput.type = 'text';
			pathInput.placeholder = 'Enter path...';
			pathInput.spellcheck = false;

			let showHidden = false;
			const toggleHiddenBtn = document.createElement('button');
			toggleHiddenBtn.className = 'folder-picker-toggle-hidden';
			toggleHiddenBtn.textContent = 'Show Hidden';
			toggleHiddenBtn.addEventListener('click', () => {
				showHidden = !showHidden;
				toggleHiddenBtn.classList.toggle('active', showHidden);
				loadDirectory(currentPath);
			});

			header.appendChild(pathInput);
			header.appendChild(toggleHiddenBtn);

			// List
			const list = document.createElement('div');
			list.className = 'folder-picker-list';

			// Footer
			const footer = document.createElement('div');
			footer.className = 'folder-picker-footer';

			const statusText = document.createElement('span');
			statusText.className = 'folder-picker-status';

			const btnRow = document.createElement('div');
			btnRow.style.display = 'flex';
			btnRow.style.gap = '8px';

			const cancelBtn = document.createElement('button');
			cancelBtn.className = 'folder-picker-btn folder-picker-btn-cancel';
			cancelBtn.textContent = 'Cancel';

			const selectBtn = document.createElement('button');
			selectBtn.className = 'folder-picker-btn folder-picker-btn-select';
			selectBtn.textContent = mode === 'cloneDest' ? 'Select Destination' : 'Select Folder';

			btnRow.appendChild(cancelBtn);
			btnRow.appendChild(selectBtn);
			footer.appendChild(statusText);
			footer.appendChild(btnRow);

			picker.appendChild(header);
			picker.appendChild(list);
			picker.appendChild(footer);
			overlay.appendChild(picker);

			let currentPath = this.lastBrowsePath || '';
			let focusedIndex = -1;
			let entries: { name: string; isDirectory: boolean }[] = [];
			let parentPath: string | null = null;

			const dismiss = (result: string | null) => {
				overlay.remove();
				resolve(result);
			};

			const updateEntryFocus = () => {
				list.querySelectorAll('.folder-picker-entry').forEach((el, i) => {
					el.classList.toggle('focused', i === focusedIndex);
					if (i === focusedIndex) {
						el.scrollIntoView({ block: 'nearest' });
					}
				});
			};

			const renderEntries = () => {
				list.innerHTML = '';
				const totalEntries: { name: string; icon: string; action: () => void }[] = [];

				if (parentPath !== null) {
					totalEntries.push({
						name: '..',
						icon: '\u{2190}',
						action: () => loadDirectory(parentPath!)
					});
				}

				for (const entry of entries) {
					totalEntries.push({
						name: entry.name,
						icon: '\u{1F4C1}',
						action: () => loadDirectory(currentPath + '/' + entry.name)
					});
				}

				for (const item of totalEntries) {
					const el = document.createElement('div');
					el.className = 'folder-picker-entry';

					const iconSpan = document.createElement('span');
					iconSpan.className = 'folder-picker-entry-icon';
					iconSpan.textContent = item.icon;

					const nameSpan = document.createElement('span');
					nameSpan.className = 'folder-picker-entry-name';
					nameSpan.textContent = item.name;

					el.appendChild(iconSpan);
					el.appendChild(nameSpan);
					el.addEventListener('click', item.action);
					list.appendChild(el);
				}

				focusedIndex = -1;
				statusText.textContent = `${entries.length} folder${entries.length !== 1 ? 's' : ''}`;
			};

			const loadDirectory = async (path: string) => {
				try {
					statusText.textContent = 'Loading...';
					const result = await this.backend.listDirectory(path, showHidden);
					currentPath = result.path;
					parentPath = result.parent;
					entries = result.entries;
					pathInput.value = currentPath;
					this.lastBrowsePath = currentPath;
					this._saveSettings();
					renderEntries();
				} catch (err) {
					statusText.textContent = `Error: ${err}`;
				}
			};

			// Events
			cancelBtn.addEventListener('click', () => dismiss(null));
			selectBtn.addEventListener('click', () => dismiss(currentPath));

			overlay.addEventListener('mousedown', e => {
				if (e.target === overlay) {
					dismiss(null);
				}
			});

			pathInput.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					loadDirectory(pathInput.value.trim());
				} else if (e.key === 'Escape') {
					dismiss(null);
				}
			});

			const pickerKeyHandler = (e: KeyboardEvent) => {
				if (e.target === pathInput) {
					return;
				}
				const totalCount = (parentPath !== null ? 1 : 0) + entries.length;
				if (e.key === 'Escape') {
					e.preventDefault();
					dismiss(null);
				} else if (e.key === 'ArrowDown') {
					e.preventDefault();
					focusedIndex = Math.min(focusedIndex + 1, totalCount - 1);
					updateEntryFocus();
				} else if (e.key === 'ArrowUp') {
					e.preventDefault();
					focusedIndex = Math.max(focusedIndex - 1, 0);
					updateEntryFocus();
				} else if (e.key === 'Enter' && focusedIndex >= 0) {
					e.preventDefault();
					const entryEls = list.querySelectorAll('.folder-picker-entry');
					(entryEls[focusedIndex] as HTMLElement)?.click();
				}
			};
			picker.addEventListener('keydown', pickerKeyHandler);

			document.body.appendChild(overlay);
			pathInput.focus();
			loadDirectory(currentPath);
		});
	}

	private _showQuickInput(options: { label: string; placeholder: string }): Promise<string | null> {
		return new Promise<string | null>(resolve => {
			const overlay = document.createElement('div');
			overlay.className = 'quick-input-overlay';

			const widget = document.createElement('div');
			widget.className = 'quick-input-widget';

			const label = document.createElement('div');
			label.className = 'quick-input-label';
			label.textContent = options.label;

			const input = document.createElement('input');
			input.className = 'quick-input-field';
			input.type = 'text';
			input.placeholder = options.placeholder;
			input.spellcheck = false;

			widget.appendChild(label);
			widget.appendChild(input);
			overlay.appendChild(widget);

			const dismiss = (result: string | null) => {
				overlay.remove();
				resolve(result);
			};

			input.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					dismiss(input.value.trim());
				} else if (e.key === 'Escape') {
					dismiss(null);
				}
			});

			overlay.addEventListener('mousedown', e => {
				if (e.target === overlay) {
					dismiss(null);
				}
			});

			document.body.appendChild(overlay);
			input.focus();
		});
	}

	private async _showCloneFlow(): Promise<void> {
		const gitUrl = await this._withOverlay(() => this._showQuickInput({
			label: 'Enter the repository URL to clone',
			placeholder: 'https://github.com/user/repo.git'
		}));
		if (!gitUrl) {
			return;
		}

		let destDir: string | null;
		if (this.backend.showOpenDialog) {
			destDir = await this.backend.showOpenDialog();
		} else {
			destDir = await this._showFolderPicker('cloneDest');
		}
		if (!destDir) {
			return;
		}

		let repoName = gitUrl.split('/').pop() || 'repo';
		if (repoName.endsWith('.git')) {
			repoName = repoName.slice(0, -4);
		}
		const destPath = destDir + '/' + repoName;

		// Show loading overlay
		const loadingOverlay = document.createElement('div');
		loadingOverlay.className = 'loading-overlay';
		const loadingContent = document.createElement('div');
		loadingContent.className = 'loading-content';
		const spinner = document.createElement('div');
		spinner.className = 'loading-spinner';
		const loadingText = document.createElement('span');
		loadingText.textContent = 'Cloning repository...';
		loadingContent.appendChild(spinner);
		loadingContent.appendChild(loadingText);
		loadingOverlay.appendChild(loadingContent);
		document.body.appendChild(loadingOverlay);

		try {
			const result = await this.backend.cloneRepo(gitUrl, destPath);
			loadingOverlay.remove();

			if (result.success) {
				const repoUri = `file://${result.path}`;
				if (!this.trackedRepos.includes(repoUri)) {
					this.trackedRepos.push(repoUri);
					this._saveSettings();
				}
				await this.refreshWorktrees();
			} else {
				alert(`Clone failed: ${result.error}`);
			}
		} catch (err) {
			loadingOverlay.remove();
			alert(`Clone failed: ${err}`);
		}
	}

	private _removeRepository(repoUri: string): void {
		// Clean up iframes/views for all worktrees belonging to this repo
		const worktrees = this.repoWorktrees.get(repoUri) ?? [];
		let activeRemoved = false;
		for (const wt of worktrees) {
			this.backend.onWorktreeRemoved(wt.path);
			if (this.activeWorktreePath === wt.path) {
				activeRemoved = true;
			}
		}

		if (activeRemoved) {
			this.activeWorktreePath = null;
			const newUrl = new URL(window.location.href);
			newUrl.searchParams.delete('folder');
			history.replaceState(null, '', newUrl.toString());
			this._showEmptyWorkbench();
		}

		this.trackedRepos = this.trackedRepos.filter(r => r !== repoUri);
		this._saveSettings();
		this.repoWorktrees.delete(repoUri);
		this._renderRepoList();
	}

	private _saveSettings(): void {
		this.backend.saveSettings({
			trackedRepositories: this.trackedRepos,
			lastBrowsePath: this.lastBrowsePath,
			lastActiveWorktree: this.activeWorktreePath ?? undefined
		});
	}

	async refreshWorktrees(): Promise<void> {
		if (this.trackedRepos.length === 0) {
			this._renderRepoList();
			return;
		}

		try {
			const results = await this.backend.getWorktrees(this.trackedRepos);
			for (const result of results) {
				this.repoWorktrees.set(result.repoUri, result.worktrees);
			}
		} catch (err) {
			console.error('Failed to fetch worktrees:', err);
		}

		this._renderRepoList();
	}

	private _renderRepoList(): void {
		this.repoListEl.innerHTML = '';

		for (const repoUri of this.trackedRepos) {
			const worktrees = this.repoWorktrees.get(repoUri) ?? [];
			const section = document.createElement('div');
			section.className = 'repo-section';

			const header = document.createElement('div');
			header.className = 'repo-header';

			const expandIcon = document.createElement('span');
			expandIcon.className = 'expand-icon';
			expandIcon.textContent = '\u25BC';

			const repoName = document.createElement('span');
			try {
				const repoUrl = new URL(repoUri);
				repoName.textContent = repoUrl.pathname.split('/').filter(Boolean).pop() ?? repoUri;
			} catch {
				repoName.textContent = repoUri;
			}

			const addWtBtn = document.createElement('button');
			addWtBtn.className = 'add-wt-btn';
			addWtBtn.textContent = '+';
			addWtBtn.title = 'Add worktree';
			addWtBtn.addEventListener('click', e => {
				e.stopPropagation();
				this._addWorktree(repoUri);
			});

			const removeBtn = document.createElement('button');
			removeBtn.className = 'remove-btn';
			removeBtn.textContent = '\u00D7';
			removeBtn.title = 'Remove repository';
			removeBtn.addEventListener('click', e => {
				e.stopPropagation();
				this._removeRepository(repoUri);
			});

			header.appendChild(expandIcon);
			header.appendChild(repoName);
			header.appendChild(addWtBtn);
			header.appendChild(removeBtn);

			const wtList = document.createElement('div');
			wtList.className = 'worktree-list';

			header.addEventListener('click', () => {
				const collapsed = wtList.classList.toggle('collapsed');
				expandIcon.classList.toggle('collapsed', collapsed);
			});

			const mainWorktree = worktrees.find(w => !w.isBare);

			for (const wt of worktrees) {
				const item = document.createElement('div');
				item.className = 'worktree-item';
				if (wt.path === this.activeWorktreePath) {
					item.classList.add('active');
				}

				const branchSpan = document.createElement('span');
				branchSpan.className = 'wt-branch';
				const branchName = wt.branch ? wt.branch.replace('refs/heads/', '') : wt.path.split('/').pop() ?? wt.path;
				branchSpan.textContent = branchName;
				branchSpan.title = wt.path;
				item.appendChild(branchSpan);

				// Double-click to rename non-main worktree branches
				if (!wt.isBare && wt !== mainWorktree) {
					branchSpan.addEventListener('dblclick', e => {
						e.stopPropagation();
						this._startInlineRename(branchSpan, branchName, repoUri, wt);
					});
				}

				// Show notification badge if this worktree has active notifications
				const notifications = this._getNotificationsForWorktree(wt.path);
				if (notifications.length > 0) {
					const badge = this._createNotificationBadge(wt.path, notifications);
					item.appendChild(badge);
				}

				if (wt.isBare) {
					const bareTag = document.createElement('span');
					bareTag.className = 'wt-bare-tag';
					bareTag.textContent = 'bare';
					item.appendChild(bareTag);
				}

				if (!wt.isBare && wt !== mainWorktree) {
					const archiveBtn = document.createElement('button');
					archiveBtn.className = 'archive-btn';
					archiveBtn.textContent = '\u00D7';
					archiveBtn.title = 'Remove worktree';
					archiveBtn.addEventListener('click', e => {
						e.stopPropagation();
						this._archiveWorktree(repoUri, wt);
					});
					item.appendChild(archiveBtn);
				}

				item.addEventListener('click', () => {
					this.switchToWorktree(wt.path);
				});

				wtList.appendChild(item);
			}

			section.appendChild(header);
			section.appendChild(wtList);
			this.repoListEl.appendChild(section);
		}
	}

	private async _addWorktree(repoUri: string): Promise<void> {
		this._dismissActivePopup();

		const repoPath = repoUri.replace(/^file:\/\//, '');

		// Collect existing branch names to avoid collisions
		const existingBranches = new Set<string>();
		try {
			const result = await this.backend.listBranches(repoPath);
			for (const b of result.branches) {
				existingBranches.add(b);
			}
		} catch {
			// Best-effort; proceed even if branch listing fails
		}

		const branchName = generateWorktreeName(existingBranches, repoPath);

		try {
			const result = await this.backend.addWorktree(repoPath, branchName, true);
			if (result.success) {
				await this.refreshWorktrees();
				this.switchToWorktree(result.path!);
			} else {
				alert(`Failed to add worktree: ${result.error}`);
			}
		} catch (err) {
			alert(`Failed to add worktree: ${err}`);
		}
	}

	private _startInlineRename(branchSpan: HTMLSpanElement, currentName: string, repoUri: string, wt: IWorktreeInfo): void {
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'wt-rename-input';
		input.value = currentName;
		input.spellcheck = false;

		const repoPath = repoUri.replace(/^file:\/\//, '');

		const commit = async () => {
			const newName = input.value.trim();
			if (newName && newName !== currentName) {
				try {
					const result = await this.backend.renameBranch(repoPath, wt.path, currentName, newName);
					if (result.success) {
						await this.refreshWorktrees();
						return;
					} else {
						alert(`Failed to rename branch: ${result.error}`);
					}
				} catch (err) {
					alert(`Failed to rename branch: ${err}`);
				}
			}
			cancel();
		};

		const cancel = () => {
			if (input.parentNode) {
				input.replaceWith(branchSpan);
			}
		};

		input.addEventListener('keydown', e => {
			if (e.key === 'Enter') {
				e.preventDefault();
				commit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				cancel();
			}
			e.stopPropagation();
		});

		input.addEventListener('blur', () => {
			commit();
		});

		input.addEventListener('click', e => {
			e.stopPropagation();
		});

		branchSpan.replaceWith(input);
		input.focus();
		input.select();
	}

	private async _archiveWorktree(repoUri: string, wt: IWorktreeInfo): Promise<void> {
		const branchName = wt.branch ? wt.branch.replace('refs/heads/', '') : wt.path.split('/').pop() ?? wt.path;
		if (!confirm(`Remove worktree "${branchName}"?\n\nThis will delete the directory at:\n${wt.path}\n\nThe branch will be kept.`)) {
			return;
		}

		const repoPath = repoUri.replace(/^file:\/\//, '');

		try {
			const result = await this.backend.removeWorktree(repoPath, wt.path);
			if (!result.success) {
				alert(`Failed to remove worktree: ${result.error}`);
				return;
			}

			if (this.activeWorktreePath === wt.path) {
				this.backend.onWorktreeRemoved(wt.path);
				this.activeWorktreePath = null;

				const newUrl = new URL(window.location.href);
				newUrl.searchParams.delete('folder');
				history.replaceState(null, '', newUrl.toString());

				this._showEmptyWorkbench();
			}

			await this.refreshWorktrees();
		} catch (err) {
			alert(`Failed to remove worktree: ${err}`);
		}
	}

	private _handleNotification(notification: IShellNotification): void {
		if (!notification.active) {
			// Ignore clear requests from the workbench — notifications are
			// only dismissed when the user switches to the worktree (see
			// switchToWorktree → _clearNotificationsForWorktree).
			return;
		}
		const key = `${notification.worktreePath}:${notification.source}`;
		this._notifications.set(key, notification);
		// Trigger OS dock badge when a worktree needs attention
		this.backend.requestDockNotification?.();
		// Update badges in-place without re-rendering the whole list,
		// so that the user's expand/collapse state is preserved.
		this._updateBadges(notification.worktreePath);
	}

	private _updateBadges(worktreePath: string): void {
		const items = this.repoListEl.querySelectorAll('.worktree-item');
		for (const item of items) {
			const branchEl = item.querySelector('.wt-branch');
			if (!branchEl || branchEl.getAttribute('title') !== worktreePath) {
				continue;
			}
			// Remove existing badge
			const existing = item.querySelector('.wt-notification-badge');
			if (existing) {
				existing.remove();
			}
			// Add badge if there are active notifications
			const notifications = this._getNotificationsForWorktree(worktreePath);
			if (notifications.length > 0) {
				const badge = this._createNotificationBadge(worktreePath, notifications);
				// Insert badge after the branch span, before any other buttons
				branchEl.after(badge);
			}
			break;
		}
	}

	private _createNotificationBadge(worktreePath: string, notifications: IShellNotification[]): HTMLSpanElement {
		const badge = document.createElement('span');
		const hasWarning = notifications.some(n => n.severity === 'warning');
		badge.className = 'wt-notification-badge' + (hasWarning ? ' warning' : '');
		// allow-any-unicode-next-line
		badge.textContent = '\uD83D\uDD14';
		badge.title = notifications.map(n => n.message || n.type).join(', ');
		badge.addEventListener('click', e => {
			e.stopPropagation();
			this.switchToWorktree(worktreePath);
		});
		return badge;
	}

	private _getNotificationsForWorktree(worktreePath: string): IShellNotification[] {
		const result: IShellNotification[] = [];
		for (const [key, notification] of this._notifications) {
			if (key.startsWith(worktreePath + ':')) {
				result.push(notification);
			}
		}
		return result;
	}

	private _clearNotificationsForWorktree(worktreePath: string): void {
		for (const key of [...this._notifications.keys()]) {
			if (key.startsWith(worktreePath + ':')) {
				this._notifications.delete(key);
			}
		}
	}

	switchToWorktree(worktreePath: string): void {
		if (this.activeWorktreePath === worktreePath) {
			return;
		}

		// Clear notifications for the worktree being switched to
		this._clearNotificationsForWorktree(worktreePath);
		this._updateBadges(worktreePath);

		this.activeWorktreePath = worktreePath;

		// Persist last active worktree (skip sentinel)
		if (worktreePath !== '__empty__') {
			this._saveSettings();
		}

		this.backend.switchToWorktree(worktreePath);

		// Update active styling in sidebar
		this.repoListEl.querySelectorAll('.worktree-item').forEach(el => {
			el.classList.remove('active');
		});
		this.repoListEl.querySelectorAll('.worktree-item').forEach(el => {
			const branchEl = el.querySelector('.wt-branch');
			if (branchEl && branchEl.getAttribute('title') === worktreePath) {
				el.classList.add('active');
			}
		});
	}
}

// Auto-instantiate in web mode (when config meta element is present)
if (document.getElementById('vscode-shell-configuration')) {
	new ShellApplication();
}
