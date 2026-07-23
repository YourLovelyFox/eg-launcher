import net from 'net'
import type { MinecraftServerStatus } from '../../shared/types'

/**
 * Minecraft modern Server List Ping (1.7+ protocol).
 * Returns online status, player counts, and MOTD when the host is reachable.
 */
export async function queryMinecraftServer(
  address: string,
  timeoutMs = 4500,
): Promise<MinecraftServerStatus> {
  const raw = (address || '').trim()
  if (!raw) {
    return {
      online: false,
      address: '',
      host: '',
      port: 25565,
      error: 'No server address',
    }
  }

  const { host, port } = parseServerAddress(raw)
  const started = Date.now()

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    let buffer = Buffer.alloc(0)

    const finish = (result: MinecraftServerStatus) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(result)
    }

    socket.setTimeout(timeoutMs)

    socket.once('timeout', () => {
      finish({
        online: false,
        address: raw,
        host,
        port,
        latencyMs: Date.now() - started,
        error: 'Timed out',
      })
    })

    socket.once('error', (err) => {
      finish({
        online: false,
        address: raw,
        host,
        port,
        latencyMs: Date.now() - started,
        error: err.message || 'Connection failed',
      })
    })

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        const packetLen = readVarInt(buffer, 0)
        if (!packetLen) return
        const total = packetLen.value + packetLen.size
        if (buffer.length < total) return

        let offset = packetLen.size
        const packetId = readVarInt(buffer, offset)
        if (!packetId) return
        offset += packetId.size
        // Status response packet id = 0
        if (packetId.value !== 0) {
          finish({
            online: false,
            address: raw,
            host,
            port,
            latencyMs: Date.now() - started,
            error: 'Unexpected packet',
          })
          return
        }

        const jsonLen = readVarInt(buffer, offset)
        if (!jsonLen) return
        offset += jsonLen.size
        if (buffer.length < offset + jsonLen.value) return

        const jsonStr = buffer.subarray(offset, offset + jsonLen.value).toString('utf8')
        const data = JSON.parse(jsonStr) as {
          version?: { name?: string; protocol?: number }
          players?: { online?: number; max?: number }
          description?: string | { text?: string; extra?: unknown[] }
        }

        const motd = extractMotd(data.description)
        finish({
          online: true,
          address: raw,
          host,
          port,
          latencyMs: Date.now() - started,
          version: data.version?.name || null,
          playersOnline: data.players?.online ?? null,
          playersMax: data.players?.max ?? null,
          motd,
        })
      } catch (err) {
        finish({
          online: false,
          address: raw,
          host,
          port,
          latencyMs: Date.now() - started,
          error: (err as Error).message || 'Invalid status response',
        })
      }
    })

    socket.connect(port, host, () => {
      try {
        // Handshake (packet 0) + status request (packet 0)
        const handshake = Buffer.concat([
          writeVarInt(0), // packet id
          writeVarInt(760), // protocol (1.19.x-ish; servers accept broadly)
          writeString(host),
          writeUInt16BE(port),
          writeVarInt(1), // next state = status
        ])
        socket.write(Buffer.concat([writeVarInt(handshake.length), handshake]))

        const request = writeVarInt(0)
        socket.write(Buffer.concat([writeVarInt(request.length), request]))
      } catch (err) {
        finish({
          online: false,
          address: raw,
          host,
          port,
          latencyMs: Date.now() - started,
          error: (err as Error).message || 'Handshake failed',
        })
      }
    })
  })
}

export function parseServerAddress(address: string): { host: string; port: number } {
  const trimmed = address.trim()
  // [ipv6]:port
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end > 0) {
      const host = trimmed.slice(1, end)
      const rest = trimmed.slice(end + 1)
      if (rest.startsWith(':')) {
        const p = parseInt(rest.slice(1), 10)
        return { host, port: Number.isFinite(p) && p > 0 ? p : 25565 }
      }
      return { host, port: 25565 }
    }
  }
  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon > 0 && trimmed.indexOf(':') === lastColon) {
    const host = trimmed.slice(0, lastColon)
    const p = parseInt(trimmed.slice(lastColon + 1), 10)
    if (host && Number.isFinite(p) && p > 0) return { host, port: p }
  }
  return { host: trimmed, port: 25565 }
}

function extractMotd(
  description: string | { text?: string; extra?: unknown[] } | undefined,
): string | null {
  if (!description) return null
  if (typeof description === 'string') return description.slice(0, 200)
  const parts: string[] = []
  if (description.text) parts.push(description.text)
  if (Array.isArray(description.extra)) {
    for (const e of description.extra) {
      if (typeof e === 'string') parts.push(e)
      else if (e && typeof e === 'object' && 'text' in e) {
        parts.push(String((e as { text?: string }).text || ''))
      }
    }
  }
  const s = parts.join('').replace(/\u00a7./g, '').trim()
  return s ? s.slice(0, 200) : null
}

function writeVarInt(value: number): Buffer {
  const bytes: number[] = []
  let v = value >>> 0
  do {
    let temp = v & 0b01111111
    v >>>= 7
    if (v !== 0) temp |= 0b10000000
    bytes.push(temp)
  } while (v !== 0)
  return Buffer.from(bytes)
}

function writeString(value: string): Buffer {
  const data = Buffer.from(value, 'utf8')
  return Buffer.concat([writeVarInt(data.length), data])
}

function writeUInt16BE(value: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(value & 0xffff, 0)
  return b
}

function readVarInt(
  buf: Buffer,
  offset: number,
): { value: number; size: number } | null {
  let numRead = 0
  let result = 0
  while (true) {
    if (offset + numRead >= buf.length) return null
    const byte = buf[offset + numRead]!
    result |= (byte & 0x7f) << (7 * numRead)
    numRead++
    if ((byte & 0x80) === 0) break
    if (numRead > 5) return null
  }
  return { value: result, size: numRead }
}
