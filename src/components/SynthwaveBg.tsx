import { useEffect, useRef } from 'react'

const STARS = Array.from({ length: 90 }, () => ({
  x: Math.random(), y: Math.random() * 0.55,
  size: Math.random() * 2.5 + 0.4,
  speed: Math.random() * 0.4 + 0.15,
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

    function draw(ts: number) {
      const W = canvas.width, H = canvas.height
      const horizonY = H * 0.46
      const sunCX = W / 2
      const sunCY = horizonY + 12
      const sunR = Math.min(W * 0.22, 200)
      const gridY = horizonY + 28
      const gridH = H - gridY

      // ── SKY ──
      const sky = ctx.createLinearGradient(0, 0, 0, horizonY)
      sky.addColorStop(0, '#020010'); sky.addColorStop(0.1, '#0a0025')
      sky.addColorStop(0.25, '#18003a'); sky.addColorStop(0.42, '#320052')
      sky.addColorStop(0.58, '#580040'); sky.addColorStop(0.75, '#850028')
      sky.addColorStop(0.9, '#b0001a'); sky.addColorStop(1, '#d04018')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, W, horizonY + 10)

      // ── STARS ──
      for (const s of STARS) {
        const sx = s.x * W, sy = s.y * horizonY
        const a = 0.25 + 0.55 * Math.abs(Math.sin(ts * 0.0007 + s.speed * 6))
        ctx.fillStyle = `rgba(255,255,255,${a})`
        ctx.beginPath(); ctx.arc(sx, sy, s.size, 0, Math.PI * 2); ctx.fill()
        if (s.size > 1.6 && a > 0.55) {
          ctx.fillStyle = `rgba(255,120,220,${a * 0.25})`
          ctx.beginPath(); ctx.arc(sx + 1, sy, s.size * 1.6, 0, Math.PI * 2); ctx.fill()
        }
      }

      // ── SUN ──
      sunPulse += 0.002
      const gA = 0.4 + 0.18 * Math.sin(sunPulse)
      ctx.save()
      ctx.beginPath(); ctx.arc(sunCX, sunCY, sunR, Math.PI, 0); ctx.clip()
      const sunGrad = ctx.createLinearGradient(0, sunCY - sunR, 0, sunCY)
      sunGrad.addColorStop(0, '#ffe860'); sunGrad.addColorStop(0.06, '#ffd040')
      sunGrad.addColorStop(0.15, '#ffb020'); sunGrad.addColorStop(0.32, '#ff8020')
      sunGrad.addColorStop(0.52, '#d82810'); sunGrad.addColorStop(0.72, '#801010')
      sunGrad.addColorStop(0.9, '#300606'); sunGrad.addColorStop(1, '#080101')
      ctx.fillStyle = sunGrad
      ctx.fillRect(sunCX - sunR, sunCY - sunR, sunR * 2, sunR)
      // banding
      ctx.fillStyle = 'rgba(0,0,0,0.09)'
      for (let ly = sunCY - sunR + 16; ly < sunCY; ly += 16) {
        ctx.fillRect(sunCX - sunR, ly, sunR * 2, 1)
      }
      ctx.strokeStyle = 'rgba(255,220,60,0.5)'; ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.arc(sunCX, sunCY, sunR, Math.PI, 0); ctx.stroke()
      ctx.restore()

      // glow
      const gl = ctx.createRadialGradient(sunCX, sunCY - sunR * 0.25, sunR * 0.25, sunCX, sunCY - sunR * 0.25, sunR * 2.8)
      gl.addColorStop(0, `rgba(255,150,30,${gA})`)
      gl.addColorStop(0.35, `rgba(255,60,10,${gA * 0.35})`)
      gl.addColorStop(1, 'transparent')
      ctx.fillStyle = gl
      ctx.fillRect(sunCX - sunR * 3, sunCY - sunR * 1.5, sunR * 6, sunR * 3)

      // reflection
      const rf = ctx.createLinearGradient(0, sunCY, 0, sunCY + 110)
      rf.addColorStop(0, `rgba(255,110,30,${gA * 0.55})`)
      rf.addColorStop(0.5, `rgba(255,40,10,${gA * 0.15})`)
      rf.addColorStop(1, 'transparent')
      ctx.fillStyle = rf
      ctx.fillRect(sunCX - sunR * 1.4, sunCY - 3, sunR * 2.8, 110)

      // ── MOUNTAINS ──
      ctx.fillStyle = '#040010'
      ctx.beginPath(); ctx.moveTo(0, horizonY + 40)
      for (const [px, py] of [[0,0.5],[0.04,0.28],[0.1,0.5],[0.14,0.22],[0.2,0.48],[0.25,0.16],[0.31,0.42],[0.36,0.18],[0.42,0.46],[0.48,0.12],[0.54,0.38],[0.6,0.2],[0.65,0.42],[0.71,0.13],[0.77,0.35],[0.83,0.18],[0.89,0.36],[0.94,0.14],[1,0.38]] as [number,number][]) {
        ctx.lineTo(px * W, horizonY + py * 150)
      }
      ctx.lineTo(W, horizonY + 55); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill()

      // ── GRID ──
      gridOffset += 1.5
      ctx.save()
      ctx.beginPath(); ctx.rect(0, gridY, W, gridH); ctx.clip()
      ctx.fillStyle = '#020008'; ctx.fillRect(0, gridY, W, gridH)

      for (let row = 0; row < 28; row++) {
        const t = row / 28
        const py = gridY + Math.pow(t, 1.7) * gridH
        const a = Math.max(0, 0.35 * (1 - t))
        ctx.strokeStyle = `rgba(255,42,105,${a})`; ctx.lineWidth = 0.8
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke()
      }
      for (let col = 0; col < 44; col++) {
        const vx = W / 2 + (col - 22) * 180
        ctx.beginPath(); ctx.moveTo(vx, gridY)
        for (let row = 0; row <= 28; row++) {
          const rt = row / 28
          const py = gridY + Math.pow(rt, 1.7) * gridH
          const vxf = W / 2 + (vx - W / 2) * (1 + rt * 2.2)
          ctx.lineTo(vxf, py)
        }
        ctx.strokeStyle = 'rgba(255,42,105,0.025)'; ctx.lineWidth = 0.6; ctx.stroke()
      }

      const fog = ctx.createLinearGradient(0, gridY, 0, H)
      fog.addColorStop(0, 'rgba(4,0,16,0.92)')
      fog.addColorStop(0.2, 'rgba(4,0,16,0.5)')
      fog.addColorStop(0.55, 'rgba(4,0,16,0.25)')
      fog.addColorStop(1, 'rgba(4,0,16,0.88)')
      ctx.fillStyle = fog; ctx.fillRect(0, gridY, W, gridH)
      ctx.restore()

      // ── SCANLINES ──
      ctx.fillStyle = 'rgba(0,0,0,0.025)'
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1)

      // ── CHROMATIC ABERRATION ──
      ctx.fillStyle = `rgba(255,15,40,${0.004 + 0.003 * Math.sin(ts * 0.001)})`; ctx.fillRect(2, 0, W, H)
      ctx.fillStyle = `rgba(15,80,255,${0.003 + 0.002 * Math.cos(ts * 0.0013)})`; ctx.fillRect(-1, 0, W, H)

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={canvasRef} style={{ position:'absolute',inset:0,zIndex:0,pointerEvents:'none' }} />
}
