"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQLiteAdapter = void 0;
const sqliteLoader_1 = require("./sqliteLoader");
class SQLiteAdapter {
    constructor(context, filePath) {
        this.context = context;
        this.filePath = filePath;
        this.dirty = false;
        this.id = filePath;
        this.label = filePath.split(/[\\/]/).pop() ?? filePath;
    }
    static async create(context, filePath) {
        const a = new SQLiteAdapter(context, filePath);
        a.db = await (0, sqliteLoader_1.openSqliteFile)(context, filePath);
        return a;
    }
    async listTables() {
        const res = this.db.exec(`
      SELECT name
      FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name;
    `);
        const rows = (res[0]?.values ?? []);
        return rows.map((r) => String(r[0]));
    }
    async getTableInfo(table) {
        const cols = (this.db.exec(`PRAGMA table_info(${escapeIdent(table)});`)[0]?.values ?? []);
        const foreign = (this.db.exec(`PRAGMA foreign_key_list(${escapeIdent(table)});`)[0]?.values ?? []);
        return {
            name: table,
            columns: cols.map((v) => ({
                name: String(v[1]),
                type: String(v[2] ?? ""),
                notnull: Boolean(v[3]),
                dflt: v[4],
                pk: Number(v[5]) > 0
            })),
            foreignKeys: foreign.map((v) => ({
                table: String(v[2]),
                from: String(v[3]),
                to: String(v[4]),
                onUpdate: String(v[5]),
                onDelete: String(v[6])
            }))
        };
    }
    async select(table, opts) {
        const limit = opts?.limit ?? 200;
        const offset = opts?.offset ?? 0;
        const orderBy = opts?.orderBy ? `ORDER BY ${opts.orderBy}` : "";
        // inclui rowid pra editar/deletar fácil
        const sql = `SELECT rowid as __rowid__, * FROM ${escapeIdent(table)} ${orderBy} LIMIT ${limit} OFFSET ${offset};`;
        const res = this.db.exec(sql)[0];
        return {
            columns: res?.columns ?? [],
            rows: res?.values ?? []
        };
    }
    async execute(sql, params) {
        if (!params?.length) {
            const res = this.db.exec(sql);
            if (res.length)
                return { columns: res[0].columns, rows: res[0].values };
            this.markDirtyIfWrite(sql);
            if (this.dirty)
                await this.flush();
            return { changes: this.dirty ? 1 : 0 };
        }
        const stmt = this.db.prepare(sql);
        try {
            stmt.bind(params);
            const rows = [];
            const columns = stmt.getColumnNames();
            while (stmt.step())
                rows.push(stmt.get());
            this.markDirtyIfWrite(sql);
            if (this.dirty)
                await this.flush();
            return columns.length ? { columns, rows } : { changes: this.dirty ? 1 : 0 };
        }
        finally {
            stmt.free();
        }
    }
    async updateByRowId(table, rowid, patch) {
        const keys = Object.keys(patch);
        if (!keys.length)
            return;
        const set = keys.map(k => `${escapeIdent(k)} = ?`).join(", ");
        const sql = `UPDATE ${escapeIdent(table)} SET ${set} WHERE rowid = ?;`;
        const params = [...keys.map(k => patch[k]), rowid];
        await this.execute(sql, params);
        this.dirty = true;
        await this.flush();
    }
    async deleteByRowId(table, rowid) {
        const sql = `DELETE FROM ${escapeIdent(table)} WHERE rowid = ?;`;
        await this.execute(sql, [rowid]);
        this.dirty = true;
        await this.flush();
    }
    async dispose() {
        await this.flush();
        this.db.close();
    }
    async flush() {
        if (!this.dirty)
            return;
        await (0, sqliteLoader_1.saveSqliteFile)(this.db, this.filePath);
        this.dirty = false;
    }
    markDirtyIfWrite(sql) {
        if (/\b(insert|update|delete|create|drop|alter|replace)\b/i.test(sql))
            this.dirty = true;
    }
}
exports.SQLiteAdapter = SQLiteAdapter;
function escapeIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
}
//# sourceMappingURL=SQLiteAdapter.js.map