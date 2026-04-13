import * as vscode from "vscode";

import { DbAdapter } from "../../db/DbAdapter";

type NodeKind = "root" | "db" | "tables" | "table";

export class DbExplorerProvider implements vscode.TreeDataProvider<DbNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DbNode | void>();
  onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private adapters: () => DbAdapter[]) {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DbNode): vscode.TreeItem {
    return element.item;
  }

  async getChildren(element?: DbNode): Promise<DbNode[]> {
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
      if (!adapter) return [];

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

export class DbNode {
  constructor(
    public kind: NodeKind,
    public item: vscode.TreeItem,
    public meta?: { adapterId?: string; table?: string }
  ) {}
}
