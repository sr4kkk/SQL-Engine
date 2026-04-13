import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import initSqlJs, { Database, SqlJsStatic } from "sql.js";

let SQL: SqlJsStatic | null = null;

export async function loadSqlJs(context: vscode.ExtensionContext) {
  if (SQL) return SQL;

  SQL = await initSqlJs({
    locateFile: (file: string) => {
      // garante que o VS Code encontre o sql-wasm.wasm
      return context.asAbsolutePath(path.join("node_modules", "sql.js", "dist", file));
    }
  });

  return SQL;
}

export async function openSqliteFile(context: vscode.ExtensionContext, filePath: string): Promise<Database> {
  const SQL = await loadSqlJs(context);
  const buf = await fs.readFile(filePath);
  return new SQL.Database(new Uint8Array(buf));
}

export async function saveSqliteFile(db: Database, filePath: string) {
  const data = db.export(); // Uint8Array
  await fs.writeFile(filePath, Buffer.from(data));
}
