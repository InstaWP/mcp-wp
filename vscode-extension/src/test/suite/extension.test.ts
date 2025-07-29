import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('vscode-wordpress-mcp'));
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    
    // Check for our commands
    assert.ok(commands.includes('wordpress-mcp.startServer'));
    assert.ok(commands.includes('wordpress-mcp.stopServer'));
    assert.ok(commands.includes('wordpress-mcp.restartServer'));
    assert.ok(commands.includes('wordpress-mcp.configureServer'));
    assert.ok(commands.includes('wordpress-mcp.listPosts'));
    assert.ok(commands.includes('wordpress-mcp.createPost'));
    assert.ok(commands.includes('wordpress-mcp.listPages'));
    assert.ok(commands.includes('wordpress-mcp.createPage'));
    assert.ok(commands.includes('wordpress-mcp.listPlugins'));
    assert.ok(commands.includes('wordpress-mcp.listMedia'));
  });
});
