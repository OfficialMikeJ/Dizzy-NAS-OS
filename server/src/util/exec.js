import { execFile } from 'node:child_process';

/**
 * Run a command with args, resolve {stdout, stderr}. Rejects with a readable
 * error including stderr on non-zero exit.
 */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`);
        e.stderr = stderr;
        e.code = err.code;
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}

/** Like run(), but returns null instead of throwing. */
export async function tryRun(cmd, args = [], opts = {}) {
  try {
    return await run(cmd, args, opts);
  } catch {
    return null;
  }
}
