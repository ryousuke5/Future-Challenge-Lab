import { spawn } from 'node:child_process';

const children = new Map();

function start(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });
  children.set(name, child);
  child.on('error', (error) => {
    console.error('[fcl-start] '+name+' process error:', error?.message || error);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;
    const exitCode = typeof code === 'number' ? code : 1;
    console.error('[fcl-start] '+name+' exited code='+exitCode+' signal='+(signal || 'none')+'; stopping sibling processes');
    shutdown(exitCode);
  });
  return child;
}

let shuttingDown=false;
let shutdownTimer=null;

function shutdown(code=0) {
  if (shuttingDown) return;
  shuttingDown=true;
  for (const child of children.values()) {
    try { child.kill('SIGTERM'); } catch {}
  }
  shutdownTimer=setTimeout(() => {
    for (const child of children.values()) {
      try { child.kill('SIGKILL'); } catch {}
    }
    process.exit(code);
  }, 8000);
  shutdownTimer.unref?.();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

start('server', [
  '--import','./supporter-register-stability.js',
  '--import','./participant-register-stability.js',
  'server.js'
]);
start('email-worker', ['email-worker.js']);
