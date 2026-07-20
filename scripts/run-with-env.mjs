/**
 * Cross-platform: set env vars then run a command.
 * Usage: node scripts/run-with-env.mjs EG_ENABLE_ADMIN=1 -- npm run build
 */
import { spawn } from 'child_process'

const args = process.argv.slice(2)
const sep = args.indexOf('--')
if (sep < 0) {
  console.error('Usage: node scripts/run-with-env.mjs KEY=VAL ... -- command args...')
  process.exit(1)
}

const envAssigns = args.slice(0, sep)
const cmd = args[sep + 1]
const cmdArgs = args.slice(sep + 2)

if (!cmd) {
  console.error('Missing command after --')
  process.exit(1)
}

const env = { ...process.env }
for (const a of envAssigns) {
  const i = a.indexOf('=')
  if (i > 0) env[a.slice(0, i)] = a.slice(i + 1)
}

const child = spawn(cmd, cmdArgs, {
  env,
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 1))
