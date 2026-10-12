import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

export type Area = 'boss' | 'meeting' | 'intern' | 'board'
export const AREAS: { id: Area; title: string; position: [number, number, number] }[] = [
  { id: 'boss', title: "Boss's desk", position: [0, 0, 0.4] },
  { id: 'meeting', title: 'Meeting area', position: [-5.3, 0, -3.5] },
  { id: 'intern', title: 'Intern desk', position: [5.3, 0, -3.5] },
  { id: 'board', title: 'Project board', position: [0, 0, -7.7] },
]

type Props = {
  panelOpen: boolean
  onOpen: (area: Area) => void
  onNearby: (area: Area | null) => void
  onLocked: (locked: boolean) => void
}

function Box({ position, size, color, onClick, emissive = '#000000' }: {
  position: [number, number, number]; size: [number, number, number]; color: string
  onClick?: (event: ThreeEvent<MouseEvent>) => void; emissive?: string
}) {
  return <mesh position={position} onClick={onClick} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.26} />
  </mesh>
}

function AreaMarker({ area, active, onOpen }: { area: Area; active: boolean; onOpen: (area: Area) => void }) {
  const entry = AREAS.find(item => item.id === area)!
  const onClick = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onOpen(area) }
  return <group position={entry.position}>
    <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
      <ringGeometry args={[1.25, 1.36, 48]} />
      <meshBasicMaterial color={active ? '#f6ca83' : '#80cfcb'} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
      <circleGeometry args={[1.22, 48]} />
      <meshBasicMaterial color={active ? '#e1aa5f' : '#4a8e95'} transparent opacity={0.14} />
    </mesh>
  </group>
}

function Furnishings({ nearby, onOpen }: { nearby: Area | null; onOpen: (area: Area) => void }) {
  const clickable = (area: Area) => (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onOpen(area) }
  return <>
    <Box position={[0, -0.13, 0]} size={[18, 0.25, 18]} color="#334747" />
    <Box position={[0, 2.1, -9]} size={[18, 4.2, 0.25]} color="#6b7772" />
    <Box position={[-9, 2.1, 0]} size={[0.25, 4.2, 18]} color="#536a6b" />
    <Box position={[9, 2.1, 0]} size={[0.25, 4.2, 18]} color="#536a6b" />
    <Box position={[0, 2.1, 9]} size={[18, 4.2, 0.25]} color="#758079" />
    <Box position={[0, 4.23, 0]} size={[18, 0.16, 18]} color="#314647" />
    <Box position={[0, 0.73, 0.4]} size={[3, 0.18, 1.45]} color="#b48862" onClick={clickable('boss')} />
    <Box position={[-1.25, 0.37, 0.4]} size={[0.13, 0.73, 1.25]} color="#825b45" />
    <Box position={[1.25, 0.37, 0.4]} size={[0.13, 0.73, 1.25]} color="#825b45" />
    <Box position={[0, 1.16, 0.2]} size={[0.8, 0.68, 0.08]} color="#1b343e" onClick={clickable('boss')} />
    <Box position={[0, 0.82, 0.55]} size={[0.64, 0.04, 0.35]} color="#263741" />
    <Box position={[-5.3, 0.48, -3.5]} size={[2.7, 0.2, 2.0]} color="#a77d64" onClick={clickable('meeting')} />
    {[-6.65, -3.95].map(x => <Box key={x} position={[x, 0.35, -3.5]} size={[0.5, 0.7, 0.8]} color="#527a78" />)}
    <Box position={[-5.3, 0.55, -3.5]} size={[0.9, 0.03, 0.6]} color="#e8d9b5" onClick={clickable('meeting')} />
    <Box position={[5.3, 0.72, -3.5]} size={[2.65, 0.16, 1.35]} color="#a77959" onClick={clickable('intern')} />
    <Box position={[4.15, 0.36, -3.5]} size={[0.12, 0.72, 1.15]} color="#795746" />
    <Box position={[6.45, 0.36, -3.5]} size={[0.12, 0.72, 1.15]} color="#795746" />
    <Box position={[5.3, 1.1, -3.75]} size={[0.72, 0.58, 0.08]} color="#254650" onClick={clickable('intern')} />
    <Box position={[0, 2.1, -8.78]} size={[4.5, 2.4, 0.12]} color="#e6d9bc" onClick={clickable('board')} />
    <Box position={[-1.05, 2.6, -8.69]} size={[1.55, 0.82, 0.02]} color="#5a9694" onClick={clickable('board')} />
    <Box position={[1.1, 2.48, -8.69]} size={[1.65, 1.05, 0.02]} color="#d29a69" onClick={clickable('board')} />
    <Box position={[0, 1.37, -8.69]} size={[2.9, 0.35, 0.02]} color="#768d82" onClick={clickable('board')} />
    <Box position={[-7.2, 2.2, -8.77]} size={[1.4, 2, 0.1]} color="#a8b8a8" />
    <Box position={[7.2, 2.2, -8.77]} size={[1.4, 2, 0.1]} color="#a8b8a8" />
    {AREAS.map(area => <AreaMarker key={area.id} area={area.id} active={nearby === area.id} onOpen={onOpen} />)}
  </>
}

function Controller({ panelOpen, onOpen, onNearby, onLocked }: Props) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const yaw = useRef(0)
  const pitch = useRef(0)
  const nearby = useRef<Area | null>(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    camera.position.set(0, 1.65, 5.8)
    camera.rotation.order = 'YXZ'
  }, [camera])

  useEffect(() => {
    const canvas = gl.domElement
    const change = () => onLocked(document.pointerLockElement === canvas)
    const move = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      yaw.current -= event.movementX * 0.0022
      pitch.current = THREE.MathUtils.clamp(pitch.current - event.movementY * 0.0022, -1.25, 1.25)
    }
    const down = (event: KeyboardEvent) => {
      if (panelOpen || document.pointerLockElement !== canvas) return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
      keys.current.add(event.code)
      if (event.code === 'KeyE' && nearby.current) onOpenRef.current(nearby.current)
    }
    const up = (event: KeyboardEvent) => keys.current.delete(event.code)
    const blur = () => keys.current.clear()
    document.addEventListener('pointerlockchange', change)
    document.addEventListener('mousemove', move)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerlockchange', change)
      document.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [gl, panelOpen, onLocked])

  useEffect(() => {
    if (panelOpen && document.pointerLockElement === gl.domElement) document.exitPointerLock()
    if (panelOpen) keys.current.clear()
  }, [panelOpen, gl])

  useFrame((_, delta) => {
    camera.rotation.y = yaw.current
    camera.rotation.x = pitch.current
    if (!panelOpen && document.pointerLockElement === gl.domElement) {
      const forward = Number(keys.current.has('KeyW') || keys.current.has('ArrowUp')) - Number(keys.current.has('KeyS') || keys.current.has('ArrowDown'))
      const side = Number(keys.current.has('KeyD') || keys.current.has('ArrowRight')) - Number(keys.current.has('KeyA') || keys.current.has('ArrowLeft'))
      if (forward || side) {
        const speed = Math.min(delta, 0.05) * 3.5 / Math.hypot(forward, side)
        camera.position.x += (-Math.sin(yaw.current) * forward + Math.cos(yaw.current) * side) * speed
        camera.position.z += (-Math.cos(yaw.current) * forward - Math.sin(yaw.current) * side) * speed
        camera.position.x = THREE.MathUtils.clamp(camera.position.x, -8.35, 8.35)
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, -8.35, 8.35)
      }
    }
    const closest = AREAS.map(area => ({ id: area.id, distance: Math.hypot(camera.position.x - area.position[0], camera.position.z - area.position[2]) }))
      .sort((a, b) => a.distance - b.distance)[0]
    const next = closest.distance < 2.6 ? closest.id : null
    if (nearby.current !== next) { nearby.current = next; onNearby(next) }
  })
  return null
}

export function OfficeScene(props: Props) {
  const [nearby, setNearby] = useState<Area | null>(null)
  const handleNearby = useCallback((area: Area | null) => { setNearby(area); props.onNearby(area) }, [props])
  return <Canvas shadows camera={{ fov: 72, near: 0.1, far: 40 }} gl={{ antialias: true }}>
    <color attach="background" args={['#192b31']} />
    <ambientLight intensity={1.55} />
    <directionalLight position={[3, 7, 5]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
    <pointLight position={[-5, 3.3, -3]} intensity={25} color="#ffe7b7" distance={10} />
    <pointLight position={[5, 3.3, -3]} intensity={20} color="#b8e4dc" distance={10} />
    <Furnishings nearby={nearby} onOpen={props.onOpen} />
    <Controller {...props} onNearby={handleNearby} />
  </Canvas>
}
