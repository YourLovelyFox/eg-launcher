/** Renders only the Minecraft skin face (head) from a player UUID. */

type Props = {
  uuid?: string | null
  username?: string | null
  size?: number
  className?: string
}

function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase()
}

export function playerHeadUrl(uuid: string, size = 64): string {
  const id = normalizeUuid(uuid)
  // mc-heads serves a cropped face with helmet overlay
  return `https://mc-heads.net/avatar/${id}/${size}`
}

export function PlayerHead({ uuid, username, size = 34, className = '' }: Props) {
  const initial = (username?.[0] || '?').toUpperCase()

  if (!uuid) {
    return (
      <div
        className={`player-head placeholder ${className}`.trim()}
        style={{ width: size, height: size }}
        aria-hidden
      >
        {initial}
      </div>
    )
  }

  return (
    <img
      className={`player-head ${className}`.trim()}
      src={playerHeadUrl(uuid, Math.max(size * 2, 64))}
      alt={username ? `${username}'s skin` : 'Player head'}
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
      onError={(e) => {
        // Fallback letter if CDN fails
        const el = e.currentTarget
        el.style.display = 'none'
        const fallback = el.nextElementSibling as HTMLElement | null
        if (fallback) fallback.style.display = 'grid'
      }}
    />
  )
}

/** Face + optional letter fallback sibling for error recovery */
export function PlayerHeadWithFallback({ uuid, username, size = 34, className = '' }: Props) {
  const initial = (username?.[0] || '?').toUpperCase()

  if (!uuid) {
    return (
      <div
        className={`player-head placeholder ${className}`.trim()}
        style={{ width: size, height: size }}
      >
        {initial}
      </div>
    )
  }

  return (
    <span className={`player-head-wrap ${className}`.trim()} style={{ width: size, height: size }}>
      <img
        className="player-head"
        src={playerHeadUrl(uuid, Math.max(size * 2, 64))}
        alt={username ? `${username}'s skin` : 'Player head'}
        width={size}
        height={size}
        draggable={false}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
          const fb = e.currentTarget.parentElement?.querySelector('.player-head.placeholder') as
            | HTMLElement
            | undefined
          if (fb) fb.style.display = 'grid'
        }}
      />
      <div className="player-head placeholder" style={{ display: 'none', width: size, height: size }}>
        {initial}
      </div>
    </span>
  )
}
