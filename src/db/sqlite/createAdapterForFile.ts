import * as path from "path";
import * as vscode from "vscode";

import { DbAdapter } from "../DbAdapter";
import { SQLiteAdapter } from "./SQLiteAdapter";
import { SqlScriptAdapter } from "./SqlScriptAdapter";

export async function createAdapterForFile(
  context: vscode.ExtensionContext,
  uri: vscode.Uri
): Promise<DbAdapter> {
  const ext = path.extname(uri.fsPath).toLowerCase();

  if (ext === ".sql") {
    return SqlScriptAdapter.create(context, uri.fsPath);
  }

  return SQLiteAdapter.create(context, uri.fsPath);
}
