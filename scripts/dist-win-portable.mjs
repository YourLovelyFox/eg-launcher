/**
 * Build the Windows portable BETA zip (EG_BETA=1 so the in-app badge shows).
 * Output: release/EG-Launcher-<version>-win-x64-portable-BETA.zip
 */
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
      shell: true,
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    })
  })
}

const artifact = 'EG-Launcher-${version}-win-${arch}-portable-BETA.${ext}'

await run('npm', ['run', 'build:app'], { EG_BETA: '1', EG_ENABLE_ADMIN: '0' })
await run(
  'npx',
  [
    'electron-builder',
    '--win',
    'zip',
    '--x64',
    '--publish',
    'never',
    `--config.win.artifactName=${artifact}`,
  ],
  { EG_BETA: '1', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
)

console.log('Portable BETA zip is in release/')
