const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const projectRoot = path.join(__dirname, '..');
const destination = path.join(projectRoot, '.build-cache', 'browser');

function fail(message) {
  console.error(`Falha ao preparar o navegador: ${message}`);
  process.exit(1);
}

let executablePath;
try {
  executablePath = puppeteer.executablePath();
} catch (error) {
  fail(`${error.message}. Execute npm install para baixar o Chrome compatível.`);
}

if (!executablePath || !fs.existsSync(executablePath)) {
  fail('o Chrome compatível com o Puppeteer não foi encontrado. Execute npm install novamente.');
}

const sourceDirectory = path.dirname(executablePath);
const sourceExecutable = path.join(sourceDirectory, 'chrome.exe');
if (!fs.existsSync(sourceExecutable)) {
  fail(`chrome.exe não encontrado em ${sourceDirectory}.`);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(sourceDirectory, destination, { recursive: true, force: true });

const destinationExecutable = path.join(destination, 'chrome.exe');
if (!fs.existsSync(destinationExecutable)) {
  fail('a cópia do navegador não contém chrome.exe.');
}

const totalBytes = fs.readdirSync(destination, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .reduce((sum, entry) => sum + fs.statSync(path.join(entry.parentPath || entry.path, entry.name)).size, 0);

console.log(`Navegador preparado em ${destination} (${(totalBytes / 1024 / 1024).toFixed(1)} MB).`);
