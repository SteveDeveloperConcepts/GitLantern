import { describe, expect, it } from 'vitest'
import { addToast, MAX_TOASTS, toastDetail, type Toast } from './toasts'

const toast = (id: number, title = `t${id}`): Toast => ({ id, tone: 'ok', title })

describe('toasts', () => {
  it('keeps the newest few, and lets a repeat replace its twin', () => {
    let list: Toast[] = []
    for (let id = 1; id <= MAX_TOASTS + 2; id++) list = addToast(list, toast(id))
    expect(list.map((t) => t.id)).toEqual([3, 4, 5, 6])
    expect(addToast(list, toast(7, 't4')).map((t) => t.id)).toEqual([3, 5, 6, 7])
  })

  it('shortens an error to its first line', () => {
    expect(toastDetail('\nPush refused: origin/main has 2 commits\n\nmore detail')).toBe('Push refused: origin/main has 2 commits')
    expect(toastDetail('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
