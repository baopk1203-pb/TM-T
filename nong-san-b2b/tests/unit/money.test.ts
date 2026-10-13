import { describe, it, expect } from 'vitest'
import {
  formatVND,
  gramsToKg,
  kgToGrams,
  gramsToKgText,
  formatPercent,
} from '@/lib/money'

describe('Money and Weight Utilities', () => {
  describe('formatVND', () => {
    it('formats positive integers to VND string correctly', () => {
      // vi-VN format uses period as thousands separator in node
      const formatted = formatVND(150000)
      expect(formatted).toContain('150')
      expect(formatted).toContain('000')
      expect(formatted).toContain('đ')
    })

    it('formats large B2B order totals correctly', () => {
      const formatted = formatVND(15277500)
      expect(formatted).toContain('15')
      expect(formatted).toContain('277')
      expect(formatted).toContain('500')
      expect(formatted).toContain('đ')
    })

    it('handles zero, null, undefined and NaN', () => {
      expect(formatVND(0)).toBe('0 đ')
      expect(formatVND(null)).toBe('0 đ')
      expect(formatVND(undefined)).toBe('0 đ')
      expect(formatVND(NaN)).toBe('0 đ')
    })
  })

  describe('gramsToKg and kgToGrams', () => {
    it('converts gram to kg correctly', () => {
      expect(gramsToKg(50000)).toBe(50)
      expect(gramsToKg(205500)).toBe(205.5)
      expect(gramsToKg(0)).toBe(0)
    })

    it('converts kg to gram correctly', () => {
      expect(kgToGrams(50)).toBe(50000)
      expect(kgToGrams(205.5)).toBe(205500)
      expect(kgToGrams(0)).toBe(0)
    })

    it('maintains round-trip identity', () => {
      const originalGrams = 125000
      expect(kgToGrams(gramsToKg(originalGrams))).toBe(originalGrams)
    })
  })

  describe('gramsToKgText', () => {
    it('formats gram to friendly kg text', () => {
      expect(gramsToKgText(50000)).toContain('50')
      expect(gramsToKgText(50000)).toContain('kg')
      expect(gramsToKgText(205500)).toContain('kg')
    })
  })

  describe('formatPercent', () => {
    it('formats percentage correctly', () => {
      expect(formatPercent(5)).toBe('5%')
      expect(formatPercent(0)).toBe('0%')
      expect(formatPercent(10)).toBe('10%')
    })
  })
})
