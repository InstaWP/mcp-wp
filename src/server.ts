#!/usr/bin/env node
// src/server.ts
import * as dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env first

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { installStdioLifecycle } from './lifecycle.js';
import { allTools, toolHandlers } from './tools/index.js';
import fs from 'node:fs';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';


// Create MCP server instance.
// capabilities.tools must be the capability flags object, NOT a map of tool
// definitions — server.tool() registration below handles tool advertisement.
// Stuffing tool objects here serialized their zod schemas into every
// initialize response (~65KB of internals per connection).
const server = new McpServer({
    name: "wordpress",
    version: "0.0.1"
}, {
    capabilities: {
        tools: {}
    }
});

// Register each tool from our tools list with its corresponding handler
for (const tool of allTools) {
    const handler = toolHandlers[tool.name as keyof typeof toolHandlers];
    if (!handler) continue;
    
    const wrappedHandler = async (args: any) => {
        // The handler functions are already typed with their specific parameter types
        const result = await handler(args);
        return {
            content: result.toolResult.content.map((item: { type: string; text: string }) => ({
                ...item,
                type: "text" as const
            })),
            isError: result.toolResult.isError
        };
    };
    
    // Tool modules define inputSchema.properties as zod shapes (see CLAUDE.md);
    // passing raw JSON Schema here collapses the published schema to {}.
    const rawShape = tool.inputSchema.properties as z.ZodRawShape;
    // Cast bypasses TS2589: server.tool's generic resolves ShapeOutput<Args>
    // against the SDK's z3|z4 union schema type, exploding instantiation depth.
    (server.tool as (name: string, description: string, schema: z.ZodRawShape, cb: typeof wrappedHandler) => unknown)(
        tool.name, tool.description ?? '', rawShape, wrappedHandler
    );

}

async function main() {
    // Capture before any await — process.ppid is dynamic.
    const parentPid = process.ppid;
    const { logToFile } = await import('./wordpress.js');
    
    // Log startup info to stderr (MCP protocol uses stdout)
    logToFile('Starting WordPress MCP server...', 'info');
    logToFile(`Node version: ${process.version}`, 'info');
    logToFile(`Working directory: ${process.cwd()}`, 'info');

    try {
        logToFile('Initializing WordPress client...');
        const { initWordPress } = await import('./wordpress.js');
        await initWordPress();
        logToFile('WordPress client initialized successfully.');

        logToFile('Setting up server transport...');
        const transport = new StdioServerTransport();
        installStdioLifecycle({
            transport,
            onCloseAssignable: server.server,
            envName: 'WORDPRESS_PARENT_WATCHDOG_MS',
            parentPid,
        });
        await server.connect(transport);
        logToFile('WordPress MCP Server running on stdio');
        logToFile(`Registered ${allTools.length} tools`);
    } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logToFile(`Failed to initialize server: ${errorMessage}`);
        if (errorStack) {
            logToFile(`Stack trace: ${errorStack}`);
        }
        process.exit(1);
    }
}

// Handle process errors.
// Signals and stdin EOF live in lifecycle.ts. SIGTERM/SIGINT still exit;
// SIGHUP is ignored so a stray hangup cannot kill the process with no log.
// IMPORTANT: MCP uses stdout for JSON-RPC — never use console.log here.
const NONFATAL_CODES = new Set([
    'EPIPE',
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'ERR_STREAM_DESTROYED',
]);

function errorCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
}

process.on('uncaughtException', (error) => {
    const code = errorCode(error);
    const detail = error instanceof Error ? error.stack || error.message : error;
    fs.writeSync(
        2,
        code && NONFATAL_CODES.has(code)
            ? `[ERROR] Non-fatal ${code}: ${detail}\n`
            : `[FATAL] Uncaught exception: ${detail}\n`,
    );
    if (code && NONFATAL_CODES.has(code)) return;
    process.exit(1);
});
// Do NOT exit on unhandled rejections: a stray promise rejection (e.g. a
// background axios call outside a handler's try/catch) is not worth killing
// the whole server over — that surfaces in clients as the server abruptly
// disconnecting. Log it loudly instead.
process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? reason.stack || reason.message : reason;
    fs.writeSync(
        2,
        `[ERROR] Unhandled rejection (server continuing): ${detail}\n`,
    );
});
// writeSync so the line is still visible if the stream buffer has not flushed
// by the time Claude reaps the process.
process.on('exit', (code) => {
    fs.writeSync(2, `[SHUTDOWN] Process exiting with code ${code}\n`);
});

main().catch((error) => {
    process.stderr.write(`[FATAL] Startup error: ${error}\n`);
    process.exit(1);
});