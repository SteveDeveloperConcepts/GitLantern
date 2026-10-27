import { describe, expect, it } from 'vitest'
import { imageMime } from './images'

describe('imageMime', () => {
  it('knows the image types the diff can show', () => {
    expect(imageMime('logo.png')).toBe('image/png')
    expect(imageMime('photos/Holiday.JPG')).toBe('image/jpeg')
    expect(imageMime('a.jpeg')).toBe('image/jpeg')
    expect(imageMime('anim.gif')).toBe('image/gif')
    expect(imageMime('a.webp')).toBe('image/webp')
    expect(imageMime('a.bmp')).toBe('image/bmp')
    expect(imageMime('favicon.ico')).toBe('image/x-icon')
    expect(imageMime('icons/arrow.svg')).toBe('image/svg+xml')
    expect(imageMime('a.avif')).toBe('image/avif')
    expect(imageMime('C:\\repo\\art\\a.png')).toBe('image/png')
  })

  it('returns null for anything else', () => {
    expect(imageMime('readme.md')).toBeNull()
    expect(imageMime('png')).toBeNull()
    expect(imageMime('a.png.txt')).toBeNull()
    expect(imageMime('folder.png/readme')).toBeNull()
    expect(imageMime('a.')).toBeNull()
    expect(imageMime('a.constructor')).toBeNull()
    expect(imageMime('')).toBeNull()
  })
})
