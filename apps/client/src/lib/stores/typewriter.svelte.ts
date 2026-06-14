export type TypewriterSpeed = 'off' | 'fast' | 'normal' | 'slow'

interface TypewriterConfig {
  burst: number
  interval: number
}

const configs: Record<TypewriterSpeed, TypewriterConfig> = {
  off: { burst: Infinity, interval: 0 },
  fast: { burst: 4, interval: 10 },
  normal: { burst: 2, interval: 20 },
  slow: { burst: 1, interval: 35 },
}

const state = $state<{ speed: TypewriterSpeed }>({ speed: 'fast' })

export const typewriter = {
  get speed() {
    return state.speed
  },
  set speed(v) {
    state.speed = v
  },
  get config() {
    return configs[state.speed]
  },
  get enabled() {
    return state.speed !== 'off'
  },
}
