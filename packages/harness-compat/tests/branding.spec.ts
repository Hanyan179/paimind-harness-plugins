import { describe, expect, it } from 'vitest'
import {
  brandHarnessDocumentTitle,
  installHarnessDocumentBranding,
  locateHarnessBrandSeats,
  restoreHarnessDocumentTitle,
} from '../src/index.js'

describe('Harness branding compatibility boundary', () => {
  it('locates legacy expanded and compact native brand seats under jsdom 30', () => {
    document.body.innerHTML = `
      <button id="expanded"><svg viewBox="0 0 182 24"></svg></button>
      <button id="compact"><span><svg viewBox="0 0 23.16 17.04"></svg></span></button>
      <div id="hero"><span id="fish"><svg viewBox="0 0 20 20"></svg></span><span id="headline">探索未至之境</span><span id="preview">预览版</span></div>
    `
    const seats = locateHarnessBrandSeats(document)
    expect(seats.wordmark?.host.id).toBe('expanded')
    expect(seats.compact?.host.id).toBe('compact')
    expect(seats.wordmark?.nativeArt.getAttribute('viewBox')).toBe('0 0 182 24')
    expect(seats.hero?.host.id).toBe('hero')
    expect(seats.hero?.nativeIcon.id).toBe('fish')
    expect(seats.hero?.nativeHeadline.id).toBe('headline')
    expect(seats.hero?.nativePreview.id).toBe('preview')
    expect(seats.hero?.locale).toBe('zh')
  })

  it('preserves a live Session prefix while exchanging only the product suffix', () => {
    expect(brandHarnessDocumentTitle('DeepSeek Harness', 'Paramont Harness')).toBe('Paramont Harness')
    expect(brandHarnessDocumentTitle('Quarterly report — DeepSeek Harness', 'Paramont Harness'))
      .toBe('Quarterly report — Paramont Harness')
    expect(brandHarnessDocumentTitle('Unrelated title', 'Paramont Harness')).toBe('Unrelated title')
    expect(restoreHarnessDocumentTitle('Quarterly report — Paramont Harness', 'Paramont Harness'))
      .toBe('Quarterly report — DeepSeek Harness')
  })

  it('locates the hero when the native mark slot contains a custom image or initials', () => {
    document.body.innerHTML = '<div id="hero"><span id="mark"><div data-slot="conversation.hero.brand.mark"><span>HA</span></div></span><span>Into the Unknown</span><span>Preview</span></div>'
    const seats = locateHarnessBrandSeats(document)
    expect(seats.hero?.host.id).toBe('hero')
    expect(seats.hero?.nativeIcon.id).toBe('mark')
    expect(seats.hero?.locale).toBe('en')
  })

  it('applies favicon, manifest and live title reversibly', async () => {
    document.head.innerHTML = `
      <title>DeepSeek Harness</title>
      <link rel="icon" href="/favicon.svg">
      <link rel="manifest" href="/manifest.webmanifest">
    `
    const dispose = installHarnessDocumentBranding(document, {
      productName: 'Paramont Harness',
      faviconHref: 'data:image/svg+xml,paramont',
      manifestHref: 'data:application/manifest+json,paramont',
    })
    expect(document.title).toBe('Paramont Harness')
    expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href).toContain('paramont')
    expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href).toContain('paramont')

    document.title = 'Live session — DeepSeek Harness'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.title).toBe('Live session — Paramont Harness')

    dispose()
    expect(document.title).toBe('Live session — DeepSeek Harness')
    expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href')).toBe('/favicon.svg')
    expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest')
  })
})
