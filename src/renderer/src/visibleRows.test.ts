import { describe, expect, it } from 'vitest'
import { visibleRows } from './visibleRows'

const ROW = 32
const VIEW = 320 // Ten rows.

describe('visibleRows', () => {
  it('draws the rows in view and a few past the bottom, from the top of the list', () => {
    expect(visibleRows(1000, ROW, 0, VIEW)).toEqual({ first: 0, last: 18 })
  })

  it('draws everything when the whole list fits', () => {
    expect(visibleRows(5, ROW, 0, VIEW)).toEqual({ first: 0, last: 5 })
  })

  it('follows the scroll, a few rows either side', () => {
    expect(visibleRows(1000, ROW, -ROW * 100, VIEW)).toEqual({ first: 92, last: 118 })
  })

  it('stops at the end of the list', () => {
    expect(visibleRows(1000, ROW, -ROW * 990, VIEW)).toEqual({ first: 982, last: 1000 })
  })

  it('counts a part-scrolled row as in view', () => {
    expect(visibleRows(1000, ROW, -ROW * 100 - 16, VIEW)).toEqual({ first: 92, last: 119 })
  })

  it('takes a list that starts further down the view, under a heading', () => {
    expect(visibleRows(1000, ROW, 64, VIEW)).toEqual({ first: 0, last: 16 })
  })

  it('draws nothing for a list well below the view', () => {
    expect(visibleRows(1000, ROW, VIEW + ROW * 20, VIEW)).toEqual({ first: 0, last: 0 })
  })

  it('draws nothing for a list scrolled well above the view', () => {
    expect(visibleRows(10, ROW, -ROW * 100, VIEW)).toEqual({ first: 0, last: 0 })
  })

  it('still draws the first rows of a list just below the view, ready for the scroll', () => {
    expect(visibleRows(1000, ROW, VIEW + ROW * 2, VIEW)).toEqual({ first: 0, last: 6 })
  })

  it('draws nothing for an empty list', () => {
    expect(visibleRows(0, ROW, 0, VIEW)).toEqual({ first: 0, last: 0 })
  })
})
