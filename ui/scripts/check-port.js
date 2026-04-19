const { execFileSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const port = 8675;
const url = `http://localhost:${port}`;
const uiRoot = path.resolve(__dirname, '..');
const workerEntry = normalizeForComparison(path.join('dist', 'cron', 'worker.js'));

function normalizeForComparison(value) {
  return value.replace(/\//g, '\\').toLowerCase();
}

function getNodeProcesses() {
  if (process.platform === 'win32') {
    const command = "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    const rawOutput = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();

    if (!rawOutput || rawOutput === 'null') {
      return [];
    }

    const parsedOutput = JSON.parse(rawOutput);
    const processList = Array.isArray(parsedOutput) ? parsedOutput : [parsedOutput];
    return processList.map((processInfo) => ({
      pid: processInfo.ProcessId,
      commandLine: processInfo.CommandLine || '',
    }));
  }

  const rawOutput = execFileSync('ps', ['-ax', '-o', 'pid=', '-o', 'command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

  if (!rawOutput) {
    return [];
  }

  return rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      commandLine: match[2],
    }))
    .filter((processInfo) => processInfo.commandLine.includes('node'));
}

function findConflictingProcesses() {
  const normalizedUiRoot = normalizeForComparison(uiRoot);

  return getNodeProcesses().filter((processInfo) => {
    if (!processInfo.commandLine || processInfo.pid === process.pid) {
      return false;
    }

    const commandLine = normalizeForComparison(processInfo.commandLine);
    const isWorkerProcess = commandLine.includes(workerEntry);
    const isUiProcess =
      commandLine.includes(normalizedUiRoot) &&
      commandLine.includes('next') &&
      commandLine.includes('start') &&
      commandLine.includes(`--port ${port}`);

    return isWorkerProcess || isUiProcess;
  });
}

function logConflictAndExit(conflictingProcesses) {
  const workerConflict = conflictingProcesses.some((processInfo) =>
    normalizeForComparison(processInfo.commandLine).includes(workerEntry)
  );

  console.error('[ai-toolkit-ui] Another AI Toolkit UI or worker process is already running.');
  for (const processInfo of conflictingProcesses) {
    console.error(`[ai-toolkit-ui] PID ${processInfo.pid}: ${processInfo.commandLine}`);
  }

  if (workerConflict) {
    console.error('[ai-toolkit-ui] A stale worker can keep Prisma\'s Windows query engine DLL locked and cause .tmp/.old cleanup failures.');
  }

  console.error(`[ai-toolkit-ui] Stop the existing process, or open ${url} if the UI is already running.`);
  process.exit(1);
}

try {
  const conflictingProcesses = findConflictingProcesses();
  if (conflictingProcesses.length > 0) {
    logConflictAndExit(conflictingProcesses);
  }
} catch (error) {
  console.error(`[ai-toolkit-ui] Warning: failed to inspect running Node processes: ${error.message}`);
}

const server = net.createServer();
server.unref();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[ai-toolkit-ui] Port ${port} is already in use.`);
    console.error(`[ai-toolkit-ui] If AI Toolkit is already running, open ${url}.`);
    console.error('[ai-toolkit-ui] Otherwise stop the conflicting process on that port and try again.');
    process.exit(1);
  }

  console.error(`[ai-toolkit-ui] Failed to check port ${port}: ${error.message}`);
  process.exit(1);
});

server.listen(port, () => {
  server.close(() => process.exit(0));
});