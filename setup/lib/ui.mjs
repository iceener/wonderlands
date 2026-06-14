import readline from 'node:readline'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const ANSI = {
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
}

const spinnerFrames = ['-', '\\', '|', '/']

const colorize = (color, value) => `${ANSI[color]}${value}${ANSI.reset}`

export const ui = {
  bold: (value) => colorize('bold', value),
  cyan: (value) => colorize('cyan', value),
  dim: (value) => colorize('dim', value),
  green: (value) => colorize('green', value),
  red: (value) => colorize('red', value),
  yellow: (value) => colorize('yellow', value),
}

export const printBanner = () => {
  const lines = [
    '',
    ui.cyan(ui.bold('Wonderlands Setup')),
    ui.dim('Install dependencies, prepare the local server, and seed a usable account.'),
    '',
  ]

  output.write(`${lines.join('\n')}\n`)
}

export const printSection = (title, description) => {
  output.write(`\n${ui.bold(title)}\n`)
  if (description) {
    output.write(`${ui.dim(description)}\n`)
  }
}

export const printKeyValueTable = (entries) => {
  const width = Math.max(...entries.map(([label]) => label.length))

  for (const [label, value] of entries) {
    output.write(`${ui.dim(label.padEnd(width))}  ${value}\n`)
  }
}

export const createSpinner = (label) => {
  let frameIndex = 0
  let timer = null

  const render = (prefix, message = label) => {
    readline.clearLine(output, 0)
    readline.cursorTo(output, 0)
    output.write(`${prefix} ${message}`)
  }

  return {
    start() {
      render(ui.cyan(spinnerFrames[frameIndex]))
      timer = setInterval(() => {
        frameIndex = (frameIndex + 1) % spinnerFrames.length
        render(ui.cyan(spinnerFrames[frameIndex]))
      }, 80)
    },
    succeed(message = label) {
      if (timer) {
        clearInterval(timer)
      }
      render(ui.green('OK'), message)
      output.write('\n')
    },
    fail(message = label) {
      if (timer) {
        clearInterval(timer)
      }
      render(ui.red('XX'), message)
      output.write('\n')
    },
    stop() {
      if (timer) {
        clearInterval(timer)
      }
      readline.clearLine(output, 0)
      readline.cursorTo(output, 0)
    },
  }
}

export const prompt = async (question, options = {}) => {
  const suffix = options.defaultValue ? ` ${ui.dim(`[${options.defaultValue}]`)}` : ''
  const rl = createInterface({ input, output })

  try {
    const answer = await rl.question(`${question}${suffix}: `)
    const trimmed = answer.trim()

    if (!trimmed && options.defaultValue !== undefined) {
      return options.defaultValue
    }

    return trimmed
  } finally {
    rl.close()
  }
}

export const promptConfirm = async (question, defaultValue = true) => {
  const answer = (await prompt(question, { defaultValue: defaultValue ? 'Y/n' : 'y/N' }))
    .trim()
    .toLowerCase()

  if (!answer || answer === 'y/n') {
    return defaultValue
  }

  if (['y', 'yes'].includes(answer)) {
    return true
  }

  if (['n', 'no'].includes(answer)) {
    return false
  }

  output.write(`${ui.yellow('Please answer yes or no.')}\n`)
  return promptConfirm(question, defaultValue)
}

export const promptChoice = async (question, options, defaultValue) => {
  output.write(`${question}\n`)

  options.forEach((option, index) => {
    const marker = option === defaultValue ? ui.dim(' (default)') : ''
    output.write(`  ${index + 1}. ${option}${marker}\n`)
  })

  const raw = await prompt('Choose a number', {
    defaultValue: String(options.indexOf(defaultValue) + 1),
  })
  const index = Number.parseInt(raw, 10)

  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return options[index - 1]
  }

  output.write(`${ui.yellow('Please choose one of the listed numbers.')}\n`)
  return promptChoice(question, options, defaultValue)
}

export const promptPassword = async (question, options = {}) =>
  new Promise((resolve, reject) => {
    if (!input.isTTY || !output.isTTY) {
      void prompt(question, options).then(resolve, reject)
      return
    }

    let value = ''
    const suffix = options.defaultValue ? ` ${ui.dim(`[${options.defaultValue}]`)}` : ''

    const cleanup = () => {
      input.off('keypress', onKeypress)
      if (input.isTTY) {
        input.setRawMode(false)
      }
      input.pause()
      output.write('\n')
    }

    const onKeypress = (character, key) => {
      if (key?.name === 'return' || key?.name === 'enter' || character === '\r' || character === '\n') {
        cleanup()
        resolve(value || options.defaultValue || '')
        return
      }

      if (key?.name === 'backspace') {
        if (value.length > 0) {
          value = value.slice(0, -1)
          readline.moveCursor(output, -1, 0)
          output.write(' ')
          readline.moveCursor(output, -1, 0)
        }
        return
      }

      if (key?.ctrl && key.name === 'c') {
        cleanup()
        reject(new Error('Interrupted'))
        return
      }

      if (!character || character === '\r' || character === '\n' || key?.sequence === '\u0000') {
        return
      }

      value += character
      output.write('*')
    }

    readline.emitKeypressEvents(input)
    input.resume()
    input.setRawMode(true)
    output.write(`${question}${suffix}: `)
    input.on('keypress', onKeypress)
  })
