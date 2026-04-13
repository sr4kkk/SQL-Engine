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
exports.DbPanel = void 0;
const vscode = __importStar(require("vscode"));
class DbPanel {
    constructor(panel, adapter, table) {
        this.panel = panel;
        this.adapter = adapter;
        this.table = table;
        this.disposables = [];
        this.panel.webview.options = { enableScripts: true };
        this.panel.webview.html = this.html();
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === "load") {
                const data = await this.adapter.select(this.table, { limit: 200, offset: 0 });
                this.panel.webview.postMessage({ type: "data", table: this.table, ...data });
            }
            if (msg.type === "runQuery") {
                const res = await this.adapter.execute(msg.sql);
                this.panel.webview.postMessage({ type: "queryResult", ...res });
            }
            if (msg.type === "updateCell") {
                await this.adapter.updateByRowId(this.table, msg.rowid, { [msg.column]: msg.value });
                const data = await this.adapter.select(this.table, { limit: 200, offset: 0 });
                this.panel.webview.postMessage({ type: "data", table: this.table, ...data });
            }
            if (msg.type === "deleteRow") {
                await this.adapter.deleteByRowId(this.table, msg.rowid);
                const data = await this.adapter.select(this.table, { limit: 200, offset: 0 });
                this.panel.webview.postMessage({ type: "data", table: this.table, ...data });
            }
        }, undefined, this.disposables);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        // inicia
        this.panel.webview.postMessage({ type: "load" });
    }
    static open(adapter, table) {
        const panel = vscode.window.createWebviewPanel("dbViewer.table", `Table: ${table}`, vscode.ViewColumn.Active, { enableScripts: true });
        DbPanel.current?.dispose();
        DbPanel.current = new DbPanel(panel, adapter, table);
    }
    dispose() {
        DbPanel.current = undefined;
        this.disposables.forEach(d => d.dispose());
    }
    html() {
        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: sans-serif; padding: 12px; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ccc; padding: 6px; font-size: 12px; }
    th { position: sticky; top: 0; background: #f5f5f5; }
    input { width: 100%; box-sizing: border-box; }
    textarea { width: 100%; height: 90px; }
    .row-actions button { margin-right: 6px; }
    pre { background: #1112; padding: 8px; overflow:auto; }
  </style>
</head>
<body>
  <h3 id="title"></h3>

  <div>
    <h4>Query</h4>
    <textarea id="sql">SELECT 1;</textarea><br/>
    <button id="run">Run</button>
    <pre id="out"></pre>
  </div>

  <hr/>

  <div>
    <h4>Data</h4>
    <div id="grid"></div>
  </div>

<script>
  const vscode = acquireVsCodeApi();

  document.getElementById("run").addEventListener("click", () => {
    vscode.postMessage({ type: "runQuery", sql: document.getElementById("sql").value });
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "data") {
      document.getElementById("title").textContent = msg.table;
      renderGrid(msg.columns, msg.rows);
    }
    if (msg.type === "queryResult") {
      document.getElementById("out").textContent = JSON.stringify(msg, null, 2);
    }
  });

  function renderGrid(columns, rows) {
    const grid = document.getElementById("grid");
    if (!columns || !columns.length) { grid.innerHTML = "<em>No data</em>"; return; }

    const idxRowid = columns.indexOf("__rowid__");

    let html = "<table><thead><tr>";
    for (const c of columns) html += "<th>" + escapeHtml(c) + "</th>";
    html += "<th>Actions</th></tr></thead><tbody>";

    for (const r of rows) {
      html += "<tr>";
      for (let i=0; i<columns.length; i++) {
        const c = columns[i];
        const v = r[i] ?? "";

        if (c === "__rowid__") {
          html += "<td>" + escapeHtml(String(v)) + "</td>";
        } else {
          const rowid = idxRowid >= 0 ? r[idxRowid] : null;
          html += "<td><input data-rowid='" + rowid + "' data-col='" + escapeAttr(c) + "' value='" + escapeAttr(String(v)) + "'/></td>";
        }
      }

      const rowid = idxRowid >= 0 ? r[idxRowid] : null;
      html += "<td class='row-actions'><button data-del='" + rowid + "'>Delete</button></td>";
      html += "</tr>";
    }

    html += "</tbody></table>";
    grid.innerHTML = html;

    grid.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("change", (e) => {
        const el = e.target;
        vscode.postMessage({
          type: "updateCell",
          rowid: Number(el.dataset.rowid),
          column: el.dataset.col,
          value: el.value
        });
      });
    });

    grid.querySelectorAll("button[data-del]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const rowid = Number(e.target.dataset.del);
        vscode.postMessage({ type: "deleteRow", rowid });
      });
    });
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function escapeAttr(s){ return escapeHtml(s).replace(/\\n/g, " "); }

  vscode.postMessage({ type: "load" });
</script>
</body>
</html>`;
    }
}
exports.DbPanel = DbPanel;
//# sourceMappingURL=panel.js.map