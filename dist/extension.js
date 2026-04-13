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
const vscode = __importStar(require("vscode"));
const DbExplorerProvider_1 = require("./views/explorer/DbExplorerProvider");
const panel_1 = require("./views/webview/panel");
const SQLiteAdapter_1 = require("./db/sqlite/SQLiteAdapter");
const sqliteEditorProvider_1 = require("./views/webview/sqliteEditorProvider");
const adapters = [];
function activate(context) {
    // Tree Explorer
    const explorer = new DbExplorerProvider_1.DbExplorerProvider(() => adapters);
    context.subscriptions.push(vscode.window.registerTreeDataProvider("dbViewer.explorer", explorer));
    // Custom editor (clicar no .db/.sqlite)
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(sqliteEditorProvider_1.SqliteEditorProvider.viewType, new sqliteEditorProvider_1.SqliteEditorProvider(context), { webviewOptions: { retainContextWhenHidden: true } }));
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.refreshExplorer", () => explorer.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.openSqlite", async (uri) => {
        const file = uri?.fsPath ?? (await pickFile(["sqlite", "db", "sqlite3"]));
        if (!file)
            return;
        // evita abrir duplicado
        if (adapters.some(a => a.id === file)) {
            vscode.window.showInformationMessage("Esse arquivo já está aberto no DB Viewer.");
            return;
        }
        const adapter = await SQLiteAdapter_1.SQLiteAdapter.create(context, file);
        adapters.push(adapter);
        explorer.refresh();
        vscode.window.showInformationMessage(`Opened: ${adapter.label}`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("dbViewer.showTable", async (adapterId, table) => {
        const adapter = adapters.find(a => a.id === adapterId);
        if (!adapter) {
            vscode.window.showErrorMessage("Adapter não encontrado. Abra o arquivo SQLite primeiro.");
            return;
        }
        panel_1.DbPanel.open(adapter, table);
    }));
    // limpeza
    context.subscriptions.push({
        dispose: () => adapters.splice(0).forEach(a => a.dispose())
    });
}
function deactivate() { }
async function pickFile(exts) {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Database: exts },
        openLabel: "Open SQLite"
    });
    return picked?.[0]?.fsPath;
}
//# sourceMappingURL=extension.js.map