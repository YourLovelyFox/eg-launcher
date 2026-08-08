import { useEffect, useRef } from 'react'

interface Star {
  x: number; y: number; size: number; brightness: number
}

const STARS: Star[] = Array.from({ length: 60 }, () => ({
  x: Math.random(), y: Math.random() * 0.6,
  size: Math.random() * 2 + 0.5,
  brightness: Math.random(),
}))

export function SynthwaveBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let animId: number
    let gridOffset = 0
    let sunPulse = 0

    function resize() {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    function draw(timestamp: number) {
      const W = canvas.width
      const H = canvas.height
      const horizonY = H * 0.55
      const sunCX = W / 2
      const sunCY = horizonY
      const sunR = Math.min(W * 0.2, 190)

      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, horizonY)
      sky.addColorStop(0, '#020010')
      sky.addColorStop(0.15, '#0a0028')
      sky.addColorStop(0.35, '#1a0040')
      sky.addColorStop(0.55, '#380058')
      sky.addColorStop(0.75, '#600040')
      sky.addColorStop(0.9, '#901028')
      sky.addColorStop(1, '#d04018')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, horizonY)

      // Stars
      for (const s of STARS) {
        const sx = s.x * W
        const sy = s.y * horizonY
        const alpha = 0.3 + 0.7 * Math.abs(Math.sin(timestamp * 0.001 + s.brightness * 10))
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`
        ctx.beginPath()
        ctx.arc(sx, sy, s.size, 0, Math.PI * 2)
        ctx.fill()
      }

      // Sun
      sunPulse += 0.003
      const glowAlpha = 0.4 + 0.2 * Math.sin(sunPulse)
      ctx.save()
      ctx.beginPath()
      ctx.arc(sunCX, sunCY, sunR, Math.PI, 0)
      ctx.clip()

      // Sun gradient
      const sun = ctx.createLinearGradient(0, sunCY - sunR, 0, sunCY)
      sun.addColorStop(0, '#ffe060')
      sun.addColorStop(0.1, '#ffc030')
      sun.addColorStop(0.25, '#ff9020')
      sun.addColorStop(0.45, '#ff6020')
      sun.addColorStop(0.6, '#e03010')
      sun.addColorStop(0.8, '#901010')
      sun.addColorStop(1, '#300404')
      ctx.fillStyle = sun
      ctx.fillRect(sunCX - sunR, sunCY - sunR, sunR * 2, sunR)

      // Horizontal banding
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      for (let lineY = sunCY - sunR + 14; lineY < sunCY; lineY += 15) {
        ctx.fillRect(sunCX - sunR, lineY, sunR * 2, 1)
      }

      // Sun rim
      ctx.strokeStyle = 'rgba(255,200,80,0.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(sunCX, sunCY, sunR, Math.PI, 0)
      ctx.stroke()
      ctx.restore()

      // Sun glow
      const glow = ctx.createRadialGradient(sunCX, sunCY, sunR * 0.5, sunCX, sunCY, sunR * 2)
      glow.addColorStop(0, `rgba(255,120,30,${glowAlpha})`)
      glow.addColorStop(0.5, `rgba(255,60,10,${glowAlpha * 0.5})`)
      glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow
      ctx.fillRect(sunCX - sunR * 2, sunCY - sunR, sunR * 4, sunR * 2)

      // Reflection on grid
      const refl = ctx.createLinearGradient(0, sunCY, 0, sunCY + 80)
      refl.addColorStop(0, `rgba(255,100,30,${glowAlpha * 0.7})`)
      refl.addColorStop(1, 'transparent')
      ctx.fillStyle = refl
      ctx.fillRect(sunCX - sunR * 1.2, sunCY - 5, sunR * 2.4, 80)

      // Mountain silhouette
      ctx.fillStyle = '#050010'
      ctx.beginPath()
      ctx.moveTo(0, horizonY + 30)
      const peaks = [
        [0, 0.55], [0.07, 0.35], [0.14, 0.5], [0.2, 0.22],
        [0.28, 0.48], [0.35, 0.15], [0.43, 0.42], [0.5, 0.2],
        [0.58, 0.45], [0.63, 0.18], [0.7, 0.38], [0.78, 0.25],
        [0.85, 0.44], [0.92, 0.2], [1, 0.5]
      ]
      for (const [px, py] of peaks) {
        ctx.lineTo(px * W, horizonY + py * 120)
      }
      ctx.lineTo(W, horizonY + 60)
      ctx.lineTo(W, H)
      ctx.lineTo(0, H)
      ctx.closePath()
      ctx.fill()

      // Grid floor
      gridOffset += 1.2
      const gridY = horizonY + 20
      const gridH = H - gridY
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, gridY, W, gridH)
      ctx.clip()

      // Dark base
      ctx.fillStyle = '#030008'
      ctx.fillRect(0, gridY, W, gridH)

      const cellSize = 60
      const perspectiveScale = 0.015

      for (let y = 0; y < gridH; y += cellSize) {
        const rowY = gridY + y + (gridOffset % cellSize)
        const scale = 1 + y * perspectiveScale
        const alpha = Math.max(0, 0.25 * (1 - y / gridH))
        ctx.strokeStyle = `rgba(255, 50, 120, ${alpha})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, rowY)
        ctx.lineTo(W, rowY)
        ctx.stroke()
      }

      // Vertical grid lines with perspective
      for (let x = 0; x < W; x += cellSize) {
        const centerX = W / 2
        const distFromCenter = (x - centerX) / centerX
        for (let y = 0; y < gridH; y += cellSize) {
          const rowY = gridY + y + (gridOffset % cellSize)
          const scale = 1 + y * perspectiveScale
          const alpha = Math.max(0, 0.25 * (1 - y / gridH))
          ctx.strokeStyle = `rgba(255, 50, 120, ${alpha})`
          ctx.lineWidth = 1
          ctx.beginPath()
          const vx = centerX + (x - centerX) * scale
          ctx.moveTo(vx, rowY)
          ctx.lineTo(vx, rowY + cellSize * scale)
          ctx.stroke()
        }
      }

      // Fog over grid
      const fog = ctx.createLinearGradient(0, gridY, 0, H)
      fog.addColorStop(0, 'rgba(5,0,16,0.9)')
      fog.addColorStop(0.3, 'rgba(5,0,16,0.5)')
      fog.addColorStop(1, 'rgba(5,0,16,0.95)')
      ctx.fillStyle = fog
      ctx.fillRect(0, gridY, W, gridH)

      ctx.restore()

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0, zIndex: 0,
        pointerEvents: 'none', width: '100%', height: '100%',
      }}
    />
  )
}
