import * as path from "path";
import * as vscode from "vscode";

import { DbAdapter } from "./db/DbAdapter";
import { DbExplorerProvider } from "./views/explorer/DbExplorerProvider";
import { DbPanel } from "./views/webview/panel";
import { createAdapterForFile } from "./db/sqlite/createAdapterForFile";
import { SqliteEditorProvider } from "./views/webview/sqliteEditorProvider";

const adapters: DbAdapter[] = [];
const pendingAutoOpen = new Set<string>();

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
      const targetUri = uri ?? await pickFile(["sqlite", "db", "sqlite3", "sql"]);
      if (!targetUri) return;

      await ensureOpenedInSqlEngine(context, explorer, targetUri, { revealEditor: true });
    })
  );

  const tryAutoOpen = async (uri?: vscode.Uri) => {
    if (!uri || uri.scheme !== "file" || !shouldAutoOpen(uri)) {
      return;
    }

    await ensureOpenedInSqlEngine(context, explorer, uri, { revealEditor: true, automatic: true });
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void tryAutoOpen(document.uri);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void tryAutoOpen(editor?.document.uri);
    })
  );

  void tryAutoOpen(vscode.window.activeTextEditor?.document.uri);

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

function shouldAutoOpen(uri: vscode.Uri) {
  const ext = path.extname(uri.fsPath).toLowerCase();
  return ext === ".sql" || ext === ".db";
}

async function ensureOpenedInSqlEngine(
  context: vscode.ExtensionContext,
  explorer: DbExplorerProvider,
  uri: vscode.Uri,
  options?: { revealEditor?: boolean; automatic?: boolean }
) {
  const key = uri.toString();
  if (pendingAutoOpen.has(key)) {
    return;
  }

  pendingAutoOpen.add(key);
  try {
    const alreadyOpen = adapters.some(adapter => adapter.id === uri.fsPath);
    if (!alreadyOpen) {
      const adapter = await createAdapterForFile(context, uri);
      adapters.push(adapter);
      explorer.refresh();

      if (!options?.automatic) {
        vscode.window.showInformationMessage(`Opened: ${adapter.label}`);
      }
    }

    if (options?.revealEditor) {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        SqliteEditorProvider.viewType,
        vscode.ViewColumn.Active
      );
    }
  } finally {
    pendingAutoOpen.delete(key);
  }
}

async function pickFile(exts: string[]) {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Database: exts },
    openLabel: "Open SQL Engine"
  });
  return picked?.[0];
}
