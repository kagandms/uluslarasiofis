import { DatabaseSync } from 'node:sqlite';

class TestD1Statement {
    constructor(database, sql, values = []) {
        this.database = database;
        this.sql = sql;
        this.values = values;
    }

    bind(...values) {
        return new TestD1Statement(this.database, this.sql, values);
    }

    first() {
        return this.database.prepare(this.sql).get(...this.values) ?? null;
    }

    all() {
        return { results: this.database.prepare(this.sql).all(...this.values) };
    }

    run() {
        const result = this.database.prepare(this.sql).run(...this.values);
        return { success: true, meta: { changes: Number(result.changes) } };
    }
}

export class TestD1Database {
    constructor() {
        this.database = new DatabaseSync(':memory:');
        this.database.exec('PRAGMA foreign_keys = ON;');
    }

    exec(sql) {
        this.database.exec(sql);
    }

    prepare(sql) {
        return new TestD1Statement(this.database, sql);
    }

    async batch(statements) {
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const results = statements.map((statement) => statement.run());
            this.database.exec('COMMIT;');
            return results;
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }
}
