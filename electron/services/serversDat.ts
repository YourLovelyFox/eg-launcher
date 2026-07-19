import fs from 'fs'
import path from 'path'

/**
 * Minimal big-endian NBT writer for Minecraft servers.dat (uncompressed).
 * Structure:
 *   TAG_Compound "" {
 *     TAG_List "servers" of TAG_Compound {
 *       TAG_String "name", TAG_String "ip", TAG_Byte "hideAddress", …
 *     }
 *   }
 */

export type ServerListEntry = {
  name: string
  ip: string
  hideAddress?: boolean
}

function writeU16(buf: number[], value: number) {
  buf.push((value >> 8) & 0xff, value & 0xff)
}

function writeI32(buf: number[], value: number) {
  buf.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
}

function writeStringPayload(buf: number[], text: string) {
  const bytes = Buffer.from(text, 'utf8')
  writeU16(buf, bytes.length)
  for (let i = 0; i < bytes.length; i++) buf.push(bytes[i]!)
}

function writeNamedTagHeader(buf: number[], type: number, name: string) {
  buf.push(type)
  writeStringPayload(buf, name)
}

/** Build uncompressed servers.dat bytes for the given multiplayer entries. */
export function buildServersDat(servers: ServerListEntry[]): Buffer {
  const out: number[] = []

  // Root compound (named empty string)
  writeNamedTagHeader(out, 10, '')

  // TAG_List "servers" of TAG_Compound
  writeNamedTagHeader(out, 9, 'servers')
  out.push(10) // element type = compound
  writeI32(out, servers.length)

  for (const server of servers) {
    // Unnamed compound elements inside a list
    writeNamedTagHeader(out, 8, 'name')
    writeStringPayload(out, server.name)

    writeNamedTagHeader(out, 8, 'ip')
    writeStringPayload(out, server.ip)

    writeNamedTagHeader(out, 1, 'hideAddress')
    out.push(server.hideAddress ? 1 : 0)

    // End of this compound
    out.push(0)
  }

  // End of root compound
  out.push(0)

  return Buffer.from(out)
}

/**
 * Write (or overwrite) servers.dat in an instance game directory.
 * Creates the file even if the folder already has other data.
 */
export function writeInstanceServersDat(
  instanceDir: string,
  servers: ServerListEntry[],
): string {
  const filePath = path.join(instanceDir, 'servers.dat')
  const data = buildServersDat(servers)
  fs.writeFileSync(filePath, data)
  return filePath
}

/**
 * Ensure the partner server is present. If servers.dat is missing, create it.
 * If it exists but we still want a guaranteed default, rewrite with at least
 * the partner entry first (simple overwrite for partner instances).
 */
export function ensureDefaultServer(
  instanceDir: string,
  entry: ServerListEntry,
): void {
  writeInstanceServersDat(instanceDir, [entry])
}
