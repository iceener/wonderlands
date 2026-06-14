import { loadConfig } from '../app/config'
import { loadEnvFileIntoProcess } from '../app/load-env'
import { createDatabaseClient } from './client'

loadEnvFileIntoProcess()

const config = loadConfig()

createDatabaseClient(config)

console.log(`Database migrations applied for ${config.database.path}`)
