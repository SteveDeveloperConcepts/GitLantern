import { describe, expect, it } from 'vitest'
import { oneAtATime } from './oneAtATime'

/** A load that stays running until `finish` is called, counting its runs. */
function controlledLoad() {
  const finishers: Array<(error?: Error) => void> = []
  const load = () =>
    new Promise<void>((resolve, reject) => {
      finishers.push((error) => (error ? reject(error) : resolve()))
    })
  const started = () => finishers.length
  const finish = async (error?: Error) => {
    finishers.at(-1)?.(error)
    // Let the wrapper's await come back.
    await new Promise((resolve) => setTimeout(resolve))
  }
  return { load, started, finish }
}

describe('oneAtATime', () => {
  it('runs straight away when nothing is running', () => {
    const { load, started } = controlledLoad()
    void oneAtATime(load)()
    expect(started()).toBe(1)
  })

  it('doesn’t start a second run while one is going', async () => {
    const { load, started, finish } = controlledLoad()
    const run = oneAtATime(load)
    void run()
    void run()
    void run()
    expect(started()).toBe(1)
    await finish()
    await finish()
  })

  it('runs once more afterwards, however many calls came in', async () => {
    const { load, started, finish } = controlledLoad()
    const run = oneAtATime(load)
    void run()
    void run()
    void run()
    void run()
    await finish()
    expect(started()).toBe(2)
    await finish()
    expect(started()).toBe(2)
  })

  it('doesn’t run again when nothing was asked for meanwhile', async () => {
    const { load, started, finish } = controlledLoad()
    void oneAtATime(load)()
    await finish()
    expect(started()).toBe(1)
  })

  it('keeps going for a call that arrives during the extra run', async () => {
    const { load, started, finish } = controlledLoad()
    const run = oneAtATime(load)
    void run()
    void run()
    await finish()
    void run()
    await finish()
    expect(started()).toBe(3)
    await finish()
  })

  it('can run again once it has gone quiet', async () => {
    const { load, started, finish } = controlledLoad()
    const run = oneAtATime(load)
    void run()
    await finish()
    void run()
    expect(started()).toBe(2)
    await finish()
  })

  it('isn’t stuck after a failed load', async () => {
    const { load, started, finish } = controlledLoad()
    const run = oneAtATime(load)
    const failed = run()
    const caught = failed.catch((error: unknown) => error)
    await finish(new Error('git failed'))
    expect(await caught).toBeInstanceOf(Error)
    void run()
    expect(started()).toBe(2)
    await finish()
  })
})
