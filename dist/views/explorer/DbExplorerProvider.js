"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbNode = exports.DbExplorerProvider = void 0;
const fsp = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const SUPPORTED_EXTENSIONS = new Set([".sqlite", ".db", ".sqlite3", ".sql"]);
const STORAGE_KEY = "dbViewer.explorerSources";
class DbExplorerProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.roots = new Map();
        this.watchers = new Map();
        this.restore();
    }
    dispose() {
        this._onDidChangeTreeData.dispose();
        for (const watcher of this.watchers.values()) {
            watcher.dispose();
        }
        this.watchers.clear();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element.item;
    }
    async getChildren(element) {
        if (!element) {
            return this.getRootNodes();
        }
        if (element.kind === "rootFolder" || element.kind === "folder") {
            return this.readDirectory(element.uri, false);
        }
        return [];
    }
    async addFile(uri) {
        if (!isSupportedFile(uri)) {
            throw new Error("Selecione um arquivo .sql, .db, .sqlite ou .sqlite3.");
        }
        if (this.isInsideRegisteredFolder(uri)) {
            return;
        }
        this.roots.set(uri.toString(), { kind: "file", uri: uri.toString() });
        await this.persist();
        this.refresh();
    }
    async addFolder(uri) {
        if (this.isInsideRegisteredFolder(uri)) {
            return;
        }
        for (const entry of [...this.roots.values()]) {
            const entryUri = vscode.Uri.parse(entry.uri);
            if (this.isWithinFolder(entryUri, uri)) {
                await this.removeRoot(entryUri);
            }
        }
        this.roots.set(uri.toString(), { kind: "folder", uri: uri.toString() });
        this.ensureFolderWatcher(uri);
        await this.persist();
        this.refresh();
    }
    async removeRoot(uri) {
        const key = uri.toString();
        this.roots.delete(key);
        const watcher = this.watchers.get(key);
        watcher?.dispose();
        this.watchers.delete(key);
        await this.persist();
        this.refresh();
    }
    async ensureFileVisible(uri) {
        if (!isSupportedFile(uri) || this.isInsideRegisteredFolder(uri) || this.roots.has(uri.toString())) {
            return;
        }
        await this.addFile(uri);
    }
    async getRootNodes() {
        const entries = [...this.roots.values()].sort(compareSources);
        return entries.map((entry) => {
            const uri = vscode.Uri.parse(entry.uri);
            if (entry.kind === "folder") {
                return createFolderNode(uri, "rootFolder", path.basename(uri.fsPath) || uri.fsPath, uri.fsPath);
            }
            return createFileNode(uri, "rootFile", path.basename(uri.fsPath), uri.fsPath);
        });
    }
    async readDirectory(dirUri, isRoot) {
        let entries = [];
        try {
            entries = await fsp.readdir(dirUri.fsPath, { withFileTypes: true });
        }
        catch {
            return [];
        }
        const folders = [];
        const files = [];
        for (const entry of entries) {
            const childUri = vscode.Uri.file(path.join(dirUri.fsPath, entry.name));
            if (entry.isDirectory()) {
                folders.push(createFolderNode(childUri, "folder", entry.name, isRoot ? childUri.fsPath : undefined));
                continue;
            }
            if (entry.isFile() && isSupportedFile(childUri)) {
                files.push(createFileNode(childUri, "file", entry.name, isRoot ? childUri.fsPath : undefined));
            }
        }
        folders.sort(compareNodes);
        files.sort(compareNodes);
        return [...folders, ...files];
    }
    restore() {
        const saved = this.context.workspaceState.get(STORAGE_KEY, []);
        for (const entry of saved) {
            this.roots.set(entry.uri, entry);
            if (entry.kind === "folder") {
                this.ensureFolderWatcher(vscode.Uri.parse(entry.uri));
            }
        }
    }
    async persist() {
        await this.context.workspaceState.update(STORAGE_KEY, [...this.roots.values()]);
    }
    ensureFolderWatcher(uri) {
        const key = uri.toString();
        if (this.watchers.has(key)) {
            return;
        }
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uri, "**/*"));
        watcher.onDidCreate(() => this.refresh());
        watcher.onDidDelete(() => this.refresh());
        watcher.onDidChange(() => this.refresh());
        this.watchers.set(key, watcher);
        this.context.subscriptions.push(watcher);
    }
    isInsideRegisteredFolder(uri) {
        for (const entry of this.roots.values()) {
            if (entry.kind !== "folder") {
                continue;
            }
            if (this.isWithinFolder(uri, vscode.Uri.parse(entry.uri))) {
                return true;
            }
        }
        return false;
    }
    isWithinFolder(candidateUri, folderUri) {
        const candidate = normalizeFsPath(candidateUri.fsPath);
        const folderPath = normalizeFsPath(folderUri.fsPath);
        return candidate === folderPath || candidate.startsWith(`${folderPath}${path.sep}`);
    }
}
exports.DbExplorerProvider = DbExplorerProvider;
class DbNode {
    constructor(kind, uri, item) {
        this.kind = kind;
        this.uri = uri;
        this.item = item;
    }
}
exports.DbNode = DbNode;
function createFolderNode(uri, kind, label, description) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.resourceUri = uri;
    item.description = description;
    item.tooltip = uri.fsPath;
    item.contextValue = kind === "rootFolder" ? "dbViewer.rootFolder" : "dbViewer.folder";
    return new DbNode(kind, uri, item);
}
function createFileNode(uri, kind, label, description) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = uri;
    item.description = description;
    item.tooltip = uri.fsPath;
    item.command = { command: "dbViewer.openSqlite", title: "Open in SQL Engine", arguments: [uri] };
    item.contextValue = kind === "rootFile" ? "dbViewer.rootFile" : "dbViewer.file";
    return new DbNode(kind, uri, item);
}
function isSupportedFile(uri) {
    return SUPPORTED_EXTENSIONS.has(path.extname(uri.fsPath).toLowerCase());
}
function compareSources(a, b) {
    if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
    }
    return vscode.Uri.parse(a.uri).fsPath.localeCompare(vscode.Uri.parse(b.uri).fsPath, undefined, { sensitivity: "base" });
}
function compareNodes(a, b) {
    return a.item.label.toString().localeCompare(b.item.label.toString(), undefined, { sensitivity: "base" });
}
function normalizeFsPath(value) {
    return process.platform === "win32" ? value.toLowerCase() : value;
}
//# sourceMappingURL=DbExplorerProvider.js.map