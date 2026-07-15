const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronArgs = ['.', ...process.argv.slice(2)];
const isSmokeTest = electronArgs.includes('--smoke-test');
const launchDetached = process.platform === 'win32' && !isSmokeTest;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  cwd: require('path').join(__dirname, '..'),
  env,
  stdio: launchDetached ? 'ignore' : 'inherit',
  detached: launchDetached,
  windowsHide: launchDetached
});

if (launchDetached) {
  // Libera o npm/node imediatamente. O Electron continua como aplicativo
  // independente e a janela de prompt usada para iniciar o sistema é fechada.
  child.unref();
} else {
  child.on('error', error => {
    console.error('Não foi possível iniciar o Electron:', error.message);
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Electron encerrado pelo sinal ${signal}.`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}
