import * as vscode from "vscode";

import { DbAdapter } from "./db/DbAdapter";
import { DbExplorerProvider } from "./views/explorer/DbExplorerProvider";
import { DbPanel } from "./views/webview/panel";
import { SQLiteAdapter } from "./db/sqlite/SQLiteAdapter";
import { SqliteEditorProvider } from "./views/webview/sqliteEditorProvider";

const adapters: DbAdapter[] = [];

export function activate(context: vscode.ExtensionContext) {
  // Tree Explorer
  const explorer = new DbExplorerProvider(() => adapters);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("dbViewer.explorer", explorer)
  );

  // Custom editor (clicar no .db/.sqlite)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SqliteEditorProvider.viewType,
      new SqliteEditorProvider(context),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dbViewer.refreshExplorer", () => explorer.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dbViewer.openSqlite", async (uri?: vscode.Uri) => {
      const file = uri?.fsPath ?? (await pickFile(["sqlite", "db", "sqlite3"]));
      if (!file) return;

      // evita abrir duplicado
      if (adapters.some(a => a.id === file)) {
        vscode.window.showInformationMessage("Esse arquivo já está aberto no DB Viewer.");
        return;
      }

      const adapter = await SQLiteAdapter.create(context, file);
      adapters.push(adapter);
      explorer.refresh();
      vscode.window.showInformationMessage(`Opened: ${adapter.label}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dbViewer.showTable", async (adapterId: string, table: string) => {
      const adapter = adapters.find(a => a.id === adapterId);
      if (!adapter) {
        vscode.window.showErrorMessage("Adapter não encontrado. Abra o arquivo SQLite primeiro.");
        return;
      }
      DbPanel.open(adapter, table);
    })
  );

  // limpeza
  context.subscriptions.push({
    dispose: () => adapters.splice(0).forEach(a => a.dispose())
  });
}

export function deactivate() {}

async function pickFile(exts: string[]) {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Database: exts },
    openLabel: "Open SQLite"
  });
  return picked?.[0]?.fsPath;
}
