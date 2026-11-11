import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PARENT_WATCHDOG_MS,
  installStdioLifecycle,
  parseWatchdogIntervalMs,
  startParentWatchdog,
  writeDiagnostic,
} from '../src/lifecycle.js';

describe('parseWatchdogIntervalMs', () => {
  it('defaults on unset/invalid/non-positive', () => {
    expect(parseWatchdogIntervalMs(undefined)).toBe(DEFAULT_PARENT_WATCHDOG_MS);
    expect(parseWatchdogIntervalMs('')).toBe(DEFAULT_PARENT_WATCHDOG_MS);
    expect(parseWatchdogIntervalMs('nope')).toBe(DEFAULT_PARENT_WATCHDOG_MS);
    expect(parseWatchdogIntervalMs('0')).toBe(DEFAULT_PARENT_WATCHDOG_MS);
    expect(parseWatchdogIntervalMs('-1')).toBe(DEFAULT_PARENT_WATCHDOG_MS);
  });

  it('honours positive values floored at 100ms', () => {
    expect(parseWatchdogIntervalMs('250')).toBe(250);
    expect(parseWatchdogIntervalMs('50')).toBe(100);
  });

  it('clamps values that would overflow Node timers to 1ms', () => {
    expect(parseWatchdogIntervalMs('2592000000')).toBe(2_147_483_647);
    const timer = startParentWatchdog(
      1,
      parseWatchdogIntervalMs('2592000000'),
      () => {},
      () => false,
    );
    expect((timer as NodeJS.Timeout & { _idleTimeout: number })._idleTimeout).toBe(
      2_147_483_647,
    );
    clearInterval(timer);
  });
});

describe('writeDiagnostic', () => {
  it('swallows a synchronous stderr failure', () => {
    const spy = vi.spyOn(fs, 'writeSync').mockImplementation(() => {
      const error = new Error('EAGAIN') as NodeJS.ErrnoException;
      error.code = 'EAGAIN';
      throw error;
    });
    expect(() => writeDiagnostic('blocked')).not.toThrow();
    spy.mockRestore();
  });
});

describe('startParentWatchdog', () => {
  it('fires once when the probe reports parent gone', async () => {
    vi.useFakeTimers();
    const onDead = vi.fn();
    startParentWatchdog(1, 100, onDead, () => true);
    expect(onDead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onDead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(onDead).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('installStdioLifecycle', () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.restoreAllMocks();
  });

  it('does not close transport or exit on stdin end/close', () => {
    const transport = { close: vi.fn() };
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    disposers.push(
      installStdioLifecycle({
        transport,
        parentPid: process.ppid,
        envName: 'WORDPRESS_PARENT_WATCHDOG_MS',
      }),
    );

    process.stdin.emit('end');
    process.stdin.emit('close');

    expect(transport.close).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit on SIGHUP while the original parent is still alive', () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    disposers.push(
      installStdioLifecycle({
        transport: { close: vi.fn() },
        parentPid: process.ppid,
      }),
    );

    process.emit('SIGHUP');

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('stdio process stays up after stdin EOF', () => {
  it('does not let the event loop drain when the client write-end closes', async () => {
    const child = spawn(
      'node_modules/.bin/tsx',
      [
        '--input-type=module',
        '-e',
        [
          "import { installStdioLifecycle } from './src/lifecycle.ts';",
          'installStdioLifecycle({ transport: { close() {} }, parentPid: process.ppid });',
          "process.stderr.write('ready\\n');",
        ].join('\n'),
      ],
      { cwd: process.cwd(), stdio: ['pipe', 'ignore', 'pipe'] },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ready: ${stderr}`)), 8000);
      child.stderr.on('data', () => {
        if (stderr.includes('ready')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`exited before ready code=${code} signal=${signal} stderr=${stderr}`));
      });
    });

    child.stdin.end();

    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 500);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (!exited) child.kill('SIGKILL');
    expect(exited).toBe(false);
  });
});
