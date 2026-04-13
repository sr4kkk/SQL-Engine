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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSqlJs = loadSqlJs;
exports.openSqliteFile = openSqliteFile;
exports.saveSqliteFile = saveSqliteFile;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const sql_js_1 = __importDefault(require("sql.js"));
let SQL = null;
async function loadSqlJs(context) {
    if (SQL)
        return SQL;
    SQL = await (0, sql_js_1.default)({
        locateFile: (file) => {
            // garante que o VS Code encontre o sql-wasm.wasm
            return context.asAbsolutePath(path.join("node_modules", "sql.js", "dist", file));
        }
    });
    return SQL;
}
async function openSqliteFile(context, filePath) {
    const SQL = await loadSqlJs(context);
    const buf = await fs.readFile(filePath);
    return new SQL.Database(new Uint8Array(buf));
}
async function saveSqliteFile(db, filePath) {
    const data = db.export(); // Uint8Array
    await fs.writeFile(filePath, Buffer.from(data));
}
//# sourceMappingURL=sqliteLoader.js.map