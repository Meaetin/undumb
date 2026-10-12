import * as THREE from 'three'
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js'

const drawer = document.querySelector('#drawer')
const workspace = document.querySelector('#workspace')
const sceneHost = document.querySelector('#scene')
const loading = document.querySelector('#scene-loading')
const STORAGE_KEY = 'boss-office-isometric-prototype-v1'

const seed = {
  lead: { name: 'Mara', role: 'Tech lead', status: 'Available', sessions: [
    { id: 'lead-current', title: 'Studio website direction', messages: [
      { from: 'agent', text: 'What should visitors understand about the studio when they arrive?', time: '9:41 AM' },
      { from: 'user', text: 'The work should feel thoughtful and approachable. We need a simple portfolio first.', time: '9:42 AM' },
      { from: 'agent', text: 'That gives us a clear starting point. Which projects should lead the gallery?', time: '9:43 AM' },
    ], terminal: ['No command activity in this session.'] },
    { id: 'lead-past', title: 'First project brief', messages: [
      { from: 'user', text: 'Let’s plan a studio website.', time: 'Yesterday' },
      { from: 'agent', text: 'Who is the first audience for it?', time: 'Yesterday' },
    ], terminal: ['No command activity in this session.'] },
  ] },
  nico: { name: 'Nico', role: 'Intern', status: 'Working', sessions: [
    { id: 'nico-current', title: 'Project gallery', messages: [
      { from: 'user', text: 'Build the project gallery from the whiteboard task.', time: '10:12 AM' },
      { from: 'agent', text: 'I’m putting the responsive gallery together and checking the build.', time: '10:14 AM' },
    ], terminal: ['$ npm run build', '✓ TypeScript compiled', '✓ Vite build complete', '', '$ git status --short', ' M src/components/Gallery.tsx'] },
    { id: 'nico-past', title: 'Workspace setup', messages: [
      { from: 'agent', text: 'The starter project is ready to work on.', time: 'Yesterday' },
    ], terminal: ['$ npm install', 'added 152 packages'] },
  ] },
  ari: { name: 'Ari', role: 'Intern', status: 'Available', sessions: [
    { id: 'ari-current', title: 'Ready for work', messages: [
      { from: 'agent', text: 'I’m ready when you have a task for me.', time: '10:20 AM' },
    ], terminal: ['No command activity in this session.'] },
  ] },
}

let data
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
  data = saved && saved.lead?.sessions && saved.nico?.sessions && saved.ari?.sessions ? saved : structuredClone(seed)
} catch { data = structuredClone(seed) }
let selected = null
let activeTab = 'chat'
let selectedTask = 'gallery'
const activeSession = { lead: data.lead.sessions[0].id, nico: data.nico.sessions[0].id, ari: data.ari.sessions[0].id }

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node }
function button(label, className, action) { const node = el('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node }
function updateSelection() {
  document.querySelectorAll('[data-open]').forEach(node => node.classList.toggle('active', node.dataset.open === selected))
  selectionRings.forEach((ring, key) => { ring.visible = selected === key })
}
function open(target) { selected = target; activeTab = 'chat'; renderDrawer() }
function close() { selected = null; renderDrawer() }
document.querySelectorAll('[data-open]').forEach(node => node.addEventListener('click', () => open(node.dataset.open)))
document.addEventListener('keydown', event => { if (event.key === 'Escape' && selected) close() })

function renderDrawer() {
  drawer.replaceChildren()
  drawer.hidden = !selected
  workspace.classList.toggle('drawer-open', Boolean(selected))
  updateSelection()
  resizeScene()
  if (!selected) return
  const board = selected === 'board'
  const person = board ? null : data[selected]
  const head = el('div', 'drawer-head')
  const titleWrap = el('div')
  titleWrap.append(el('span', 'eyebrow', board ? 'PROJECT ASSET' : `${person.role.toUpperCase()} / ${person.status.toUpperCase()}`))
  titleWrap.append(el('h2', '', board ? 'Whiteboard' : person.name))
  titleWrap.append(el('p', '', board ? 'Tasks and decisions for Studio website' : `Studio website · ${person.role}`))
  head.append(titleWrap, button('×', 'drawer-close', close))
  head.querySelector('button').setAttribute('aria-label', 'Close panel')
  drawer.append(head)
  if (board) { renderBoard(); return }
  const tabs = el('div', 'drawer-tabs')
  for (const [id, label] of [['chat', 'Chat'], ['sessions', 'Past sessions'], ['terminal', 'Terminal']]) {
    const tab = button(label, activeTab === id ? 'active' : '', () => { activeTab = id; renderDrawer() })
    tabs.append(tab)
  }
  drawer.append(tabs)
  const bar = el('div', 'session-select')
  const label = el('label', '', 'Session')
  const select = el('select')
  select.id = 'session-choice'
  label.htmlFor = select.id
  for (const session of person.sessions) { const option = el('option', '', session.title); option.value = session.id; select.append(option) }
  select.value = activeSession[selected]
  select.addEventListener('change', () => { activeSession[selected] = select.value; renderDrawer() })
  bar.append(label, select, button('+', '', () => {
    const id = `${selected}-${Date.now()}`
    person.sessions.unshift({ id, title: 'New conversation', messages: [], terminal: ['No command activity in this session.'] })
    activeSession[selected] = id
    save(); activeTab = 'chat'; renderDrawer()
  }))
  bar.lastChild.setAttribute('aria-label', 'Start new session')
  drawer.append(bar)
  const body = el('div', 'drawer-body')
  const session = person.sessions.find(item => item.id === activeSession[selected]) || person.sessions[0]
  if (activeTab === 'chat') {
    if (!session.messages.length) body.append(emptyState('A fresh conversation', 'Messages you write here are saved in this prototype.'))
    for (const message of session.messages) {
      const article = el('article', `message ${message.from}`)
      const messageHead = el('div', 'message-head')
      messageHead.append(el('strong', '', message.from === 'user' ? 'You' : person.name), el('time', '', message.time))
      article.append(messageHead, el('p', '', message.text))
      body.append(article)
    }
    drawer.append(body)
    const form = el('form', 'drawer-composer')
    const input = el('textarea')
    input.placeholder = `Message ${person.name}…`
    input.setAttribute('aria-label', `Message ${person.name}`)
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit() } })
    const foot = el('div', 'composer-foot')
    foot.append(el('span', '', 'Prototype: no agent connection'), el('button', '', 'Send ↗'))
    foot.lastChild.type = 'submit'
    form.append(input, foot)
    form.addEventListener('submit', event => {
      event.preventDefault()
      const text = input.value.trim()
      if (!text) return
      session.messages.push({ from: 'user', text, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })
      save(); renderDrawer()
    })
    drawer.append(form)
    body.scrollTop = body.scrollHeight
  } else if (activeTab === 'sessions') {
    for (const item of person.sessions) {
      const card = button('', `session-card ${item.id === session.id ? 'active' : ''}`, () => { activeSession[selected] = item.id; activeTab = 'chat'; renderDrawer() })
      card.append(el('strong', '', item.title), el('small', '', `${item.messages.length} messages · ${item.id === session.id ? 'Selected' : 'Saved'}`))
      body.append(card)
    }
    drawer.append(body)
  } else {
    body.append(el('pre', 'terminal', session.terminal.join('\n')))
    drawer.append(body, el('div', 'prototype-note', 'Read-only sample command history for this design prototype.'))
  }
}
function emptyState(title, copy) { const box = el('div', 'empty-state'); box.append(el('strong', '', title), el('span', '', copy)); return box }
function renderBoard() {
  const body = el('div', 'drawer-body')
  const count = el('div', 'board-count')
  count.append(el('strong', '', '2'), el('span', '', 'saved tasks'))
  body.append(count)
  const tasks = [
    { id: 'gallery', title: 'Build project gallery', meta: 'In progress · Nico', summary: 'Create a responsive gallery of selected studio work.', points: ['Show project title and a short description.', 'Use image placeholders until final assets are ready.', 'Keep the layout readable on small screens.'] },
    { id: 'intro', title: 'Write studio introduction', meta: 'Ready to assign', summary: 'Introduce the studio and explain what makes its work distinctive.', points: ['Lead with a concise statement.', 'Include a clear path to selected projects.'] },
  ]
  for (const task of tasks) {
    const card = button('', `task-card ${selectedTask === task.id ? 'active' : ''}`, () => { selectedTask = task.id; renderDrawer() })
    card.append(el('strong', '', task.title), el('small', '', task.meta))
    body.append(card)
  }
  const task = tasks.find(item => item.id === selectedTask) || tasks[0]
  const detail = el('div', 'task-detail')
  detail.append(el('span', 'eyebrow', task.meta.toUpperCase()), el('h3', '', task.title), el('p', '', task.summary))
  const list = el('ul')
  for (const point of task.points) list.append(el('li', '', point))
  detail.append(list)
  body.append(detail)
  drawer.append(body, el('div', 'prototype-note', 'This board uses sample tasks. The live app and its data are untouched.'))
}

// The room uses actual CC0 Kenney GLB models. The walls and whiteboard are simple scene geometry.
const scene = new THREE.Scene()
scene.background = new THREE.Color('#c2e7e0')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
sceneHost.append(renderer.domElement)
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100)
camera.position.set(13, 13, 15)
camera.lookAt(0, 1.1, 0)
scene.add(new THREE.HemisphereLight('#fff8de', '#7eaaa2', 2.1))
const sun = new THREE.DirectionalLight('#ffffff', 2.3)
sun.position.set(2, 14, 8)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12
sun.shadow.normalBias = .03
scene.add(sun)

function mat(color, roughness = .9) { return new THREE.MeshStandardMaterial({ color, roughness }) }
function cube(width, height, depth, material, x, y, z, shadows = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = shadows; mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}
const baseMaterial = mat('#9e785e')
const wallLeftMaterial = mat('#fff2d4')
const wallBackMaterial = mat('#eee0c5')
cube(13.3, .24, 11.3, baseMaterial, 0, -.18, 0)
function woodTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512
  const c = canvas.getContext('2d'); c.fillStyle = '#bb8b66'; c.fillRect(0, 0, 512, 512)
  for (let y = 0; y < 512; y += 40) {
    c.fillStyle = y % 80 ? '#b58460' : '#c1936d'; c.fillRect(0, y, 512, 39)
    c.strokeStyle = '#956f52'; c.globalAlpha = .28; c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); c.globalAlpha = 1
    for (let x = (y / 40) % 2 ? 90 : 330; x < 512; x += 360) { c.fillStyle = '#9a6c4e55'; c.fillRect(x, y, 2, 40) }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2.5, 2.5); texture.colorSpace = THREE.SRGBColorSpace; return texture
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(13, 11), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: .92 }))
floor.rotation.x = -Math.PI / 2; floor.position.y = -.045; floor.receiveShadow = true; scene.add(floor)
cube(13.2, 4.25, .2, wallBackMaterial, 0, 2.08, -5.55)
cube(.2, 4.25, 11.1, wallLeftMaterial, -6.6, 2.08, 0)
cube(13.2, .09, .16, mat('#fffaf0'), 0, 4.22, -5.42)
cube(.16, .09, 11.1, mat('#fffaf0'), -6.47, 4.22, 0)
cube(.12, 1.75, 2.6, mat('#bd865f'), -6.43, 2.45, -.8)
cube(.13, 1.5, 2.36, new THREE.MeshStandardMaterial({ color: '#8bb9b7', metalness: .25, roughness: .25 }), -6.34, 2.45, -.8)
cube(.16, 1.52, .07, mat('#fff8e8'), -6.25, 2.45, -.8)

const boardFrame = cube(3.5, 2.0, .12, mat('#d78b5b'), 1.8, 2.5, -5.36)
cube(3.25, 1.76, .14, mat('#fff9ec'), 1.8, 2.5, -5.26)
function boardTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 340
  const c = canvas.getContext('2d'); c.fillStyle = '#fffdf2'; c.fillRect(0, 0, 640, 340)
  c.fillStyle = '#376969'; c.font = 'bold 32px sans-serif'; c.fillText('STUDIO WEBSITE', 32, 53)
  c.fillStyle = '#e2a476'; c.fillRect(30, 78, 194, 166); c.fillStyle = '#ffffff'; c.font = 'bold 22px sans-serif'; c.fillText('TO DO', 53, 114); c.font = '17px sans-serif'; c.fillText('Studio intro', 53, 158); c.fillText('Final assets', 53, 196)
  c.fillStyle = '#8eb6a4'; c.fillRect(248, 78, 318, 166); c.fillStyle = '#ffffff'; c.font = 'bold 22px sans-serif'; c.fillText('IN PROGRESS', 270, 114); c.font = '17px sans-serif'; c.fillText('Project gallery · Nico', 270, 158)
  c.fillStyle = '#d7e5d8'; c.fillRect(30, 272, 536, 9)
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture
}
const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(3.22, 1.74), new THREE.MeshBasicMaterial({ map: boardTexture() }))
boardFace.position.set(1.8, 2.5, -5.178); scene.add(boardFace)

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const clickTargets = []
const selectionRings = new Map()
boardFrame.userData.target = 'board'; clickTargets.push(boardFrame, boardFace)
boardFace.userData.target = 'board'
function characterTarget(key, x, z) {
  const collider = new THREE.Mesh(new THREE.CylinderGeometry(.53, .53, 2, 16), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
  collider.position.set(x, 1, z); collider.userData.target = key; scene.add(collider); clickTargets.push(collider)
  const ring = new THREE.Mesh(new THREE.RingGeometry(.54, .64, 40), new THREE.MeshBasicMaterial({ color: '#e98556', side: THREE.DoubleSide }))
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, .025, z); ring.visible = false; scene.add(ring); selectionRings.set(key, ring)
}
characterTarget('lead', -2.8, -1.0)
characterTarget('nico', 2.6, .9)
characterTarget('ari', 1.0, 3.95)
function hit(event) {
  const bounds = renderer.domElement.getBoundingClientRect()
  pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  return raycaster.intersectObjects(clickTargets, false)[0]?.object.userData.target || null
}
renderer.domElement.addEventListener('pointermove', event => { renderer.domElement.style.cursor = hit(event) ? 'pointer' : 'default' })
renderer.domElement.addEventListener('click', event => { const target = hit(event); if (target) open(target) })

const loader = new GLTFLoader()
const modelUrls = {
  desk: './assets/furniture/desk.glb', chair: './assets/furniture/chairDesk.glb', screen: './assets/furniture/computerScreen.glb', keyboard: './assets/furniture/computerKeyboard.glb',
  shelf: './assets/furniture/bookcaseOpen.glb', books: './assets/furniture/books.glb', sofa: './assets/furniture/loungeSofaLong.glb', coffee: './assets/furniture/tableCoffee.glb',
  plant: './assets/furniture/pottedPlant.glb', lamp: './assets/furniture/lampRoundFloor.glb', laptop: './assets/furniture/laptop.glb', rug: './assets/furniture/rugRectangle.glb',
  lead: './assets/characters/character-a.glb', nico: './assets/characters/character-c.glb', ari: './assets/characters/character-h.glb',
}
const models = {}
try {
  await Promise.all(Object.entries(modelUrls).map(async ([key, url]) => { models[key] = await loader.loadAsync(url) }))
  const movers = []
  function model(key, x, z, size, rotation = 0, y = 0, heightBased = false) {
    const source = models[key].scene.clone(true)
    const bounds = new THREE.Box3().setFromObject(source)
    const dimensions = bounds.getSize(new THREE.Vector3())
    const scale = size / (heightBased ? dimensions.y : Math.max(dimensions.x, dimensions.z))
    source.scale.setScalar(scale)
    source.updateMatrixWorld(true)
    const scaled = new THREE.Box3().setFromObject(source)
    source.position.set(-(scaled.min.x + scaled.max.x) / 2, -scaled.min.y, -(scaled.min.z + scaled.max.z) / 2)
    source.traverse(item => { if (item.isMesh) { item.castShadow = true; item.receiveShadow = true } })
    const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = rotation; group.add(source); scene.add(group)
    return group
  }
  model('sofa', -4.35, 2.35, 2.65, Math.PI / 2)
  model('coffee', -3.15, 3.15, 1.22)
  model('rug', -3.65, 2.85, 3.2, 0, .015)
  model('shelf', -4.8, -3.55, 1.55, Math.PI / 2)
  model('books', -4.8, -3.55, .52, 0, 1.3)
  model('plant', 5.25, -4.4, 1.1)
  model('plant', -5.35, 4.45, .9)
  model('lamp', -5.0, 1.1, 1.2)
  for (const [x, z, turn] of [[-2.8, -2.8, 0], [2.6, -.85, .2], [1.0, 2.3, -.15]]) {
    model('desk', x, z, 2.65, turn)
    model('chair', x, z + 1.32, .88, turn + Math.PI)
    model('screen', x, z -.08, .62, turn, .82)
    model('keyboard', x, z + .44, .42, turn, .83)
  }
  model('laptop', -3.25, 3.15, .55, .35, .45)
  for (const [key, x, z, turn] of [['lead', -2.8, -1.0, Math.PI], ['nico', 2.6, .9, Math.PI], ['ari', 1.0, 3.95, Math.PI]]) {
    const group = model(key, x, z, 1.55, turn, 0, true)
    const animations = models[key].animations
    if (animations.length) {
      const mixer = new THREE.AnimationMixer(group.children[0])
      const idle = animations.find(clip => /idle/i.test(clip.name)) || animations[0]
      mixer.clipAction(idle).play()
      movers.push({ mixer })
    } else movers.push({ group, phase: movers.length })
  }
  loading.remove()
  function animate() {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()
    for (const item of movers) if (item.mixer) item.mixer.update(delta); else item.group.position.y = Math.sin(clock.elapsedTime * 1.8 + item.phase) * .025
    renderer.render(scene, camera)
  }
  const clock = new THREE.Clock()
  resizeScene(); animate()
} catch (error) {
  console.error(error)
  loading.textContent = 'The office models could not load. Check that this site can access its model assets.'
  loading.classList.add('error')
}
function resizeScene() {
  const rect = sceneHost.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const aspect = rect.width / rect.height
  const height = aspect < 1 ? 18.5 : aspect < 1.3 ? 16 : 14.5
  camera.left = -height * aspect / 2; camera.right = height * aspect / 2
  camera.top = height / 2; camera.bottom = -height / 2
  camera.updateProjectionMatrix()
  renderer.setSize(rect.width, rect.height, false)
}
new ResizeObserver(resizeScene).observe(sceneHost)
renderDrawer()
