const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function startUpdateInstaller({ helper, configPath, ready, timeout = 15000 }) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // The short-lived bootstrap uses Start-Process to give the actual worker its
  // own hidden console, so it both executes -File and survives Checkpoint exiting.
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Config', configPath, '-Launch'], {
    stdio: 'ignore', windowsHide: true
  });
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearInterval(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    const onError = error => { cleanup(); reject(error); };
    const failureDetail = () => {
      try {
        const result = JSON.parse(fs.readFileSync(path.join(path.dirname(configPath), 'install-result.json'), 'utf8').replace(/^\uFEFF/, ''));
        return result.ok ? '' : result.error || 'The update installer could not start.';
      } catch {}
      return '';
    };
    const onExit = code => {
      // A successful bootstrap exits before its independent worker acknowledges.
      if (code === 0) return;
      cleanup();
      reject(new Error(failureDetail() || `The update installer exited before starting (${code}).`));
    };
    const started = Date.now();
    child.once('error', onError);
    child.once('exit', onExit);
    timer = setInterval(() => {
      if (fs.existsSync(ready)) { cleanup(); child.unref(); resolve(child); }
      else if (failureDetail()) { cleanup(); reject(new Error(failureDetail())); }
      else if (Date.now() - started > timeout) {
        cleanup(); child.kill();
        reject(new Error('The update installer could not start. Checkpoint is still running; please retry.'));
      }
    }, 100);
  });
}

module.exports = { startUpdateInstaller };
