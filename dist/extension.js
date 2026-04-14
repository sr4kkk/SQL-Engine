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
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const createAdapterForFile_1 = require("./db/sqlite/createAdapterForFile");
const DbExplorerProvider_1 = require("./views/explorer/DbExplorerProvider");
const sqliteEditorProvider_1 = require("./views/webview/sqliteEditorProvider");
const panel_1 = require("./views/webview/panel");
const adapters = new Map();
const pendingAutoOpen = new Set();
const SUPPORTED_EXTENSIONS = new Set([".sqlite", ".db", ".sqlite3", ".sql"]);
function activate(context) {
    const explorer = new DbExplorerProvider_1.DbExplorerProvider(context);
    context.subscriptions.push(explorer);
    context.subscriptions.push(vscode.window.registerTreeDataProvider("dbViewer.explorer", explorer));
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(sqliteEditorProvider_1.SqliteEditorProvider.viewType, new sqliteEditorProvider_1.SqliteEditorProvider(context), { webviewOptions: { retainContextWhenHidden: true } }));
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.refreshExplorer", () => explorer.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.openFile", async () => {
        const targetUri = await pickFile();
        if (!targetUri) {
            return;
        }
        await explorer.addFile(targetUri);
        await ensureOpenedInSqlEngine(context, explorer, targetUri, { revealEditor: true });
    }));
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.openFolder", async () => {
        const targetUri = await pickFolder();
        if (!targetUri) {
            return;
        }
        await explorer.addFolder(targetUri);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.removeExplorerRoot", async (node) => {
        if (!node) {
            return;
        }
        await explorer.removeRoot(node.uri);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.openSqlite", async (uri) => {
        const targetUri = uri ?? await pickFile();
        if (!targetUri) {
            return;
        }
        await explorer.ensureFileVisible(targetUri);
        await ensureOpenedInSqlEngine(context, explorer, targetUri, { revealEditor: true });
    }));
    const tryAutoOpen = async (uri) => {
        if (!uri || uri.scheme !== "file" || !shouldAutoOpen(uri)) {
            return;
        }
        if (isSqlEngineEditorOpen(uri)) {
            return;
        }
        await ensureOpenedInSqlEngine(context, explorer, uri, { revealEditor: true, automatic: true });
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        void tryAutoOpen(document.uri);
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        void tryAutoOpen(editor?.document.uri);
    }));
    void tryAutoOpen(vscode.window.activeTextEditor?.document.uri);
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.showTable", async (adapterId, table) => {
        const adapter = adapters.get(adapterId);
        if (!adapter) {
            vscode.window.showErrorMessage("Adapter não encontrado. Abra o arquivo no SQL Engine primeiro.");
            return;
        }
        panel_1.DbPanel.open(adapter, table);
    }));
    context.subscriptions.push({
        dispose: () => {
            for (const adapter of adapters.values()) {
                void adapter.dispose();
            }
            adapters.clear();
        }
    });
}
function deactivate() { }
function shouldAutoOpen(uri) {
    return path.extname(uri.fsPath).toLowerCase() === ".sql";
}
async function ensureOpenedInSqlEngine(context, explorer, uri, options) {
    if (!isSupportedFile(uri)) {
        throw new Error("Arquivo não suportado pelo SQL Engine.");
    }
    const key = uri.toString();
    if (pendingAutoOpen.has(key)) {
        return;
    }
    pendingAutoOpen.add(key);
    try {
        await explorer.ensureFileVisible(uri);
        if (!adapters.has(uri.fsPath)) {
            const adapter = await (0, createAdapterForFile_1.createAdapterForFile)(context, uri);
            adapters.set(uri.fsPath, adapter);
            if (!options?.automatic) {
                vscode.window.showInformationMessage(`Opened: ${adapter.label}`);
            }
        }
        if (options?.revealEditor && !isSqlEngineEditorOpen(uri)) {
            await vscode.commands.executeCommand("vscode.openWith", uri, sqliteEditorProvider_1.SqliteEditorProvider.viewType, { preview: false });
        }
    }
    finally {
        pendingAutoOpen.delete(key);
    }
}
function isSqlEngineEditorOpen(uri) {
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input;
            if (input instanceof vscode.TabInputCustom &&
                input.viewType === sqliteEditorProvider_1.SqliteEditorProvider.viewType &&
                input.uri.toString() === uri.toString()) {
                return true;
            }
        }
    }
    return false;
}
function isSupportedFile(uri) {
    return SUPPORTED_EXTENSIONS.has(path.extname(uri.fsPath).toLowerCase());
}
async function pickFile() {
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            "SQL Engine": ["sqlite", "db", "sqlite3", "sql"]
        },
        openLabel: "Open SQL Engine"
    });
    return picked?.[0];
}
async function pickFolder() {
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Folder"
    });
    return picked?.[0];
}
//# sourceMappingURL=extension.js.map