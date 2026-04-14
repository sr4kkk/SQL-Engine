import * as path from "path";
import * as vscode from "vscode";

import { DbAdapter } from "./db/DbAdapter";
import { createAdapterForFile } from "./db/sqlite/createAdapterForFile";
import { DbExplorerProvider, DbNode } from "./views/explorer/DbExplorerProvider";
import { SqliteEditorProvider } from "./views/webview/sqliteEditorProvider";
import { DbPanel } from "./views/webview/panel";

const adapters = new Map<string, DbAdapter>();
const pendingAutoOpen = new Set<string>();
const SUPPORTED_EXTENSIONS = new Set([".sqlite", ".db", ".sqlite3", ".sql"]);

export function activate(context: vscode.ExtensionContext) {
  const explorer = new DbExplorerProvider(context);
  context.subscriptions.push(explorer);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("dbViewer.explorer", explorer)
  );

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
    vscode.commands.registerCommand("dbViewer.openFile", async () => {
      const targetUri = await pickFile();
      if (!targetUri) {
        return;
      }

      await explorer.addFile(targetUri);
      await ensureOpenedInSqlEngine(context, explorer, targetUri, { revealEditor: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dbViewer.openFolder", async () => {
      const targetUri = await pickFolder();
      if (!targetUri) {
        return;
      }

      await explorer.addFolder(targetUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dbViewer.removeExplorerRoot", async (node?: DbNode) => {
      if (!node) {
        return;
      }

      await explorer.removeRoot(node.uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dbViewer.openSqlite", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? await pickFile();
      if (!targetUri) {
        return;
      }

      await explorer.ensureFileVisible(targetUri);
      await ensureOpenedInSqlEngine(context, explorer, targetUri, { revealEditor: true });
    })
  );

  const tryAutoOpen = async (uri?: vscode.Uri) => {
    if (!uri || uri.scheme !== "file" || !shouldAutoOpen(uri)) {
      return;
    }

    if (isSqlEngineEditorOpen(uri)) {
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
      const adapter = adapters.get(adapterId);
      if (!adapter) {
        vscode.window.showErrorMessage("Adapter não encontrado. Abra o arquivo no SQL Engine primeiro.");
        return;
      }

      DbPanel.open(adapter, table);
    })
  );

  context.subscriptions.push({
    dispose: () => {
      for (const adapter of adapters.values()) {
        void adapter.dispose();
      }
      adapters.clear();
    }
  });
}

export function deactivate() {}

function shouldAutoOpen(uri: vscode.Uri) {
  return path.extname(uri.fsPath).toLowerCase() === ".sql";
}

async function ensureOpenedInSqlEngine(
  context: vscode.ExtensionContext,
  explorer: DbExplorerProvider,
  uri: vscode.Uri,
  options?: { revealEditor?: boolean; automatic?: boolean }
) {
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
      const adapter = await createAdapterForFile(context, uri);
      adapters.set(uri.fsPath, adapter);

      if (!options?.automatic) {
        vscode.window.showInformationMessage(`Opened: ${adapter.label}`);
      }
    }

    if (options?.revealEditor && !isSqlEngineEditorOpen(uri)) {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        SqliteEditorProvider.viewType,
        { preview: false }
      );
    }
  } finally {
    pendingAutoOpen.delete(key);
  }
}

function isSqlEngineEditorOpen(uri: vscode.Uri) {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputCustom &&
        input.viewType === SqliteEditorProvider.viewType &&
        input.uri.toString() === uri.toString()
      ) {
        return true;
      }
    }
  }

  return false;
}

function isSupportedFile(uri: vscode.Uri) {
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
