import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(scriptDirectory, '..');
const sourcePng = path.join(projectRoot, 'icone.png');
const interfaceDirectory = path.join(projectRoot, 'Electron', 'assets');
const interfacePng = path.join(interfaceDirectory, 'turbowhats-icon.png');
const buildDirectory = path.join(projectRoot, '.build-cache');
const windowsIcon = path.join(buildDirectory, 'turbowhats.ico');
const splashImage = path.join(buildDirectory, 'turbowhats-splash.bmp');
const splashScript = path.join(scriptDirectory, 'prepare-splash.ps1');

if (!fs.existsSync(sourcePng)) {
  throw new Error(`Imagem da marca não encontrada em ${sourcePng}.`);
}

fs.mkdirSync(interfaceDirectory, { recursive: true });
fs.mkdirSync(buildDirectory, { recursive: true });
fs.copyFileSync(sourcePng, interfacePng);
fs.writeFileSync(windowsIcon, await pngToIco(sourcePng));

const splashResult = spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', splashScript,
  '-SourcePng', sourcePng,
  '-OutputBmp', splashImage
], { stdio: 'inherit' });

if (splashResult.status !== 0) {
  throw new Error('Não foi possível preparar a tela de abertura do TurboWhats.');
}

if (!fs.existsSync(interfacePng) || !fs.existsSync(windowsIcon) || !fs.existsSync(splashImage)) {
  throw new Error('Não foi possível preparar os assets da marca TurboWhats.');
}

console.log(`Marca preparada: ${interfacePng}`);
console.log(`Ícone do Windows preparado: ${windowsIcon}`);
console.log(`Tela de abertura preparada: ${splashImage}`);
