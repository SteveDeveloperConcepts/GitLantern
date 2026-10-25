// Background / text pairs, readable on the dark and light themes.
const TONES: [string, string][] = [
  ['#3a2d17', '#e8a33d'],
  ['#173a2a', '#4cc38a'],
  ['#172a3a', '#6aa9ff'],
  ['#3a1730', '#e5649a'],
  ['#2a1f3d', '#a78bfa'],
  ['#163536', '#2fb8b8']
]

function hash(text: string): number {
  let value = 0
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) | 0
  return Math.abs(value)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` : (parts[0]?.slice(0, 2) ?? '?')
  return letters.toUpperCase()
}

/** Initials in a colored circle; the color is stable per email (or name). */
export function Avatar({ name, email, size = 20 }: { name: string; email?: string; size?: number }) {
  const [background, color] = TONES[hash(email || name) % TONES.length] ?? TONES[0]!
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background, color, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
