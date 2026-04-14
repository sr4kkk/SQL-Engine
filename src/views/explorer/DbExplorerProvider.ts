import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

type NodeKind = "rootFolder" | "rootFile" | "folder" | "file";

type StoredSource = {
  kind: "folder" | "file";
  uri: string;
};

const SUPPORTED_EXTENSIONS = new Set([".sqlite", ".db", ".sqlite3", ".sql"]);
const STORAGE_KEY = "dbViewer.explorerSources";

export class DbExplorerProvider implements vscode.TreeDataProvider<DbNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DbNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly roots = new Map<string, StoredSource>();
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();

  constructor(private readonly context: vscode.ExtensionContext) {
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

  getTreeItem(element: DbNode): vscode.TreeItem {
    return element.item;
  }

  async getChildren(element?: DbNode): Promise<DbNode[]> {
    if (!element) {
      return this.getRootNodes();
    }

    if (element.kind === "rootFolder" || element.kind === "folder") {
      return this.readDirectory(element.uri, false);
    }

    return [];
  }

  async addFile(uri: vscode.Uri) {
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

  async addFolder(uri: vscode.Uri) {
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

  async removeRoot(uri: vscode.Uri) {
    const key = uri.toString();
    this.roots.delete(key);

    const watcher = this.watchers.get(key);
    watcher?.dispose();
    this.watchers.delete(key);

    await this.persist();
    this.refresh();
  }

  async ensureFileVisible(uri: vscode.Uri) {
    if (!isSupportedFile(uri) || this.isInsideRegisteredFolder(uri) || this.roots.has(uri.toString())) {
      return;
    }

    await this.addFile(uri);
  }

  private async getRootNodes(): Promise<DbNode[]> {
    const entries = [...this.roots.values()].sort(compareSources);
    return entries.map((entry) => {
      const uri = vscode.Uri.parse(entry.uri);
      if (entry.kind === "folder") {
        return createFolderNode(uri, "rootFolder", path.basename(uri.fsPath) || uri.fsPath, uri.fsPath);
      }

      return createFileNode(uri, "rootFile", path.basename(uri.fsPath), uri.fsPath);
    });
  }

  private async readDirectory(dirUri: vscode.Uri, isRoot: boolean): Promise<DbNode[]> {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dirUri.fsPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const folders: DbNode[] = [];
    const files: DbNode[] = [];

    for (const entry of entries) {
      const childUri = vscode.Uri.file(path.join(dirUri.fsPath, entry.name));

      if (entry.isDirectory()) {
        folders.push(
          createFolderNode(
            childUri,
            "folder",
            entry.name,
            isRoot ? childUri.fsPath : undefined
          )
        );
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

  private restore() {
    const saved = this.context.workspaceState.get<StoredSource[]>(STORAGE_KEY, []);
    for (const entry of saved) {
      this.roots.set(entry.uri, entry);
      if (entry.kind === "folder") {
        this.ensureFolderWatcher(vscode.Uri.parse(entry.uri));
      }
    }
  }

  private async persist() {
    await this.context.workspaceState.update(STORAGE_KEY, [...this.roots.values()]);
  }

  private ensureFolderWatcher(uri: vscode.Uri) {
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

  private isInsideRegisteredFolder(uri: vscode.Uri) {
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

  private isWithinFolder(candidateUri: vscode.Uri, folderUri: vscode.Uri) {
    const candidate = normalizeFsPath(candidateUri.fsPath);
    const folderPath = normalizeFsPath(folderUri.fsPath);
    return candidate === folderPath || candidate.startsWith(`${folderPath}${path.sep}`);
  }
}

export class DbNode {
  constructor(
    public readonly kind: NodeKind,
    public readonly uri: vscode.Uri,
    public readonly item: vscode.TreeItem
  ) {}
}

function createFolderNode(uri: vscode.Uri, kind: "rootFolder" | "folder", label: string, description?: string) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.resourceUri = uri;
  item.description = description;
  item.tooltip = uri.fsPath;
  item.contextValue = kind === "rootFolder" ? "dbViewer.rootFolder" : "dbViewer.folder";
  return new DbNode(kind, uri, item);
}

function createFileNode(uri: vscode.Uri, kind: "rootFile" | "file", label: string, description?: string) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.resourceUri = uri;
  item.description = description;
  item.tooltip = uri.fsPath;
  item.command = { command: "dbViewer.openSqlite", title: "Open in SQL Engine", arguments: [uri] };
  item.contextValue = kind === "rootFile" ? "dbViewer.rootFile" : "dbViewer.file";
  return new DbNode(kind, uri, item);
}

function isSupportedFile(uri: vscode.Uri) {
  return SUPPORTED_EXTENSIONS.has(path.extname(uri.fsPath).toLowerCase());
}

function compareSources(a: StoredSource, b: StoredSource) {
  if (a.kind !== b.kind) {
    return a.kind === "folder" ? -1 : 1;
  }

  return vscode.Uri.parse(a.uri).fsPath.localeCompare(vscode.Uri.parse(b.uri).fsPath, undefined, { sensitivity: "base" });
}

function compareNodes(a: DbNode, b: DbNode) {
  return a.item.label!.toString().localeCompare(b.item.label!.toString(), undefined, { sensitivity: "base" });
}

function normalizeFsPath(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
