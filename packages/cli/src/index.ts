#!/usr/bin/env node
import {
  askQuestion,
  buildContextOnly,
  checkOllamaHealth,
  explainQuery,
  formatAgentResponse,
  formatEvalCaseLine,
  formatEvalSummary,
  formatResultsTable,
  PAGILA_EVAL_CASES,
  resolveAiConfig,
  reviewAgentResponse,
  runEval,
  type SqlRunner,
} from "@db-ai/ai";
import { findJoinPath, findTableByName, formatRelationshipTree, getNeighbors } from "@db-ai/core";
import {
  createPostgresClient,
  executeQuery,
  introspectSchema,
  type QueryExecutor,
} from "@db-ai/db-postgres";
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { createSampleFetcher, getConnectionString } from "./config.js";
import { confirmExecution, parsePrivacyMode, parseProvider } from "./prompt.js";

const program = new Command();

program
  .name("db-ai")
  .description("AI-native database client — schema introspection CLI")
  .version("0.0.1");

program
  .command("health")
  .description("Check database connectivity")
  .option("--url <connectionString>", "Postgres connection string")
  .action(async (options: { url?: string }) => {
    const client = await createPostgresClient({
      connectionString: getConnectionString(options.url),
    });
    try {
      const result = await client.query<{ database: string; version: string }>(
        "SELECT current_database() AS database, version() AS version",
      );
      const row = result.rows[0];
      console.log(`Connected to: ${row?.database}`);
      console.log(`Server: ${row?.version?.split(",")[0]}`);
    } finally {
      await client.close();
    }
  });

program
  .command("llm-health")
  .description("Check the configured LLM provider (pings the server for ollama)")
  .option("--provider <name>", "LLM provider: openai | anthropic | ollama")
  .option("--model <model>", "Model override")
  .action(async (options: { provider?: string; model?: string }) => {
    const config = resolveAiConfig({
      provider: parseProvider(options.provider),
      model: options.model,
    });
    console.log(`Provider: ${config.provider}`);
    console.log(`Model:    ${config.model}`);

    if (config.provider !== "ollama") {
      const keyPresent =
        config.provider === "openai" ? !!config.openaiApiKey : !!config.anthropicApiKey;
      const keyName = config.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      console.log(`API key:  ${keyPresent ? "set" : `missing (${keyName})`}`);
      if (!keyPresent) {
        process.exitCode = 1;
      }
      return;
    }

    const health = await checkOllamaHealth(config.ollamaBaseUrl, config.model);
    console.log(`Server:   ${health.baseUrl}`);
    if (!health.reachable) {
      console.error(`\nOllama not reachable: ${health.error ?? "unknown error"}`);
      console.error("Is `ollama serve` running?");
      process.exitCode = 1;
      return;
    }

    console.log(`Reachable: yes (${health.models.length} model(s) installed)`);
    if (health.modelAvailable) {
      console.log(`\nReady: ${config.model} is installed.`);
      return;
    }

    console.error(`\nModel "${config.model}" is not installed. Run: ollama pull ${config.model}`);
    if (health.models.length > 0) {
      console.error(`Installed: ${health.models.join(", ")}`);
    }
    process.exitCode = 1;
  });

program
  .command("introspect")
  .description("Introspect schema and build relationship graph")
  .option("--url <connectionString>", "Postgres connection string")
  .option("-o, --out <file>", "Write graph JSON to file")
  .action(async (options: { url?: string; out?: string }) => {
    const client = await createPostgresClient({
      connectionString: getConnectionString(options.url),
    });
    try {
      const graph = await introspectSchema(client);

      const summary = {
        database: graph.database,
        tables: graph.tables.length,
        foreignKeys: graph.foreignKeys.length,
        indexes: graph.indexes.length,
        schemas: graph.schemas.map((s) => s.name),
      };

      console.log("Schema introspection complete:");
      console.log(JSON.stringify(summary, null, 2));

      if (options.out) {
        writeFileSync(options.out, JSON.stringify(graph, null, 2));
        console.log(`\nGraph written to ${options.out}`);
      }
    } finally {
      await client.close();
    }
  });

program
  .command("graph")
  .description("Show relationship graph from a table")
  .requiredOption("--from <table>", "Starting table name")
  .option("--schema <schema>", "Schema name", "public")
  .option("--depth <n>", "Tree depth", "2")
  .option("--url <connectionString>", "Postgres connection string")
  .action(async (options: { from: string; schema: string; depth: string; url?: string }) => {
    const client = await createPostgresClient({
      connectionString: getConnectionString(options.url),
    });
    try {
      const graph = await introspectSchema(client);
      const table = findTableByName(graph, options.from);

      if (!table) {
        console.error(`Table not found: ${options.from}`);
        console.error(`Available tables: ${graph.tables.map((t) => t.name).join(", ")}`);
        process.exitCode = 1;
        return;
      }

      const schema = table.schema;
      console.log(`\nRelationships from ${schema}.${table.name}:\n`);
      console.log(formatRelationshipTree(graph, schema, table.name, Number(options.depth)));

      const neighbors = getNeighbors(graph, schema, table.name);
      if (neighbors.length > 0) {
        console.log("\nDirect connections:");
        for (const n of neighbors) {
          const arrow = n.direction === "outgoing" ? "→" : "←";
          const via = `${n.via.fromTable}.${n.via.fromColumn} → ${n.via.toTable}.${n.via.toColumn}`;
          console.log(`  ${arrow} ${n.table.schema}.${n.table.name} (${via})`);
        }
      }
    } finally {
      await client.close();
    }
  });

program
  .command("path")
  .description("Find join path between two tables")
  .requiredOption("--from <table>", "Source table")
  .requiredOption("--to <table>", "Target table")
  .option("--schema <schema>", "Schema name", "public")
  .option("--url <connectionString>", "Postgres connection string")
  .action(async (options: { from: string; to: string; schema: string; url?: string }) => {
    const client = await createPostgresClient({
      connectionString: getConnectionString(options.url),
    });
    try {
      const graph = await introspectSchema(client);
      const fromTable = findTableByName(graph, options.from);
      const toTable = findTableByName(graph, options.to);

      if (!fromTable || !toTable) {
        console.error("One or both tables not found.");
        process.exitCode = 1;
        return;
      }

      const path = findJoinPath(
        graph,
        fromTable.schema,
        fromTable.name,
        toTable.schema,
        toTable.name,
      );

      if (!path) {
        console.log(`No join path found between ${fromTable.name} and ${toTable.name}`);
        return;
      }

      console.log(`Join path (${path.joins.length} hop${path.joins.length === 1 ? "" : "s"}):`);
      console.log(path.tables.join(" → "));
      console.log("\nJoins:");
      for (const join of path.joins) {
        console.log(`  ${join.fromTable}.${join.fromColumn} → ${join.toTable}.${join.toColumn}`);
      }
    } finally {
      await client.close();
    }
  });

program
  .command("context")
  .description("Build AI context packet for a question (no LLM call)")
  .argument("<question>", "Natural language question")
  .option("--url <connectionString>", "Postgres connection string")
  .option("--mode <mode>", "Privacy mode: local-only | schema-sharing | full-ai", "schema-sharing")
  .action(async (question: string, options: { url?: string; mode: string }) => {
    const client = await createPostgresClient({
      connectionString: getConnectionString(options.url),
    });
    try {
      const graph = await introspectSchema(client);
      const privacyMode = parsePrivacyMode(options.mode);
      const sampleFetcher = privacyMode === "full-ai" ? createSampleFetcher(client) : undefined;

      const packet = await buildContextOnly(graph, question, {
        privacyMode,
        sampleFetcher,
      });

      console.log(`Selected ${packet.selectedTables.length} of ${packet.totalTables} tables:\n`);
      console.log(packet.selectedTables.map((t) => `- ${t.schema}.${t.name}`).join("\n"));

      if (packet.joinPaths.length > 0) {
        console.log("\nJoin paths:");
        for (const path of packet.joinPaths) {
          console.log(`  ${path}`);
        }
      }

      console.log("\n--- Context prompt ---\n");
      console.log(packet.promptText);
    } finally {
      await client.close();
    }
  });

program
  .command("ask")
  .description("Ask a natural language question about the database")
  .argument("<question>", "Natural language question")
  .option("--url <connectionString>", "Postgres connection string")
  .option("--provider <name>", "LLM provider: openai | anthropic | ollama")
  .option("--model <model>", "Model override")
  .option("--mode <mode>", "Privacy mode: schema-sharing | full-ai", "schema-sharing")
  .option("--yes", "Auto-approve read-only queries and execute")
  .option("--no-execute", "Generate SQL but do not execute")
  .action(
    async (
      question: string,
      options: {
        url?: string;
        provider?: string;
        model?: string;
        mode: string;
        yes?: boolean;
        execute?: boolean;
      },
    ) => {
      const client = await createPostgresClient({
        connectionString: getConnectionString(options.url),
      });
      try {
        const graph = await introspectSchema(client);
        const privacyMode = parsePrivacyMode(options.mode);
        const sampleFetcher = privacyMode === "full-ai" ? createSampleFetcher(client) : undefined;

        console.log("Thinking...\n");

        const { context, response } = await askQuestion(graph, question, {
          privacyMode,
          sampleFetcher,
          provider: parseProvider(options.provider),
          model: options.model,
        });

        console.log(formatAgentResponse(response));
        console.log(`\n(Context: ${context.selectedTables.length}/${context.totalTables} tables)`);

        if (!response.sql || options.execute === false) {
          return;
        }

        const review = reviewAgentResponse(response);
        console.log(`\nQuery type: ${review.classification}`);

        if (review.isDestructive) {
          console.error(`\nBlocked: ${review.reason}`);
          process.exitCode = 1;
          return;
        }

        let approved = options.yes === true;
        if (!approved) {
          approved = await confirmExecution("Execute this query?");
        }

        if (!approved) {
          console.log("Skipped execution.");
          return;
        }

        const executor: QueryExecutor = {
          query: async (sql, params) => {
            const q = await client.query(sql, params);
            return {
              rows: q.rows as Record<string, unknown>[],
              rowCount: q.rowCount ?? q.rows.length,
              fields: q.fields.map((f) => f.name),
            };
          },
        };
        const result = await executeQuery(executor, response.sql, { readOnly: true });
        console.log(`\n${result.rowCount} row(s):\n`);
        console.log(formatResultsTable(result.rows, result.fields, result.truncated));
      } finally {
        await client.close();
      }
    },
  );

program
  .command("explain-query")
  .description("Explain a SQL query in plain English")
  .requiredOption("--sql <query>", "SQL query to explain")
  .option("--url <connectionString>", "Postgres connection string")
  .option("--provider <name>", "LLM provider: openai | anthropic | ollama")
  .option("--model <model>", "Model override")
  .action(async (options: { sql: string; url?: string; provider?: string; model?: string }) => {
    const client = await createPostgresClient({
      connectionString: getConnectionString(options.url),
    });
    try {
      const graph = await introspectSchema(client);
      console.log("Analyzing...\n");
      const response = await explainQuery(graph, options.sql, {
        provider: parseProvider(options.provider),
        model: options.model,
      });
      console.log(formatAgentResponse(response));
    } finally {
      await client.close();
    }
  });

program
  .command("eval")
  .description("Run the schema-understanding eval suite against the configured LLM")
  .option("--url <connectionString>", "Postgres connection string")
  .option("--provider <name>", "LLM provider: openai | anthropic | ollama")
  .option("--model <model>", "Model override")
  .option("--limit <n>", "Run only the first N cases")
  .action(async (options: { url?: string; provider?: string; model?: string; limit?: string }) => {
    const client = await createPostgresClient({
      connectionString: getConnectionString(options.url),
    });
    try {
      const graph = await introspectSchema(client);

      const executor: QueryExecutor = {
        query: async (sql, params) => {
          const q = await client.query(sql, params);
          return {
            rows: q.rows as Record<string, unknown>[],
            rowCount: q.rowCount ?? q.rows.length,
            fields: q.fields.map((f) => f.name),
          };
        },
      };
      const runSql: SqlRunner = async (sql) => {
        const result = await executeQuery(executor, sql, { readOnly: true });
        return { rows: result.rows, fields: result.fields };
      };

      const cases = options.limit
        ? PAGILA_EVAL_CASES.slice(0, Number(options.limit))
        : PAGILA_EVAL_CASES;
      const provider = parseProvider(options.provider) ?? process.env.DB_AI_LLM ?? "openai";
      console.log(`Running ${cases.length} eval case(s) against ${provider}...\n`);

      const summary = await runEval(graph, runSql, cases, {
        provider: parseProvider(options.provider),
        model: options.model,
        onCaseDone: (r) => console.log(formatEvalCaseLine(r)),
      });

      console.log(`\n${formatEvalSummary(summary)}`);

      if (summary.executed < summary.withSql || summary.agentErrors > 0) {
        process.exitCode = 1;
      }
    } finally {
      await client.close();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
