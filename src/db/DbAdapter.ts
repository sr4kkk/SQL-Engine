export type TableInfo = {
  name: string;
  columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean; dflt: any }>;
  foreignKeys: Array<{ from: string; table: string; to: string; onUpdate: string; onDelete: string }>;
};

export interface DbAdapter {
  readonly id: string;      // ex: caminho do arquivo
  readonly label: string;   // nome amigável

  listTables(): Promise<string[]>;
  getTableInfo(table: string): Promise<TableInfo>;

  select(
    table: string,
    opts?: { limit?: number; offset?: number; orderBy?: string }
  ): Promise<{ columns: string[]; rows: any[][] }>;

  execute(
    sql: string,
    params?: any[]
  ): Promise<{ columns?: string[]; rows?: any[][]; changes?: number }>;

  updateByRowId(table: string, rowid: number, patch: Record<string, any>): Promise<void>;
  deleteByRowId(table: string, rowid: number): Promise<void>;

  dispose(): Promise<void>;
}
