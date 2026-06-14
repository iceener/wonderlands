import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const commands = [
  ['run', 'dev:server'],
  ['run', 'dev:client'],
]

const children = commands.map((args) =>
  spawn(npmCommand, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  }),
)

let shuttingDown = false

const shutdown = (signal) => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal)
    }
  }
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      shutdown('SIGTERM')
      process.exitCode = code
    }
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
