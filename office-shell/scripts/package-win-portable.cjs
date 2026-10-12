const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outRoot = path.join(root, 'out')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const targetName = `BossOffice-win32-${process.arch}-${manifest.version}`
const target = path.join(outRoot, targetName)
const staging = target

function safeStagingPath() {
  const resolved = path.resolve(staging)
  if (path.dirname(resolved) !== outRoot || resolved !== target || !path.basename(resolved).startsWith('BossOffice-win32-')) {
    throw new Error('Unsafe portable output path')
  }
  return resolved
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

function main() {
  if (process.platform !== 'win32') throw new Error('The portable build requires Windows')
  if (!process.env.npm_execpath) throw new Error('Run this through npm run package:win-portable')
  const electronDist = path.join(root, 'node_modules', 'electron', 'dist')
  if (!fs.statSync(path.join(electronDist, 'electron.exe')).isFile()) throw new Error('Install Electron before packaging')
  if (!fs.statSync(path.join(root, 'dist', 'index.html')).isFile()) throw new Error('Build the renderer before packaging')
  fs.mkdirSync(outRoot, { recursive: true })
  assert.equal(fs.lstatSync(outRoot).isSymbolicLink(), false, 'Portable output directory cannot be a link')
  if (fs.existsSync(target)) throw new Error(`Portable build already exists: ${target}`)
  safeStagingPath()
  fs.mkdirSync(staging)
  try {
    for (const name of fs.readdirSync(electronDist)) {
      const source = path.join(electronDist, name)
      const destination = path.join(staging, name)
      fs.cpSync(source, destination, { recursive: true, force: false })
    }
    const appRoot = path.join(staging, 'resources', 'app')
    fs.mkdirSync(appRoot, { recursive: true })
    copyFile(path.join(root, 'package.json'), path.join(appRoot, 'package.json'))
    copyFile(path.join(root, 'package-lock.json'), path.join(appRoot, 'package-lock.json'))
    fs.cpSync(path.join(root, 'dist'), path.join(appRoot, 'dist'), { recursive: true })
    const electronSource = path.join(root, 'electron')
    const electronDestination = path.join(appRoot, 'electron')
    fs.mkdirSync(electronDestination)
    for (const name of fs.readdirSync(electronSource)) {
      if (name === 'project-starter') {
        fs.cpSync(path.join(electronSource, name), path.join(electronDestination, name), { recursive: true })
      } else if (name.endsWith('.cjs') && !name.startsWith('test-') && !name.startsWith('smoke-')) {
        copyFile(path.join(electronSource, name), path.join(electronDestination, name))
      }
    }
    const npm = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts',
      '--prefer-offline', '--no-audit', '--no-fund'], { cwd: appRoot, stdio: 'inherit', windowsHide: true })
    if (npm.status !== 0) throw new Error(`Production dependency install failed (${npm.status ?? npm.error?.message})`)
    const required = ['vite', '@vitejs/plugin-react', 'react', 'react-dom']
    for (const name of required) {
      if (!fs.existsSync(path.join(appRoot, 'node_modules', name, 'package.json'))) throw new Error(`Missing runtime package: ${name}`)
    }
    fs.renameSync(path.join(staging, 'electron.exe'), path.join(staging, 'BossOffice.exe'))
    fs.writeFileSync(path.join(staging, 'README-FIRST.txt'),
      'The Boss\'s Office — Windows portable build\r\n\r\n' +
      'Run BossOffice.exe from this folder. Keep the resources folder beside it.\r\n' +
      'Install the Codex CLI, sign in with your ChatGPT account using codex login, and ensure codex.exe is on PATH.\r\n' +
      'The office uses your existing Codex sign-in and allows one active frontend website project.\r\n' +
      'If the CLI is missing or not signed in, the office shows a setup error.\r\n')
    console.log(`Portable build ready: ${target}`)
  } catch (error) {
    const resolved = safeStagingPath()
    if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true })
    throw error
  }
}

main()
