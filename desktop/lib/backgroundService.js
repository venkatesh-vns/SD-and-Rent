// "Run in the background": a Windows scheduled task that starts the application
// server (service.js) when the PC starts, as this PC's user, whether or not anyone
// is logged on (Task Scheduler "S4U" logon - no password is stored). It keeps
// running while the screen is locked, the user is signed out or the window is
// closed, restarts itself if it stops, and the PC is kept awake while it runs.
//
// The task runs <data>\service\run-server.cmd, which this module (re)writes with the
// current install paths. Registering may show a Windows administrator prompt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, code: err?.code ?? 0, out: `${stdout}${stderr}`.trim() }));
});
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function create({ appName, exePath, resDir, userDir, log = () => {} }) {
  const taskName = `${appName} Server`;
  const dir = path.join(userDir, 'service');
  const cmdFile = path.join(dir, 'run-server.cmd');
  const xmlFile = path.join(dir, 'task.xml');
  const statusFile = path.join(userDir, 'service-status.json');
  const stopFile = path.join(userDir, 'service.stop');
  const script = path.join(resDir, 'app.asar.unpacked', 'service.js');
  const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : os.userInfo().username;

  // The launcher the task runs (paths of this install)
  function writeLauncher() {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cmdFile, [
      '@echo off',
      `rem ${appName} background service - written by the app; do not edit`,
      'set ELECTRON_RUN_AS_NODE=1',
      `"${exePath}" "${script}" --res "${resDir}" --data "${userDir}"`,
      '',
    ].join('\r\n'));
  }

  function taskXml() {
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(appName)}: database and application server for the connected PCs. Starts with Windows, runs whether or not the user is logged on. Managed from ${xml(appName)} &gt; Settings &gt; Run in the background.</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger><Enabled>true</Enabled><Delay>PT30S</Delay></BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(user)}</UserId>
      <LogonType>S4U</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>${xml(cmdFile)}</Command><WorkingDirectory>${xml(resDir)}</WorkingDirectory></Exec>
  </Actions>
</Task>
`;
  }

  // schtasks, and again elevated (administrator prompt) when Windows refuses
  async function schtasks(args, { elevate = false } = {}) {
    const first = await run('schtasks.exe', args);
    if (first.ok || !elevate) return first;
    log(`schtasks ${args[0]} needs administrator rights: ${first.out}`);
    const quoted = args.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(',');
    const ps = `$p = Start-Process -FilePath schtasks.exe -ArgumentList ${quoted} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`;
    const second = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
    return second.ok ? second : { ...second, out: second.out || first.out };
  }

  async function installed() {
    return (await run('schtasks.exe', ['/Query', '/TN', taskName])).ok;
  }

  const serving = () => {
    try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { return null; }
  };

  async function waitFor(check, seconds) {
    for (let i = 0; i < seconds; i += 1) {
      if (await check()) return true;
      await sleep(1000);
    }
    return false;
  }

  return {
    taskName,
    cmdFile,
    installed,
    serving,
    writeLauncher,
    // Registers (or updates) the task and starts it
    async install() {
      writeLauncher();
      fs.writeFileSync(xmlFile, `﻿${taskXml()}`, 'utf16le');
      const res = await schtasks(['/Create', '/TN', taskName, '/XML', xmlFile, '/F'], { elevate: true });
      if (!res.ok || !(await installed())) throw new Error(`Windows did not register the background service. ${res.out}`.trim());
      log(`Background service task "${taskName}" registered for ${user}`);
      return this.start();
    },
    async start() {
      writeLauncher(); // install folder may have changed since the task was registered
      fs.rmSync(stopFile, { force: true });
      const res = await run('schtasks.exe', ['/Run', '/TN', taskName]);
      if (!res.ok) throw new Error(`The background service could not be started. ${res.out}`);
      return waitFor(() => Boolean(serving()), 180);
    },
    // Asks the service to stop cleanly (database shut down properly)
    async stop() {
      if (!serving()) return true;
      fs.writeFileSync(stopFile, new Date().toISOString());
      const done = await waitFor(() => !serving(), 60);
      if (!done) await run('schtasks.exe', ['/End', '/TN', taskName]);
      return done;
    },
    async uninstall() {
      await this.stop();
      const res = await schtasks(['/Delete', '/TN', taskName, '/F'], { elevate: true });
      if (await installed()) throw new Error(`Windows did not remove the background service. ${res.out}`.trim());
      log(`Background service task "${taskName}" removed`);
    },
  };
}

module.exports = { create };
