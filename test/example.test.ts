import { describe, it, expect } from 'vitest'
import { hello } from '../src/example'

describe('example', () => {
  it('should return hello world', () => {
    expect(hello).toBe('Hello, world!')
  })
}) 
