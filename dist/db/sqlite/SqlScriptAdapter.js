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
exports.SqlScriptAdapter = void 0;
const fs = __importStar(require("fs/promises"));
const sqliteLoader_1 = require("./sqliteLoader");
class SqlScriptAdapter {
    constructor(filePath) {
        this.filePath = filePath;
        this.id = filePath;
        this.label = filePath.split(/[\\/]/).pop() ?? filePath;
    }
    static async create(context, filePath) {
        const adapter = new SqlScriptAdapter(filePath);
        const SQL = await (0, sqliteLoader_1.loadSqlJs)(context);
        const script = await fs.readFile(filePath, "utf8");
        adapter.db = new SQL.Database();
        const trimmed = script.trim();
        if (trimmed) {
            try {
                adapter.db.exec(trimmed);
            }
            catch (error) {
                adapter.db.close();
                throw new Error(`Não foi possível interpretar '${adapter.label}' como script SQL compatível com SQLite: ${error?.message ?? String(error)}`);
            }
        }
        return adapter;
    }
    async listTables() {
        const res = this.db.exec(`
      SELECT name
      FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name;
    `);
        const rows = (res[0]?.values ?? []);
        return rows.map((row) => String(row[0]));
    }
    async getTableInfo(table) {
        const cols = (this.db.exec(`PRAGMA table_info(${escapeIdent(table)});`)[0]?.values ?? []);
        const foreign = (this.db.exec(`PRAGMA foreign_key_list(${escapeIdent(table)});`)[0]?.values ?? []);
        return {
            name: table,
            columns: cols.map((value) => ({
                name: String(value[1]),
                type: String(value[2] ?? ""),
                notnull: Boolean(value[3]),
                dflt: value[4],
                pk: Number(value[5]) > 0
            })),
            foreignKeys: foreign.map((value) => ({
                table: String(value[2]),
                from: String(value[3]),
                to: String(value[4]),
                onUpdate: String(value[5]),
                onDelete: String(value[6])
            }))
        };
    }
    async select(table, opts) {
        const limit = opts?.limit ?? 200;
        const offset = opts?.offset ?? 0;
        const orderBy = opts?.orderBy ? `ORDER BY ${opts.orderBy}` : "";
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
            if (res.length) {
                return { columns: res[0].columns, rows: res[0].values };
            }
            return { changes: this.getRowsModified() };
        }
        const stmt = this.db.prepare(sql);
        try {
            stmt.bind(params);
            const rows = [];
            const columns = stmt.getColumnNames();
            while (stmt.step()) {
                rows.push(stmt.get());
            }
            return columns.length ? { columns, rows } : { changes: this.getRowsModified() };
        }
        finally {
            stmt.free();
        }
    }
    async updateByRowId(table, rowid, patch) {
        const keys = Object.keys(patch);
        if (!keys.length)
            return;
        const set = keys.map(key => `${escapeIdent(key)} = ?`).join(", ");
        const sql = `UPDATE ${escapeIdent(table)} SET ${set} WHERE rowid = ?;`;
        const params = [...keys.map(key => patch[key]), rowid];
        await this.execute(sql, params);
    }
    async deleteByRowId(table, rowid) {
        const sql = `DELETE FROM ${escapeIdent(table)} WHERE rowid = ?;`;
        await this.execute(sql, [rowid]);
    }
    async dispose() {
        this.db.close();
    }
    getRowsModified() {
        const db = this.db;
        return db.getRowsModified?.() ?? 0;
    }
}
exports.SqlScriptAdapter = SqlScriptAdapter;
function escapeIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
}
//# sourceMappingURL=SqlScriptAdapter.js.map