// Keeps Windows from going to sleep while this PC serves the application to other
// PCs (a locked screen is fine; sleep would cut everyone off). Works in the desktop
// window and in the background service: a hidden PowerShell asks Windows to keep
// the system awake (SetThreadExecutionState) for as long as it runs. The display
// may still turn off. Returns stop().
const { spawn } = require('child_process');

const SCRIPT = `
Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[W.P]::SetThreadExecutionState(0x80000001) | Out-Null
while ($true) { Start-Sleep -Seconds 3600 }`;

function keepAwake(log = () => {}) {
  if (process.platform !== 'win32') return () => {};
  let child = null;
  let stopped = false;
  const startChild = () => {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { windowsHide: true, stdio: 'ignore' });
    child.on('error', (err) => log('Keep-awake helper could not start', err));
    child.on('exit', () => { if (!stopped) setTimeout(startChild, 60000); }); // restart if it ends
  };
  startChild();
  log('Keeping this PC awake while it serves the application');
  return () => {
    stopped = true;
    try { child?.kill(); } catch { /* already gone */ }
  };
}

module.exports = { keepAwake };
