import * as fs from "fs/promises";

import * as vscode from "vscode";

import { Database } from "sql.js";

import { DbAdapter, TableInfo } from "../DbAdapter";
import { loadSqlJs } from "./sqliteLoader";

export class SqlScriptAdapter implements DbAdapter {
  public readonly id: string;
  public readonly label: string;

  private db!: Database;

  private constructor(private filePath: string) {
    this.id = filePath;
    this.label = filePath.split(/[\\/]/).pop() ?? filePath;
  }

  static async create(context: vscode.ExtensionContext, filePath: string) {
    const adapter = new SqlScriptAdapter(filePath);
    const SQL = await loadSqlJs(context);
    const script = await fs.readFile(filePath, "utf8");

    adapter.db = new SQL.Database();

    const trimmed = script.trim();
    if (trimmed) {
      try {
        adapter.db.exec(trimmed);
      } catch (error: any) {
        adapter.db.close();
        throw new Error(
          `Não foi possível interpretar '${adapter.label}' como script SQL compatível com SQLite: ${error?.message ?? String(error)}`
        );
      }
    }

    return adapter;
  }

  async listTables(): Promise<string[]> {
    const res = this.db.exec(`
      SELECT name
      FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name;
    `);
    const rows = (res[0]?.values ?? []) as any[][];
    return rows.map((row: any[]) => String(row[0]));
  }

  async getTableInfo(table: string): Promise<TableInfo> {
    const cols = (this.db.exec(`PRAGMA table_info(${escapeIdent(table)});`)[0]?.values ?? []) as any[][];
    const foreign = (this.db.exec(`PRAGMA foreign_key_list(${escapeIdent(table)});`)[0]?.values ?? []) as any[][];

    return {
      name: table,
      columns: cols.map((value: any[]) => ({
        name: String(value[1]),
        type: String(value[2] ?? ""),
        notnull: Boolean(value[3]),
        dflt: value[4],
        pk: Number(value[5]) > 0
      })),
      foreignKeys: foreign.map((value: any[]) => ({
        table: String(value[2]),
        from: String(value[3]),
        to: String(value[4]),
        onUpdate: String(value[5]),
        onDelete: String(value[6])
      }))
    };
  }

  async select(table: string, opts?: { limit?: number; offset?: number; orderBy?: string }) {
    const limit = opts?.limit ?? 200;
    const offset = opts?.offset ?? 0;
    const orderBy = opts?.orderBy ? `ORDER BY ${opts.orderBy}` : "";

    const sql = `SELECT rowid as __rowid__, * FROM ${escapeIdent(table)} ${orderBy} LIMIT ${limit} OFFSET ${offset};`;
    const res = this.db.exec(sql)[0];

    return {
      columns: res?.columns ?? [],
      rows: (res?.values as any[][]) ?? []
    };
  }

  async execute(sql: string, params?: any[]) {
    if (!params?.length) {
      const res = this.db.exec(sql);
      if (res.length) {
        return { columns: res[0].columns, rows: res[0].values as any[][] };
      }
      return { changes: this.getRowsModified() };
    }

    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: any[][] = [];
      const columns = stmt.getColumnNames();

      while (stmt.step()) {
        rows.push(stmt.get() as any[]);
      }

      return columns.length ? { columns, rows } : { changes: this.getRowsModified() };
    } finally {
      stmt.free();
    }
  }

  async updateByRowId(table: string, rowid: number, patch: Record<string, any>) {
    const keys = Object.keys(patch);
    if (!keys.length) return;

    const set = keys.map(key => `${escapeIdent(key)} = ?`).join(", ");
    const sql = `UPDATE ${escapeIdent(table)} SET ${set} WHERE rowid = ?;`;
    const params = [...keys.map(key => patch[key]), rowid];

    await this.execute(sql, params);
  }

  async deleteByRowId(table: string, rowid: number) {
    const sql = `DELETE FROM ${escapeIdent(table)} WHERE rowid = ?;`;
    await this.execute(sql, [rowid]);
  }

  async dispose() {
    this.db.close();
  }

  private getRowsModified() {
    const db = this.db as Database & { getRowsModified?: () => number };
    return db.getRowsModified?.() ?? 0;
  }
}

function escapeIdent(name: string) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
