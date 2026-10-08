import { app } from 'electron'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const configuredDirectory = process.env.VIDEO_DANCER_DATA_DIR
if (configuredDirectory) {
  const directory = resolve(configuredDirectory)
  mkdirSync(directory, { recursive: true })
  app.setPath('userData', directory)
  app.setPath('sessionData', directory)
}
