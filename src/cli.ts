#!/usr/bin/env node
// src/cli.ts
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// ESM compatibility - __dirname is not available in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to check if required environment variables are set
function checkEnvironmentVariables() {
  const requiredVars = ['WORDPRESS_API_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APP_PASSWORD'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please set these variables in your .env file or environment');
    process.exit(1);
  }
}

// Main function to run the MCP server
async function main() {
  // stderr only: the spawned server inherits this process's stdio, so stdout
  // belongs to the MCP JSON-RPC channel and must stay clean.
  console.error('Starting WordPress MCP Server...');
  
  // Check for .env file in current directory
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('No .env file found in current directory.');
    console.warn('Make sure your WordPress credentials are set in your environment variables.');
  }
  
  checkEnvironmentVariables();
  
  // Start the server
  const serverPath = path.join(__dirname, 'server.js');
  const serverProcess = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: process.env
  });
  
  // Handle server process events
  serverProcess.on('close', (code) => {
    if (code !== 0) {
      console.error(`Server process exited with code ${code}`);
      process.exit(code || 1);
    }
    process.exit(0);
  });
  
  // Forward termination signals to the child process
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, () => {
      // Fix: Convert string signal to number for kill method
      serverProcess.kill();
    });
  });
}

// Run the main function
main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
