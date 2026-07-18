<script lang="ts">
import { onMount } from 'svelte'

let hasPlayedIntro = false

const PATHS = [
  // Rounded navigation arrow with a deep lower notch, based on the supplied reference.
  'M12.515 1.35C13.66 1.35 14.6 1.96 15.27 3.08L23.58 17.02C24.52 18.6 24.2 20.43 22.82 21.43C21.65 22.28 20.31 22.21 19.14 21.37L12.515 16.62L5.89 21.37C4.72 22.21 3.38 22.28 2.21 21.43C0.83 20.43 0.51 18.6 1.45 17.02L9.76 3.08C10.43 1.96 11.37 1.35 12.515 1.35Z',
]

const VW = 25.03
const VH = 23
const DISPLAY = 100
const GRID = 0.32
const JITTER = 0.06
const RASTER_RES = 6
const DOT = 0.15
const HALO = 0.4
const SPRING = 0.012
const DRAG = 0.88
const CURSOR_R = 3.4
const CURSOR_F = 11.5
const CURSOR_FLOW = 9
const MOUSE_SPEED_REF = 0.42
const MAX_MOUSE_SPEED = 1.2
const MOUSE_VEL_SMOOTH_MS = 34
const VEL_IMPULSE = 6.2
const MOUSE_VEL_DRAG = 0.82
const PHYSICS_STEP_MS = 1000 / 120
const MAX_PHYSICS_STEPS = 6
const EXCITE_HIT = 0.14
const EXCITE_DECAY_FILL = 0.968
const EXCITE_DECAY_CONTOUR = 0.935
const SPRING_WEAKEN_FILL = 0.62
const SPRING_WEAKEN_CONTOUR = 0.22
const SPRING_CONTOUR_MUL = 1.42
const SPRING_FILL_MUL = 0.84

let box: HTMLDivElement | undefined
let cvs: HTMLCanvasElement | undefined

function alphaAt(data: Uint8ClampedArray, w: number, h: number, ix: number, iy: number): number {
  if (ix < 0 || ix >= w || iy < 0 || iy >= h) return 0
  return data[(iy * w + ix) * 4 + 3]
}

function isContourPixel(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  ix: number,
  iy: number,
): boolean {
  if (alphaAt(data, w, h, ix, iy) <= 128) return false
  return (
    alphaAt(data, w, h, ix - 1, iy) <= 128 ||
    alphaAt(data, w, h, ix + 1, iy) <= 128 ||
    alphaAt(data, w, h, ix, iy - 1) <= 128 ||
    alphaAt(data, w, h, ix, iy + 1) <= 128
  )
}

const sampleShape = (): { targets: Float32Array; contour: Uint8Array } => {
  const w = Math.ceil(VW * RASTER_RES)
  const h = Math.ceil(VH * RASTER_RES)
  const oc = document.createElement('canvas')
  oc.width = w
  oc.height = h
  const octx = oc.getContext('2d')!
  octx.scale(RASTER_RES, RASTER_RES)
  octx.fillStyle = '#fff'
  for (const d of PATHS) octx.fill(new Path2D(d))
  const data = octx.getImageData(0, 0, w, h).data

  const pts: number[] = []
  const cont: number[] = []
  for (let gy = GRID / 2; gy < VH; gy += GRID) {
    for (let gx = GRID / 2; gx < VW; gx += GRID) {
      const x = gx + (Math.random() - 0.5) * JITTER
      const y = gy + (Math.random() - 0.5) * JITTER
      const ix = Math.round(x * RASTER_RES)
      const iy = Math.round(y * RASTER_RES)
      if (ix >= 0 && ix < w && iy >= 0 && iy < h && data[(iy * w + ix) * 4 + 3] > 128) {
        pts.push(x, y)
        cont.push(isContourPixel(data, w, h, ix, iy) ? 1 : 0)
      }
    }
  }

  return { targets: Float32Array.from(pts), contour: Uint8Array.from(cont) }
}

onMount(() => {
  if (!cvs || !box) return

  const ctx = cvs.getContext('2d', { alpha: true })!
  const { targets, contour } = sampleShape()
  const N = targets.length >> 1
  const px = new Float32Array(N)
  const py = new Float32Array(N)
  const vx = new Float32Array(N)
  const vy = new Float32Array(N)
  const phases = new Float32Array(N)
  const sizes = new Float32Array(N)
  const springs = new Float32Array(N)
  const excite = new Float32Array(N)

  const playIntro = !hasPlayedIntro
  hasPlayedIntro = true

  for (let i = 0; i < N; i++) {
    phases[i] = Math.random() * 6.2832
    sizes[i] = 0.7 + Math.random() * 0.4
    const c = contour[i]
    springs[i] = SPRING * (c ? SPRING_CONTOUR_MUL : SPRING_FILL_MUL) * (0.85 + Math.random() * 0.3)

    if (playIntro) {
      const a = Math.random() * 6.2832 + (i / N) * 15
      const d = 50 + Math.random() * 70
      px[i] = VW / 2 + Math.cos(a) * d
      py[i] = VH / 2 + Math.sin(a) * d
      vx[i] = -Math.sin(a) * (30 + Math.random() * 50)
      vy[i] = Math.cos(a) * (30 + Math.random() * 50)
    } else {
      px[i] = targets[i * 2]
      py[i] = targets[i * 2 + 1]
      vx[i] = 0
      vy[i] = 0
    }
  }

  let dpr = 1
  let cw = 0
  let ch = 0
  let sc = 1
  let ox = 0
  let oy = 0
  let color = '#888'
  let mx = -1e4
  let my = -1e4
  let mIn = false
  let prev = 0
  let fc = 0

  let prevMx = 0
  let prevMy = 0
  let prevMouseT = 0
  let mouseVelX = 0
  let mouseVelY = 0

  const measure = () => {
    const r = box!.getBoundingClientRect()
    dpr = Math.min(devicePixelRatio ?? 1, 3)
    cw = r.width
    ch = r.height
    cvs!.width = cw * dpr
    cvs!.height = ch * dpr
    cvs!.style.width = `${cw}px`
    cvs!.style.height = `${ch}px`
    sc = DISPLAY / VW
    ox = (cw - VW * sc) / 2
    oy = (ch - VH * sc) / 2
    refreshColor()
  }

  const refreshColor = () => {
    color = getComputedStyle(box!).getPropertyValue('--color-text-tertiary').trim() || '#888'
  }

  const onPointerMove = (e: PointerEvent) => {
    const r = box!.getBoundingClientRect()
    const inBounds =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom

    if (!inBounds) {
      mIn = false
      return
    }

    mIn = true
    const nmx = (e.clientX - r.left - ox) / sc
    const nmy = (e.clientY - r.top - oy) / sc
    const now = performance.now()
    if (prevMouseT > 0) {
      const mdt = Math.max(2, now - prevMouseT)
      let rawVelX = (nmx - prevMx) / mdt
      let rawVelY = (nmy - prevMy) / mdt
      const rawSpeed = Math.hypot(rawVelX, rawVelY)
      if (rawSpeed > MAX_MOUSE_SPEED) {
        const limit = MAX_MOUSE_SPEED / rawSpeed
        rawVelX *= limit
        rawVelY *= limit
      }
      const blend = 1 - Math.exp(-mdt / MOUSE_VEL_SMOOTH_MS)
      mouseVelX += (rawVelX - mouseVelX) * blend
      mouseVelY += (rawVelY - mouseVelY) * blend
    }
    prevMx = nmx
    prevMy = nmy
    prevMouseT = now
    mx = nmx
    my = nmy
  }

  const cr2 = CURSOR_R * CURSOR_R
  const simulate = (dt: number, time: number) => {
    const damp = DRAG ** dt
    mouseVelX *= MOUSE_VEL_DRAG ** dt
    mouseVelY *= MOUSE_VEL_DRAG ** dt

    const mouseSpeed = Math.hypot(mouseVelX, mouseVelY)
    const speedRatio = Math.min(1, mouseSpeed / MOUSE_SPEED_REF)
    const swipe = speedRatio * speedRatio
    const cursorUX = mouseSpeed > 0.0001 ? mouseVelX / mouseSpeed : 0
    const cursorUY = mouseSpeed > 0.0001 ? mouseVelY / mouseSpeed : 0

    for (let i = 0; i < N; i++) {
      const j = i * 2
      const isC = contour[i] !== 0
      const weaken = isC ? SPRING_WEAKEN_CONTOUR : SPRING_WEAKEN_FILL
      const eSoft = 1 - Math.exp(-excite[i] * 0.85)
      const springK = springs[i] * (1 - weaken * eSoft)

      let fx = (targets[j] - px[i]) * springK
      let fy = (targets[j + 1] - py[i]) * springK

      fx += Math.sin(time + phases[i]) * 0.00055
      fy += Math.cos(time + phases[i] * 1.3) * 0.00055

      if (mIn) {
        const dx = px[i] - mx
        const dy = py[i] - my
        const d2 = dx * dx + dy * dy
        if (d2 < cr2 && d2 > 0.001) {
          const d = Math.sqrt(d2)
          const radialX = dx / d
          const radialY = dy / d
          const tangentX = -radialY
          const tangentY = radialX
          const falloff = (1 - d / CURSOR_R) ** 2

          // A slow pointer gently parts the shape; a swipe pushes more firmly.
          const pressure = CURSOR_F * falloff * (0.38 + speedRatio * 0.62)
          fx += radialX * pressure
          fy += radialY * pressure

          // Project cursor motion onto the local tangent so flow splits naturally
          // around both sides instead of always spinning in one direction.
          const tangentMotion = cursorUX * tangentX + cursorUY * tangentY
          const flow = CURSOR_FLOW * falloff * speedRatio * tangentMotion
          fx += tangentX * flow
          fy += tangentY * flow

          fx += mouseVelX * VEL_IMPULSE * falloff * swipe
          fy += mouseVelY * VEL_IMPULSE * falloff * swipe

          const hit = EXCITE_HIT * falloff * (0.35 + swipe * 1.25 + mouseSpeed * 0.08)
          excite[i] += hit * dt
        }
      }

      vx[i] = (vx[i] + fx * dt) * damp
      vy[i] = (vy[i] + fy * dt) * damp
      px[i] += vx[i] * dt
      py[i] += vy[i] * dt

      const dec = isC ? EXCITE_DECAY_CONTOUR : EXCITE_DECAY_FILL
      excite[i] *= dec ** dt
    }
  }

  let accumulator = 0
  const frame = (t: number) => {
    if (!prev) prev = t
    accumulator += Math.min(t - prev, PHYSICS_STEP_MS * MAX_PHYSICS_STEPS)
    prev = t

    const time = t * 0.002
    let steps = 0
    while (accumulator >= PHYSICS_STEP_MS && steps < MAX_PHYSICS_STEPS) {
      simulate(PHYSICS_STEP_MS / 16.667, time)
      accumulator -= PHYSICS_STEP_MS
      steps++
    }

    if (++fc % 120 === 0) refreshColor()

    const W = cw * dpr
    const H = ch * dpr
    ctx.clearRect(0, 0, W, H)

    const s = sc * dpr
    const oX = ox * dpr
    const oY = oy * dpr

    ctx.fillStyle = color

    const haloBands = [0.048, 0.072, 0.098] as const
    for (let b = 0; b < 3; b++) {
      ctx.globalAlpha = haloBands[b]
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        const sp = Math.hypot(vx[i], vy[i])
        const energy = excite[i] * 0.42 + sp * 0.045
        const band = energy < 0.22 ? 0 : energy < 0.58 ? 1 : 2
        if (band !== b) continue
        const sx = px[i] * s + oX
        const sy = py[i] * s + oY
        const pulse = 1 + Math.sin(time * 1.7 + phases[i]) * 0.04
        const rH = sizes[i] * HALO * s * pulse * (1 + Math.min(0.55, energy * 0.22))
        ctx.moveTo(sx + rH, sy)
        ctx.arc(sx, sy, rH, 0, 6.2832)
      }
      ctx.fill()
    }

    const coreAlphas = [0.82, 0.96] as const
    for (let b = 0; b < 2; b++) {
      ctx.globalAlpha = coreAlphas[b]
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        const sp = Math.hypot(vx[i], vy[i])
        const energy = excite[i] * 0.42 + sp * 0.045
        const hi = energy >= 0.28 ? 1 : 0
        if (hi !== b) continue
        const sx = px[i] * s + oX
        const sy = py[i] * s + oY
        const pulse = 1 + Math.sin(time * 1.7 + phases[i]) * 0.04
        const rC = sizes[i] * DOT * s * pulse * (1 + Math.min(0.35, energy * 0.14))
        ctx.moveTo(sx + rC, sy)
        ctx.arc(sx, sy, rC, 0, 6.2832)
      }
      ctx.fill()
    }

    ctx.globalAlpha = 1
    raf = requestAnimationFrame(frame)
  }

  measure()

  const ro = new ResizeObserver(measure)
  ro.observe(box!)
  document.addEventListener('pointermove', onPointerMove, { passive: true })

  let raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(raf)
    ro.disconnect()
    document.removeEventListener('pointermove', onPointerMove)
  }
})
</script>

<div bind:this={box} class="relative flex flex-1 items-center justify-center px-6">
  <canvas bind:this={cvs} class="absolute inset-0" aria-hidden="true"></canvas>
</div>
