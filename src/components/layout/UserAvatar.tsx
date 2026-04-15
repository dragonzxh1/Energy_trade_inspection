'use client'

import { useState } from 'react'

interface UserAvatarProps {
  src?: string | null
  name?: string | null
}

export default function UserAvatar({ src, name }: UserAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false)

  const initials = name
    ? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  if (src && !imgFailed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={src}
        alt={name ?? 'User avatar'}
        width={28}
        height={28}
        referrerPolicy="no-referrer"
        style={{ borderRadius: '50%', display: 'block' }}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <span
      style={{
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        backgroundColor: 'var(--accent-primary)',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  )
}
