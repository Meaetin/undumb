const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STARTER = 'vite-react-typescript';
const PROJECT_FILES = [
  '.gitignore',
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'src/App.tsx',
  'src/main.tsx',
  'src/style.css',
];

function pathsFor(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('userDataPath must be an absolute path supplied by the Electron host');
  }
  const projectsRoot = path.join(userDataPath, 'projects');
  const activeRoot = path.join(projectsRoot, 'active');
  return {
    projectsRoot,
    activeRoot,
    projectRoot: path.join(activeRoot, 'site'),
    baselineRoot: path.join(activeRoot, 'baseline'),
    metadataPath: path.join(activeRoot, 'metadata.json'),
  };
}

function copyStarterFiles(destinationRoot) {
  const templateRoot = path.join(__dirname, 'project-starter');
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const relativeFile of PROJECT_FILES) {
    const destination = path.join(destinationRoot, relativeFile);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(templateRoot, relativeFile), destination);
  }
}

function projectError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateIdea(idea) {
  if (typeof idea !== 'string') {
    throw projectError('Describe the website idea before creating a project.', 'INVALID_IDEA');
  }
  const trimmed = idea.trim();
  if (!trimmed || trimmed.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(trimmed)) {
    throw projectError('The website idea must be 1–4000 characters of readable text.', 'INVALID_IDEA');
  }
  return trimmed;
}

function assertOrdinaryDirectory(target, code) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw projectError(`Unexpected project directory: ${target}`, code);
  }
}

function pathExistsWithoutFollowingLinks(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function getActiveProject({ userDataPath }) {
  const { activeRoot, projectRoot, baselineRoot, metadataPath } = pathsFor(userDataPath);
  if (!pathExistsWithoutFollowingLinks(activeRoot)) return null;
  assertOrdinaryDirectory(activeRoot, 'INVALID_PROJECT');
  if (!pathExistsWithoutFollowingLinks(metadataPath) || !pathExistsWithoutFollowingLinks(projectRoot)) {
    throw projectError('The active project is incomplete. Its files were left untouched.', 'INVALID_PROJECT');
  }
  assertOrdinaryDirectory(projectRoot, 'INVALID_PROJECT');
  const metadataStat = fs.lstatSync(metadataPath);
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) {
    throw projectError('The active project metadata is invalid.', 'INVALID_PROJECT');
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata?.starter !== STARTER || typeof metadata?.idea !== 'string' || typeof metadata?.id !== 'string') {
    throw projectError('The active project metadata is invalid.', 'INVALID_PROJECT');
  }
  // Projects created before file review was added have the same fixed starter.
  // Capture that starter outside the intern's writable site directory once.
  if (!pathExistsWithoutFollowingLinks(baselineRoot)) {
    const stagingBaseline = path.join(activeRoot, `baseline-staging-${randomUUID()}`);
    try {
      copyStarterFiles(stagingBaseline);
      fs.renameSync(stagingBaseline, baselineRoot);
    } catch (error) {
      if (pathExistsWithoutFollowingLinks(stagingBaseline)) fs.rmSync(stagingBaseline, { recursive: true, force: true });
      if (!pathExistsWithoutFollowingLinks(baselineRoot)) throw error;
    }
  }
  assertOrdinaryDirectory(baselineRoot, 'INVALID_PROJECT');
  return { projectRoot, baselineRoot, metadata };
}

function getActiveProjectRoot(options) {
  return getActiveProject(options)?.projectRoot ?? null;
}

function createProject({ userDataPath, idea }) {
  const goal = validateIdea(idea);
  const { projectsRoot, activeRoot, projectRoot, baselineRoot } = pathsFor(userDataPath);
  fs.mkdirSync(projectsRoot, { recursive: true });
  assertOrdinaryDirectory(projectsRoot, 'INVALID_PROJECT_ROOT');
  if (pathExistsWithoutFollowingLinks(activeRoot)) {
    throw projectError('One active project already exists. Open it to continue.', 'PROJECT_EXISTS');
  }

  const stagingRoot = path.join(projectsRoot, `active-staging-${randomUUID()}`);
  const stagingSite = path.join(stagingRoot, 'site');
  const stagingBaseline = path.join(stagingRoot, 'baseline');
  const metadata = {
    id: randomUUID(),
    idea: goal,
    createdAt: new Date().toISOString(),
    starter: STARTER,
  };

  try {
    copyStarterFiles(stagingSite);
    copyStarterFiles(stagingBaseline);
    fs.writeFileSync(path.join(stagingRoot, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(stagingRoot, activeRoot);
  } catch (error) {
    if (pathExistsWithoutFollowingLinks(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
      throw projectError('One active project already exists. Open it to continue.', 'PROJECT_EXISTS');
    }
    throw error;
  }
  return { projectRoot, baselineRoot, metadata };
}

module.exports = { createProject, getActiveProject, getActiveProjectRoot };
