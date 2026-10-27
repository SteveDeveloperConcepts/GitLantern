/** Image types the image diff can show, by lower-case file extension. */
const IMAGE_TYPES = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['bmp', 'image/bmp'],
  ['ico', 'image/x-icon'],
  ['svg', 'image/svg+xml'],
  ['avif', 'image/avif']
])

/** The MIME type of an image file, going by its extension (any case); null when it isn't an image GitLantern can show. */
export function imageMime(path: string): string | null {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  if (dot === -1) return null
  return IMAGE_TYPES.get(name.slice(dot + 1).toLowerCase()) ?? null
}
