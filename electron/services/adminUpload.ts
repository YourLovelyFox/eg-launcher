import fs from 'fs'
import path from 'path'
import { dialog, BrowserWindow } from 'electron'
import { requireAdmin } from './admin'
import { cmsRequest } from './cms/httpClient'

const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export type UploadImageInput =
  | { filePath: string }
  | { name: string; mime?: string; base64: string }

export async function uploadAdminImage(
  sessionToken: string,
  input?: UploadImageInput | null,
): Promise<{ ok: true; url: string; message?: string } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) {
    return { ok: false, error: 'Not authenticated' }
  }

  try {
    let name = 'image.png'
    let mime = 'image/png'
    let base64 = ''

    if (input && 'base64' in input && input.base64) {
      name = path.basename(input.name || 'image.png')
      const ext = path.extname(name).toLowerCase()
      if (!ALLOWED_EXT.has(ext)) {
        return { ok: false, error: 'Only PNG, JPEG, WebP, or GIF images are allowed' }
      }
      mime = (input.mime || EXT_MIME[ext] || 'application/octet-stream').toLowerCase()
      base64 = input.base64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
      const size = Buffer.byteLength(base64, 'base64')
      if (size > MAX_BYTES) return { ok: false, error: 'Image too large (max 2 MB)' }
    } else {
      let filePath = input && 'filePath' in input ? input.filePath : ''
      if (!filePath) {
        const win = BrowserWindow.getFocusedWindow()
        const dialogOpts = {
          title: 'Choose partner icon image',
          properties: ['openFile' as const],
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
            { name: 'All files', extensions: ['*'] },
          ],
        }
        const result = win
          ? await dialog.showOpenDialog(win, dialogOpts)
          : await dialog.showOpenDialog(dialogOpts)
        if (result.canceled || !result.filePaths[0]) {
          return { ok: false, error: 'No file selected' }
        }
        filePath = result.filePaths[0]
      }

      const ext = path.extname(filePath).toLowerCase()
      if (!ALLOWED_EXT.has(ext)) {
        return { ok: false, error: 'Only PNG, JPEG, WebP, or GIF images are allowed' }
      }
      const st = fs.statSync(filePath)
      if (st.size > MAX_BYTES) return { ok: false, error: 'Image too large (max 2 MB)' }
      name = path.basename(filePath)
      mime = EXT_MIME[ext] || 'application/octet-stream'
      base64 = fs.readFileSync(filePath).toString('base64')
    }

    // Images live in MariaDB (cms_images); partners.php stores, icon.php streams bytes.
    // (Host blocks static files and often upload.php by name.)
    let r: { ok?: boolean; url?: string; message?: string; error?: string }
    try {
      r = await cmsRequest({
        path: 'partners.php',
        method: 'POST',
        admin: true,
        body: {
          action: 'upload_image',
          filename: name,
          mime,
          data: base64,
        },
      })
    } catch (err) {
      return {
        ok: false,
        error:
          (err as Error).message +
          ' — deploy partners.php + icon.php + bootstrap.php to CMS web root; set Admin CMS API key',
      }
    }

    if (!r.url) {
      return { ok: false, error: r.error || 'Upload failed — no URL returned' }
    }
    return { ok: true, url: r.url, message: r.message || 'Image uploaded' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
