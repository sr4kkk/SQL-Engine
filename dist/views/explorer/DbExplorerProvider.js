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
const vscode = __importStar(require("vscode"));
class DbExplorerProvider {
    constructor(adapters) {
        this.adapters = adapters;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element.item;
    }
    async getChildren(element) {
        if (!element) {
            const item = new vscode.TreeItem("SQLite Files", vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = "dbViewer.root";
            return [new DbNode("root", item)];
        }
        if (element.kind === "root") {
            return this.adapters().map(a => {
                const item = new vscode.TreeItem(a.label, vscode.TreeItemCollapsibleState.Collapsed);
                item.description = a.id;
                item.contextValue = "dbViewer.db";
                return new DbNode("db", item, { adapterId: a.id });
            });
        }
        if (element.kind === "db") {
            const item = new vscode.TreeItem("Tables", vscode.TreeItemCollapsibleState.Collapsed);
            item.contextValue = "dbViewer.tables";
            return [new DbNode("tables", item, element.meta)];
        }
        if (element.kind === "tables") {
            const adapter = this.adapters().find(a => a.id === element.meta?.adapterId);
            if (!adapter)
                return [];
            const tables = await adapter.listTables();
            return tables.map(t => {
                const item = new vscode.TreeItem(t, vscode.TreeItemCollapsibleState.None);
                item.command = { command: "dbViewer.showTable", title: "Show Table", arguments: [adapter.id, t] };
                item.contextValue = "dbViewer.table";
                return new DbNode("table", item, { ...element.meta, table: t });
            });
        }
        return [];
    }
}
exports.DbExplorerProvider = DbExplorerProvider;
class DbNode {
    constructor(kind, item, meta) {
        this.kind = kind;
        this.item = item;
        this.meta = meta;
    }
}
exports.DbNode = DbNode;
//# sourceMappingURL=DbExplorerProvider.js.map