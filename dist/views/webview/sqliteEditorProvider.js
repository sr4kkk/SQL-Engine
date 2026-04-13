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
exports.SqliteEditorProvider = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const SQLiteAdapter_1 = require("../../db/sqlite/SQLiteAdapter");
class SqliteEditorProvider {
    constructor(context) {
        this.context = context;
        this.stateByDoc = new Map();
    }
    async openCustomDocument(uri) {
        const key = uri.toString();
        if (!this.stateByDoc.has(key)) {
            const adapter = await SQLiteAdapter_1.SQLiteAdapter.create(this.context, uri.fsPath);
            this.stateByDoc.set(key, {
                adapter,
                currentTable: null,
                limit: 100,
                offset: 0,
                rowCount: null,
                tableInfo: null
            });
        }
        return {
            uri,
            dispose: async () => {
                const st = this.stateByDoc.get(key);
                if (st) {
                    await st.adapter.dispose();
                    this.stateByDoc.delete(key);
                }
            }
        };
    }
    async resolveCustomEditor(document, webviewPanel) {
        const st = this.stateByDoc.get(document.uri.toString());
        if (!st)
            return;
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this.html(st.adapter.label);
        const post = (msg) => webviewPanel.webview.postMessage(msg);
        // AUTO-REFRESH: atualiza quando o arquivo .sqlite (ou WAL/SHM) mudar
        const dbPath = document.uri.fsPath;
        const sidecars = [dbPath, dbPath + "-wal", dbPath + "-shm"];
        let autoRefreshTimer;
        let autoRefreshRunning = false;
        const scheduleAutoRefresh = () => {
            // evita spammar refresh quando chegam vários eventos juntos
            if (autoRefreshTimer)
                clearTimeout(autoRefreshTimer);
            autoRefreshTimer = setTimeout(async () => {
                if (autoRefreshRunning)
                    return;
                autoRefreshRunning = true;
                try {
                    // atualiza lista de tabelas (caso criem/excluam)
                    await sendTables();
                    // atualiza tabela atual (caso tenham inserido/alterado linhas)
                    if (st.currentTable) {
                        st.rowCount = await this.getRowCount(st.adapter, st.currentTable);
                        try {
                            st.tableInfo = await st.adapter.getTableInfo(st.currentTable);
                        }
                        catch {
                            // ignora (ex.: tabela removida)
                        }
                        await refreshData();
                    }
                    post({ type: "autoRefreshed" });
                }
                catch (e) {
                    // não quebra o editor por erro de refresh
                    post({ type: "error", message: e?.message ?? String(e) });
                }
                finally {
                    autoRefreshRunning = false;
                }
            }, 400);
        };
        const computeSignature = async () => {
            const parts = [];
            for (const f of sidecars) {
                try {
                    const stt = await fs.promises.stat(f);
                    parts.push(`${path.basename(f)}:${stt.size}:${stt.mtimeMs}`);
                }
                catch {
                    // arquivo pode não existir (ex.: -wal)
                    parts.push(`${path.basename(f)}:missing`);
                }
            }
            return parts.join("|");
        };
        let lastSig = await computeSignature();
        // Polling (robusto em Windows/WAL): detecta mudanças a cada ~1.5s
        const poll = setInterval(async () => {
            try {
                const sig = await computeSignature();
                if (sig !== lastSig) {
                    lastSig = sig;
                    scheduleAutoRefresh();
                }
            }
            catch {
                // ignora
            }
        }, 1500);
        // fs.watch (instantâneo quando funciona)
        const watchers = [];
        for (const f of sidecars) {
            try {
                const w = fs.watch(f, { persistent: false }, () => scheduleAutoRefresh());
                watchers.push(w);
            }
            catch {
                // alguns OS não permitem watch em arquivo que ainda não existe
            }
        }
        webviewPanel.onDidChangeViewState(() => {
            if (webviewPanel.visible)
                scheduleAutoRefresh();
        });
        webviewPanel.onDidDispose(() => {
            try {
                clearInterval(poll);
            }
            catch { }
            try {
                if (autoRefreshTimer)
                    clearTimeout(autoRefreshTimer);
            }
            catch { }
            for (const w of watchers) {
                try {
                    w.close();
                }
                catch { }
            }
        });
        const sendTables = async () => {
            const tables = await st.adapter.listTables();
            post({ type: "tables", tables });
        };
        const loadTable = async (table) => {
            st.currentTable = table;
            st.offset = 0;
            // row count
            st.rowCount = await this.getRowCount(st.adapter, table);
            // schema
            st.tableInfo = await st.adapter.getTableInfo(table);
            // data
            const data = await st.adapter.select(table, { limit: st.limit, offset: st.offset });
            post({
                type: "tableLoaded",
                table,
                info: st.tableInfo,
                columns: data.columns,
                rows: data.rows,
                paging: {
                    limit: st.limit,
                    offset: st.offset,
                    rowCount: st.rowCount
                }
            });
        };
        const refreshData = async () => {
            if (!st.currentTable)
                return;
            // clamp offset to rowCount
            if (typeof st.rowCount === "number") {
                const maxOffset = Math.max(0, st.rowCount - (st.rowCount % st.limit || st.limit));
                st.offset = Math.min(st.offset, maxOffset);
            }
            const data = await st.adapter.select(st.currentTable, { limit: st.limit, offset: st.offset });
            post({
                type: "tableDataRefresh",
                table: st.currentTable,
                columns: data.columns,
                rows: data.rows,
                paging: {
                    limit: st.limit,
                    offset: st.offset,
                    rowCount: st.rowCount
                }
            });
        };
        const dropTable = async (table) => {
            // proteção básica contra aspas
            const safe = `"${table.replace(/"/g, '""')}"`;
            try {
                await st.adapter.execute(`DROP TABLE ${safe};`);
            }
            catch (e) {
                // fallback: se der problema com foreign_keys, tenta desligar durante o DROP
                const msg = String(e?.message ?? e ?? "");
                if (/foreign key constraint/i.test(msg)) {
                    await st.adapter.execute("PRAGMA foreign_keys=OFF;");
                    await st.adapter.execute(`DROP TABLE ${safe};`);
                    await st.adapter.execute("PRAGMA foreign_keys=ON;");
                }
                else {
                    throw e;
                }
            }
            // limpa estado
            st.currentTable = null;
            st.offset = 0;
            st.rowCount = null;
            st.tableInfo = null;
            post({ type: "tableDeleted", table });
            // atualiza lista de tabelas
            const tables = await st.adapter.listTables();
            post({ type: "tables", tables });
        };
        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            try {
                if (msg.type === "init") {
                    await sendTables();
                    return;
                }
                if (msg.type === "openTable") {
                    await loadTable(String(msg.table));
                    return;
                }
                if (msg.type === "setPageSize") {
                    const n = Number(msg.limit);
                    if (![50, 100, 200, 500].includes(n))
                        return;
                    st.limit = n;
                    st.offset = 0;
                    await refreshData();
                    return;
                }
                if (msg.type === "paginate") {
                    if (!st.currentTable)
                        return;
                    const dir = String(msg.dir); // "prev" | "next" | "first" | "last"
                    if (dir === "prev")
                        st.offset = Math.max(0, st.offset - st.limit);
                    if (dir === "next")
                        st.offset = st.offset + st.limit;
                    if (dir === "first")
                        st.offset = 0;
                    if (dir === "last") {
                        if (typeof st.rowCount === "number") {
                            // last page offset
                            const lastPage = Math.max(0, Math.ceil(st.rowCount / st.limit) - 1);
                            st.offset = lastPage * st.limit;
                        }
                    }
                    await refreshData();
                    return;
                }
                if (msg.type === "runQuery") {
                    const sql = String(msg.sql ?? "");
                    const res = await st.adapter.execute(sql);
                    // se query mexeu em dados, recarrega contagem + página atual
                    if (/\b(insert|update|delete|create|drop|alter|replace)\b/i.test(sql) && st.currentTable) {
                        st.rowCount = await this.getRowCount(st.adapter, st.currentTable);
                        await refreshData();
                    }
                    post({ type: "queryResult", ...res });
                    return;
                }
                if (msg.type === "updateCell") {
                    if (!st.currentTable)
                        return;
                    const table = String(msg.table);
                    const rowid = Number(msg.rowid);
                    const column = String(msg.column);
                    const value = msg.value;
                    await st.adapter.updateByRowId(table, rowid, { [column]: value });
                    // mantém mesma página
                    await refreshData();
                    return;
                }
                if (msg.type === "requestDeleteTable") {
                    const table = String(msg.table);
                    const choice = await vscode.window.showWarningMessage(`Tem certeza que deseja EXCLUIR a tabela '${table}'? Isso é DROP TABLE e não tem volta.`, { modal: true }, "Excluir");
                    if (choice === "Excluir") {
                        await dropTable(table);
                    }
                    return;
                }
                if (msg.type === "deleteTable") {
                    const table = String(msg.table);
                    await dropTable(table);
                    return;
                }
                if (msg.type === "deleteRow") {
                    if (!st.currentTable)
                        return;
                    const table = String(msg.table);
                    const rowid = Number(msg.rowid);
                    await st.adapter.deleteByRowId(table, rowid);
                    // atualiza contagem e página
                    st.rowCount = await this.getRowCount(st.adapter, table);
                    await refreshData();
                    return;
                }
            }
            catch (err) {
                post({ type: "error", message: err?.message ?? String(err) });
            }
        });
        // boot
        post({ type: "boot" });
    }
    async getRowCount(adapter, table) {
        try {
            const safe = `"${table.replace(/"/g, '""')}"`;
            const res = await adapter.execute(`SELECT COUNT(*) as c FROM ${safe};`);
            const value = res.rows?.[0]?.[0];
            const n = Number(value);
            return Number.isFinite(n) ? n : null;
        }
        catch {
            return null;
        }
    }
    html(dbLabel) {
        const title = escapeHtml(dbLabel);
        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    :root{
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --card: var(--vscode-sideBar-background);
      --card2: var(--vscode-editorWidget-background);
      --accent: var(--vscode-focusBorder);
      --btnBg: var(--vscode-button-background);
      --btnFg: var(--vscode-button-foreground);
      --btnHover: var(--vscode-button-hoverBackground);
      --inputBg: var(--vscode-input-background);
      --inputFg: var(--vscode-input-foreground);
      --inputBorder: var(--vscode-input-border);
      --err: var(--vscode-errorForeground);
      --shadow: 0 6px 18px rgba(0,0,0,.18);
      --radius: 12px;
      --radiusSm: 10px;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",Arial;
      height: 100vh;
      overflow: hidden;
    }

    .topbar{
      height: 54px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding: 0 14px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(to bottom, rgba(255,255,255,.02), rgba(255,255,255,0));
    }
    .brand{
      display:flex; align-items:center; gap:10px;
      font-weight: 800;
      letter-spacing: .2px;
    }
    .pill{
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      font-size: 12px;
      background: rgba(255,255,255,.02);
      max-width: 50vw;
      overflow:hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .layout{
      height: calc(100vh - 54px);
      display:grid;
      grid-template-columns: 320px 1fr;
    }

    .left{
      border-right: 1px solid var(--border);
      background: var(--card);
      padding: 12px;
      overflow:auto;
    }
    .right{
      padding: 14px;
      overflow:auto;
    }

    .sectionTitle{
      font-size: 13px;
      font-weight: 800;
      margin: 8px 0;
    }

    .search{
      display:flex; gap:8px; align-items:center;
      margin: 8px 0 12px;
    }
    .search input{
      width: 100%;
      padding: 10px 10px;
      border-radius: var(--radiusSm);
      border: 1px solid var(--inputBorder, var(--border));
      background: var(--inputBg);
      color: var(--inputFg);
      outline: none;
    }

    .tableList button{
      width: 100%;
      text-align:left;
      padding: 10px 10px;
      margin: 6px 0;
      border-radius: var(--radiusSm);
      border: 1px solid var(--border);
      background: rgba(255,255,255,.02);
      color: var(--fg);
      cursor: pointer;
      transition: transform .06s ease, border-color .12s ease, background .12s ease;
    }
    .tableList button:hover{ transform: translateY(-1px); border-color: rgba(255,255,255,.18); }
    .tableList button.active{
      border-color: var(--accent);
      box-shadow: 0 0 0 1px rgba(0,0,0,.15);
      background: rgba(255,255,255,.04);
      font-weight: 800;
    }

    .tabs{
      display:flex;
      gap:8px;
      align-items:center;
      margin: 0 0 12px;
    }
    .tab{
      padding: 8px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,.02);
      cursor:pointer;
      font-size: 12px;
      color: var(--muted);
      user-select:none;
    }
    .tab.active{
      color: var(--fg);
      border-color: var(--accent);
      background: rgba(255,255,255,.04);
      font-weight: 800;
    }

    .card{
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card2);
      padding: 12px;
      box-shadow: var(--shadow);
    }

    .row{
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap: wrap;
    }

    .btn{
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid transparent;
      background: var(--btnBg);
      color: var(--btnFg);
      cursor:pointer;
      font-weight: 700;
      transition: background .12s ease, transform .06s ease;
    }
    .btn:hover{ background: var(--btnHover); transform: translateY(-1px); }
    .btn.secondary{
      background: rgba(255,255,255,.02);
      border-color: var(--border);
      color: var(--fg);
    }
    .btn.secondary:hover{ background: rgba(255,255,255,.04); }

    .btn:disabled{
      opacity: .5;
      cursor: not-allowed;
      transform:none;
    }

    .select{
      padding: 9px 10px;
      border-radius: 10px;
      border: 1px solid var(--inputBorder, var(--border));
      background: var(--inputBg);
      color: var(--inputFg);
      outline: none;
    }

    textarea{
      width: 100%;
      height: 120px;
      padding: 10px;
      border-radius: 12px;
      border: 1px solid var(--inputBorder, var(--border));
      background: var(--inputBg);
      color: var(--inputFg);
      outline:none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
      font-size: 12px;
    }

    pre{
      margin: 10px 0 0;
      padding: 10px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(0,0,0,.18);
      overflow:auto;
      max-height: 240px;
      font-size: 12px;
    }

    .muted{ color: var(--muted); font-size: 12px; }
    .title{
      font-size: 18px;
      font-weight: 900;
      margin: 0 0 10px;
    }

    .schemaGrid{
      display:grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .schemaBox{
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px;
      background: rgba(255,255,255,.02);
      font-size: 12px;
      line-height: 1.5;
    }
    .schemaBox b{ font-weight: 900; }

    .gridWrap{
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow:auto;
      max-height: 52vh;
      background: rgba(255,255,255,.02);
    }
    table{
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
    }
    th, td{
      border-bottom: 1px solid rgba(255,255,255,.06);
      padding: 8px;
      white-space: nowrap;
      vertical-align: middle;
    }
    th{
      position: sticky;
      top: 0;
      background: var(--card2);
      z-index: 2;
      text-align:left;
      font-weight: 900;
      border-bottom: 1px solid var(--border);
    }
    tr:hover td{
      background: rgba(255,255,255,.03);
    }
    td input{
      width: 100%;
      padding: 6px 8px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(0,0,0,.12);
      color: var(--fg);
      outline:none;
    }
    td input:focus{
      border-color: var(--accent);
      background: rgba(0,0,0,.18);
    }
    .danger{
      background: rgba(255,0,0,.08);
      border: 1px solid rgba(255,0,0,.18);
      color: var(--fg);
      padding: 6px 10px;
      border-radius: 10px;
      cursor:pointer;
      font-weight: 800;
    }
    .danger:hover{ background: rgba(255,0,0,.12); }

    .error{
      margin-top: 10px;
      padding: 10px;
      border-radius: 12px;
      border: 1px solid rgba(255,0,0,.25);
      background: rgba(255,0,0,.07);
      color: var(--err);
      white-space: pre-wrap;
      font-size: 12px;
    }

    .hidden{ display:none; }

    /* cell edit UX */
    td.selectable{ cursor: default; }
    td.selected{ outline: 2px solid var(--accent); outline-offset: -2px; }
    td.editing{ background: rgba(255,255,255,.05); }
    .cellText{ display:block; max-width: 520px; overflow:hidden; text-overflow: ellipsis; }


.inlineInput{
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--inputBorder, var(--border));
  background: var(--inputBg);
  color: var(--inputFg);
  outline: none;
  min-width: 260px;
}

/* modal editor */
.modal{ position: fixed; inset: 0; z-index: 9999; display: flex; align-items: stretch; justify-content: center; }
.modal.hidden{ display: none; }
.modalBackdrop{ position:absolute; inset:0; background: rgba(0,0,0,.55); }
.modalPanel{
  position: relative;
  margin: 24px;
  width: min(1100px, calc(100% - 48px));
  height: calc(100% - 48px);
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card2);
  box-shadow: var(--shadow);
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
.modalHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: rgba(255,255,255,.02);
}
.modalTitle{ font-weight: 900; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
.modalActions{ display:flex; gap:8px; align-items:center; flex-shrink: 0; }
.modalText{
  flex: 1;
  width: 100%;
  border: none;
  border-radius: 0;
  resize: none;
  padding: 12px;
  background: var(--inputBg);
  color: var(--inputFg);
  outline: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
  font-size: 12px;
  line-height: 1.5;
  tab-size: 2;
}
  </style>
</head>
<body>
  <div class="topbar">
    <div class="brand">DB Viewer</div>
    <div class="pill">Arquivo: <b>${title}</b></div>
  </div>

  <div class="layout">
    <div class="left">
      <div class="sectionTitle">Tabelas</div>
      <div class="search">
        <input id="filter" placeholder="Filtrar tabelas..." />
      </div>
      <div id="tables" class="tableList"></div>
      <div class="muted" style="margin-top:10px" id="leftHint"></div>
    </div>

    <div class="right">
      <div class="tabs">
        <div class="tab active" data-tab="data">Data</div>
        <div class="tab" data-tab="schema">Schema</div>
        <div class="tab" data-tab="query">Query</div>
      </div>

      <div id="empty" class="card">
        <div class="title">Selecione uma tabela</div>
        <div class="muted">As tabelas aparecem na coluna da esquerda. Use o filtro para encontrar mais rápido.</div>
      </div>

      <div id="dataView" class="card hidden">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="title" id="tableTitle"></div>
            <div class="muted" id="pagingText"></div>
          </div>

          <div class="row">
            <button class="btn secondary" id="firstBtn">First</button>
            <button class="btn secondary" id="prevBtn">Prev</button>
            <button class="btn secondary" id="nextBtn">Next</button>
            <button class="btn secondary" id="lastBtn">Last</button>

            <select class="select" id="pageSize">
              <option value="50">50</option>
              <option value="100" selected>100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
            <button class="danger" id="dropTableBtn">Excluir tabela</button>
          </div>
        </div>

        <div style="height: 10px"></div>


<div class="row" style="justify-content: space-between;">
  <div class="row">
    <input id="tableSearch" class="inlineInput" placeholder="Pesquisar nesta tabela (na página atual)..." />
    <button class="btn secondary" id="clearSearchBtn">Limpar</button>
    <div class="muted" id="searchInfo"></div>
  </div>
</div>

<div style="height: 10px"></div>

        <div class="gridWrap">
          <div id="grid"></div>
        </div>
      </div>

      <div id="schemaView" class="card hidden">
        <div class="title">Schema</div>
        <div class="schemaGrid" id="schema"></div>
      </div>

      <div id="queryView" class="card hidden">
        <div class="title">Query</div>
        <div class="muted">Execute qualquer SQL. Se alterar dados, a tabela atual será atualizada.</div>
        <div style="height:10px"></div>
        <textarea id="sql">SELECT 1;</textarea>
        <div style="height:10px"></div>
        <div class="row">
          <button class="btn" id="runBtn">Run</button>
          <div class="muted" id="queryHint"></div>
        </div>
        <pre id="out"></pre>
        <div id="errBox" class="error hidden"></div>
      </div>
    </div>
  </div>


<div id="cellModal" class="modal hidden">
  <div class="modalBackdrop" id="modalBackdrop"></div>
  <div class="modalPanel">
    <div class="modalHeader">
      <div class="modalTitle" id="modalTitle">Editar</div>
      <div class="modalActions">
        <button class="btn secondary" id="modalCancel">Cancelar (Esc)</button>
        <button class="btn" id="modalSave">Salvar (Ctrl+Enter)</button>
      </div>
    </div>
    <textarea id="modalText" class="modalText" spellcheck="false"></textarea>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();

  let allTables = [];
  let currentTable = null;
  let currentInfo = null;
  let paging = { limit: 100, offset: 0, rowCount: null };

  let lastColumns = [];
  let lastRows = [];
  let tableSearchText = "";
  let modalState = null; // { rowid, col, td }

  const elTables = document.getElementById("tables");
  const elFilter = document.getElementById("filter");
  const elLeftHint = document.getElementById("leftHint");

  const tabs = Array.from(document.querySelectorAll(".tab"));
  const empty = document.getElementById("empty");
  const dataView = document.getElementById("dataView");
  const schemaView = document.getElementById("schemaView");
  const queryView = document.getElementById("queryView");

  const tableTitle = document.getElementById("tableTitle");
  const pagingText = document.getElementById("pagingText");
  const grid = document.getElementById("grid");

  const firstBtn = document.getElementById("firstBtn");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const lastBtn = document.getElementById("lastBtn");
  const pageSize = document.getElementById("pageSize");
  const dropTableBtn = document.getElementById("dropTableBtn");

  const tableSearch = document.getElementById("tableSearch");
  const clearSearchBtn = document.getElementById("clearSearchBtn");
  const searchInfo = document.getElementById("searchInfo");

  const cellModal = document.getElementById("cellModal");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalTitle = document.getElementById("modalTitle");
  const modalText = document.getElementById("modalText");
  const modalCancel = document.getElementById("modalCancel");
  const modalSave = document.getElementById("modalSave");

  const runBtn = document.getElementById("runBtn");
  const sqlBox = document.getElementById("sql");
  const out = document.getElementById("out");
  const errBox = document.getElementById("errBox");
  const queryHint = document.getElementById("queryHint");

  function setTab(name){
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    empty.classList.toggle("hidden", !!currentTable);
    dataView.classList.toggle("hidden", name !== "data" || !currentTable);
    schemaView.classList.toggle("hidden", name !== "schema" || !currentTable);
    queryView.classList.toggle("hidden", name !== "query");
  }

  tabs.forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));

  elFilter.addEventListener("input", () => renderTableList());

  pageSize.addEventListener("change", () => {
    const n = Number(pageSize.value);
    paging.limit = n;
    paging.offset = 0;
    vscode.postMessage({ type: "setPageSize", limit: n });
  });

  firstBtn.onclick = () => vscode.postMessage({ type: "paginate", dir: "first" });
  prevBtn.onclick  = () => vscode.postMessage({ type: "paginate", dir: "prev" });
  nextBtn.onclick  = () => vscode.postMessage({ type: "paginate", dir: "next" });
  lastBtn.onclick  = () => vscode.postMessage({ type: "paginate", dir: "last" });


function applySearchFilter(rows){
  const q = (tableSearchText || "").trim().toLowerCase();
  if (!q) return rows || [];
  return (rows || []).filter(r => {
    try{
      const s = (r || []).map(v => v == null ? "" : String(v)).join(" | ").toLowerCase();
      return s.includes(q);
    }catch{
      return false;
    }
  });
}

tableSearch.addEventListener("input", () => {
  tableSearchText = (tableSearch.value || "");
  renderGrid(lastColumns, lastRows);
});

clearSearchBtn.onclick = () => {
  tableSearchText = "";
  tableSearch.value = "";
  renderGrid(lastColumns, lastRows);
};

function closeModal(commit){
  if (!modalState) {
    cellModal.classList.add("hidden");
    return;
  }
  if (!commit) {
    modalState = null;
    cellModal.classList.add("hidden");
    return;
  }
  const { rowid, col, td } = modalState;
  const value = modalText.value;
  // otimista: atualiza o texto na tabela imediatamente
  if (td) {
    td.dataset.val = value;
    td.querySelector(".cellText").textContent = value;
  }
  vscode.postMessage({ type: "updateCell", table: currentTable, rowid: Number(rowid), column: col, value });
  modalState = null;
  cellModal.classList.add("hidden");
}

function openModalForCell(td){
  if (!td || !td.dataset) return;
  const rowid = td.dataset.rowid;
  const col = td.dataset.col;
  const val = td.dataset.val ?? "";
  if (!currentTable || rowid == null || !col) return;

  modalState = { rowid, col, td };
  modalTitle.textContent = currentTable + "." + col + "  (rowid " + rowid + ")";
  modalText.value = String(val);
  cellModal.classList.remove("hidden");
  setTimeout(() => modalText.focus(), 0);
}

modalBackdrop.onclick = () => closeModal(false);
modalCancel.onclick = () => closeModal(false);
modalSave.onclick = () => closeModal(true);

modalText.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeModal(false);
    return;
  }
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    closeModal(true);
    return;
  }
});

dropTableBtn.onclick = () => {
    if (!currentTable) return;
    // Confirm/Prompt nativo (window.confirm) pode ser bloqueado em WebView.
    // Então pedimos para o Extension Host mostrar o modal.
    vscode.postMessage({ type: "requestDeleteTable", table: currentTable });
  };


  runBtn.onclick = () => {
    const sql = sqlBox.value;
    queryHint.textContent = "Executando...";
    vscode.postMessage({ type: "runQuery", sql });
  };

  function renderTableList(){
    const q = (elFilter.value || "").trim().toLowerCase();
    const list = q ? allTables.filter(t => t.toLowerCase().includes(q)) : allTables;

    elTables.innerHTML = "";
    if (!allTables.length) {
      elTables.innerHTML = "<div class='muted'>Nenhuma tabela encontrada</div>";
      return;
    }
    if (!list.length) {
      elTables.innerHTML = "<div class='muted'>Nada com esse filtro</div>";
      return;
    }

    list.forEach(t => {
      const btn = document.createElement("button");
      btn.textContent = t;
      btn.classList.toggle("active", t === currentTable);
      btn.onclick = () => {
        currentTable = t;
        errBox.classList.add("hidden");
        errBox.textContent = "";
        out.textContent = "";
        vscode.postMessage({ type: "openTable", table: t });
        setTab("data");
        renderTableList();
      };
      elTables.appendChild(btn);
    });

    elLeftHint.textContent = allTables.length + " tabela(s)";
  }

  function updatePagingUI(p){
    paging = p || paging;

    const rowCount = paging.rowCount;
    const limit = paging.limit;
    const offset = paging.offset;

    // disable buttons
    const canPrev = offset > 0;
    let canNext = true;

    if (typeof rowCount === "number") {
      canNext = offset + limit < rowCount;
    }

    firstBtn.disabled = !canPrev;
    prevBtn.disabled = !canPrev;
    nextBtn.disabled = !canNext;
    lastBtn.disabled = typeof rowCount === "number" ? !canNext : false;

    // text
    if (typeof rowCount === "number") {
      const from = Math.min(rowCount, offset + 1);
      const to = Math.min(rowCount, offset + limit);
      const page = Math.floor(offset / limit) + 1;
      const pages = Math.max(1, Math.ceil(rowCount / limit));
      pagingText.textContent = "Rows " + from + "-" + to + " de " + rowCount + " • Página " + page + " / " + pages;
    } else {
      pagingText.textContent = "Offset " + offset + " • Limit " + limit + " • Total: ?";
    }
  }

  function renderSchema(info){
    const root = document.getElementById("schema");
    root.innerHTML = "";

    if (!info) {
      root.innerHTML = "<div class='muted'>Sem schema</div>";
      return;
    }

    const cols = (info.columns || []).map(c => {
      const flags = [];
      if (c.pk) flags.push("PK");
      if (c.notnull) flags.push("NOT NULL");
      return "<div>" +
        "<b>" + esc(c.name) + "</b> " +
        "<span class='muted'>" + esc(c.type || "") + "</span> " +
        (flags.length ? "<span class='muted'>(" + esc(flags.join(", ")) + ")</span>" : "") +
      "</div>";
    }).join("");

    const colBox = document.createElement("div");
    colBox.className = "schemaBox";
    colBox.innerHTML = "<b>Columns</b><div style='height:8px'></div>" + cols;
    root.appendChild(colBox);

    const fks = (info.foreignKeys || []);
    const fkBox = document.createElement("div");
    fkBox.className = "schemaBox";
    fkBox.innerHTML = "<b>Foreign Keys</b><div style='height:8px'></div>" +
      (fks.length ? fks.map(f => (
        "<div>" + esc(f.from) + " → " + esc(f.table) + "." + esc(f.to) +
        " <span class='muted'>(onUpdate " + esc(f.onUpdate) + ", onDelete " + esc(f.onDelete) + ")</span></div>"
      )).join("") : "<div class='muted'>Nenhuma</div>");
    root.appendChild(fkBox);
  }

  function renderGrid(columns, rows){
    if (!columns || !columns.length) {
      grid.innerHTML = "<div class='muted' style='padding:10px'>Sem dados</div>";
      return;
    }

    const idxRowid = columns.indexOf("__rowid__");

    const visibleRows = applySearchFilter(rows);
    if (searchInfo) {
      if ((tableSearchText || "").trim()) {
        searchInfo.textContent = "Mostrando " + visibleRows.length + " de " + (rows ? rows.length : 0) + " nesta página";
      } else {
        searchInfo.textContent = "";
      }
    }

    let html = "<table><thead><tr>";
    for (const c of columns) html += "<th>" + esc(c) + "</th>";
    html += "<th>Actions</th></tr></thead><tbody>";

    for (const r of visibleRows || []) {
      const rowid = idxRowid >= 0 ? r[idxRowid] : null;
      html += "<tr>";
      for (let i = 0; i < columns.length; i++) {
        const c = columns[i];
        const v = r[i] ?? "";
        if (c === "__rowid__") {
          html += "<td>" + esc(String(v)) + "</td>";
        } else {
          // célula não-editável se não tiver rowid
          const selectable = rowid != null ? "selectable" : "";
          html += "<td class='" + selectable + "' data-rowid='" + escAttr(String(rowid)) + "' data-col='" + escAttr(c) + "' data-val='" + escAttr(String(v)) + "'><span class='cellText'>" + esc(String(v)) + "</span></td>";
        }
      }
      html += "<td><button class='danger' data-del='" + rowid + "'>Delete</button></td>";
      html += "</tr>";
    }

    html += "</tbody></table>";
    grid.innerHTML = html;

// seleção + edição (duplo clique abre modal tipo editor)
let selectedTd = null;

function clearSelection(){
  if (selectedTd) selectedTd.classList.remove("selected");
  selectedTd = null;
}

function selectTd(td){
  if (!td) return;
  if (selectedTd && selectedTd !== td) selectedTd.classList.remove("selected");
  selectedTd = td;
  td.classList.add("selected");
}

// clique fora remove seleção
grid.addEventListener("click", (e) => {
  const td = e.target.closest ? e.target.closest("td.selectable") : null;
  if (!td) {
    clearSelection();
    return;
  }
  selectTd(td);
});

// duplo clique abre editor
grid.addEventListener("dblclick", (e) => {
  const td = e.target.closest ? e.target.closest("td.selectable") : null;
  if (!td) return;
  selectTd(td);
  openModalForCell(td);
});

// del row button
grid.querySelectorAll("button[data-del]").forEach
(btn => {
      btn.addEventListener("click", (e) => {
        if (!currentTable) return;
        const rowid = Number(e.target.dataset.del);
        vscode.postMessage({ type: "deleteRow", table: currentTable, rowid });
      });
    });
  }

  function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function escAttr(s){ return esc(s).replace(/\\n/g," "); }

  window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.type === "boot") {
      vscode.postMessage({ type: "init" });
      return;
    }

    if (msg.type === "tables") {
      allTables = msg.tables || [];
      renderTableList();
      return;
    }

    if (msg.type === "tableLoaded") {
      currentTable = msg.table;
      currentInfo = msg.info || null;

      empty.classList.add("hidden");
      tableTitle.textContent = currentTable;

      pageSize.value = String(msg.paging?.limit ?? 100);

      // schema + grid + paging
      renderSchema(currentInfo);
      lastColumns = msg.columns || [];
      lastRows = msg.rows || [];
      // reset search quando troca a tabela
      tableSearchText = "";
      if (tableSearch) tableSearch.value = "";
      renderGrid(lastColumns, lastRows);
      updatePagingUI(msg.paging);

      // query default
      sqlBox.value = "SELECT * FROM \\"" + currentTable.replaceAll('"','""') + "\\" LIMIT 50;";
      queryHint.textContent = "";
      out.textContent = "";
      errBox.classList.add("hidden");
      errBox.textContent = "";

      setTab("data");
      renderTableList();
      return;
    }

    if (msg.type === "tableDataRefresh") {
      lastColumns = msg.columns || lastColumns;
      lastRows = msg.rows || [];
      renderGrid(lastColumns, lastRows);
      updatePagingUI(msg.paging);
      return;
    }

    if (msg.type === "tableDeleted") {
      const deleted = msg.table;
      if (currentTable === deleted) {
        currentTable = null;
        currentInfo = null;
      }

      tableTitle.textContent = "";
      pagingText.textContent = "";
      grid.innerHTML = "";
      lastColumns = [];
      lastRows = [];
      tableSearchText = "";
      if (tableSearch) tableSearch.value = "";
      cellModal.classList.add("hidden");
      modalState = null;

      // volta para tela inicial
      empty.classList.remove("hidden");
      dataView.classList.add("hidden");
      schemaView.classList.add("hidden");

      alert("Tabela excluída: " + deleted);
      renderTableList();
      return;
    }

if (msg.type === "queryResult") {
      queryHint.textContent = "";
      errBox.classList.add("hidden");
      errBox.textContent = "";
      out.textContent = JSON.stringify(msg, null, 2);
      return;
    }

    if (msg.type === "error") {
      queryHint.textContent = "";
      errBox.classList.remove("hidden");
      errBox.textContent = msg.message || "Erro";
      return;
    }
  });

  // start
  vscode.postMessage({ type: "init" });
</script>
</body>
</html>`;
    }
}
exports.SqliteEditorProvider = SqliteEditorProvider;
SqliteEditorProvider.viewType = "dbViewer.sqliteEditor";
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
//# sourceMappingURL=sqliteEditorProvider.js.map