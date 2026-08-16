import { spawn } from 'node:child_process';
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));

const cyclesArg = args.get('cycles');
const cycles = cyclesArg == null ? 1 : Number(cyclesArg);
const intervalMs = Number(args.get('interval') ?? 300