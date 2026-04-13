import * as vscode from "vscode";

import { DbAdapter, TableInfo } from "../DbAdapter";
import { openSqliteFile, saveSqliteFile } from "./sqliteLoader";

import { Database } from "sql.js";

export class SQLiteAdapter implements DbAdapter {
  public readonly id: string;
  public readonly label: string;

  private db!: Database;
  private dirty = false;

  private constructor(private context: vscode.ExtensionContext, private filePath: string) {
    this.id = filePath;
    this.label = filePath.split(/[\\/]/).pop() ?? filePath;
  }

  static async create(context: vscode.ExtensionContext, filePath: string) {
    const a = new SQLiteAdapter(context, filePath);
    a.db = await openSqliteFile(context, filePath);
    return a;
  }

  async listTables(): Promise<string[]> {
    const res = this.db.exec(`
      SELECT name
      FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name;
    `);
    const rows = (res[0]?.values ?? []) as any[][];
    return rows.map((r: any[]) => String(r[0]));
  }

  async getTableInfo(table: string): Promise<TableInfo> {
    const cols = (this.db.exec(`PRAGMA table_info(${escapeIdent(table)});`)[0]?.values ?? []) as any[][];
    const foreign = (this.db.exec(`PRAGMA foreign_key_list(${escapeIdent(table)});`)[0]?.values ?? []) as any[][];

    return {
      name: table,
      columns: cols.map((v: any[]) => ({
        name: String(v[1]),
        type: String(v[2] ?? ""),
        notnull: Boolean(v[3]),
        dflt: v[4],
        pk: Number(v[5]) > 0
      })),
      foreignKeys: foreign.map((v: any[]) => ({
        table: String(v[2]),
        from: String(v[3]),
        to: String(v[4]),
        onUpdate: String(v[5]),
        onDelete: String(v[6])
      }))
    };
  }

  async select(table: string, opts?: { limit?: number; offset?: number; orderBy?: string }) {
    const limit = opts?.limit ?? 200;
    const offset = opts?.offset ?? 0;
    const orderBy = opts?.orderBy ? `ORDER BY ${opts.orderBy}` : "";

    // inclui rowid pra editar/deletar fácil
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
      if (res.length) return { columns: res[0].columns, rows: res[0].values as any[][] };
      this.markDirtyIfWrite(sql);
      if (this.dirty) await this.flush();
      return { changes: this.dirty ? 1 : 0 };
    }

    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: any[][] = [];
      const columns = stmt.getColumnNames();

      while (stmt.step()) rows.push(stmt.get() as any[]);

      this.markDirtyIfWrite(sql);
      if (this.dirty) await this.flush();

      return columns.length ? { columns, rows } : { changes: this.dirty ? 1 : 0 };
    } finally {
      stmt.free();
    }
  }

  async updateByRowId(table: string, rowid: number, patch: Record<string, any>) {
    const keys = Object.keys(patch);
    if (!keys.length) return;

    const set = keys.map(k => `${escapeIdent(k)} = ?`).join(", ");
    const sql = `UPDATE ${escapeIdent(table)} SET ${set} WHERE rowid = ?;`;
    const params = [...keys.map(k => patch[k]), rowid];

    await this.execute(sql, params);
    this.dirty = true;
    await this.flush();
  }

  async deleteByRowId(table: string, rowid: number) {
    const sql = `DELETE FROM ${escapeIdent(table)} WHERE rowid = ?;`;
    await this.execute(sql, [rowid]);
    this.dirty = true;
    await this.flush();
  }

  async dispose() {
    await this.flush();
    this.db.close();
  }

  private async flush() {
    if (!this.dirty) return;
    await saveSqliteFile(this.db, this.filePath);
    this.dirty = false;
  }

  private markDirtyIfWrite(sql: string) {
    if (/\b(insert|update|delete|create|drop|alter|replace)\b/i.test(sql)) this.dirty = true;
  }
}

function escapeIdent(name: string) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
