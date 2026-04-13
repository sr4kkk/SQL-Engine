declare module "sql.js" {
  export type SqlValue = string | number | null | Uint8Array;

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export interface Statement {
    bind(values?: any[]): void;
    step(): boolean;
    get(): any[];
    getColumnNames(): string[];
    free(): void;
  }

  export class Database {
    constructor(data?: Uint8Array);
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
