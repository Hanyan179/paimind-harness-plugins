import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentType } from 'react'
import { createClientContextFixture } from '@paimind/testkit'
import { apply } from '../src/client/index.js'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('Paramont branding client contribution', () => {
  it('registers a shell contribution and replaces both native brand seats reversibly', async () => {
    document.head.innerHTML = `
      <title>Planning — DeepSeek Harness</title>
      <link rel="icon" href="/favicon.svg">
      <link rel="manifest" href="/manifest.webmanifest">
    `
    document.body.innerHTML = `
      <button id="expanded"><svg viewBox="0 0 182 24"></svg></button>
      <button id="compact"><svg viewBox="0 0 23.16 17.04"></svg></button>
      <div id="hero"><span id="fish"><svg viewBox="0 0 20 20"></svg></span><span id="headline">探索未至之境</span><span id="preview">预览版</span></div>
    `
    const fixture = createClientContextFixture()
    apply(fixture.context)
    const shell = fixture.slots.find(entry => entry.injectedName === 'shell.overlay')
    expect(shell?.options).toMatchObject({ id: 'paimind-branding', order: -100 })
    expect(fixture.slots.find(entry => entry.injectedName === 'paimind.extension')?.options)
      .toMatchObject({ id: 'paimind:branding' })

    const Branding = shell?.component as ComponentType
    const view = render(<Branding />)
    await waitFor(() => expect(screen.getAllByLabelText('Paramont Harness')).toHaveLength(2))
    expect(document.querySelector('[data-paimind-paramont-mark] path')?.getAttribute('d')).toContain('M302.1 0 89.4 174.4')
    expect(document.querySelectorAll('[data-paimind-paramont-wordmark] path')).toHaveLength(8)
    expect(document.querySelector('#expanded')).toHaveAttribute('data-paimind-brand-seat', 'wordmark')
    expect(document.querySelector('#compact')).toHaveAttribute('data-paimind-brand-seat', 'compact')
    expect(document.querySelectorAll('[data-paimind-native-brand-art]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-paimind-native-hero-brand]')).toHaveLength(2)
    expect(screen.getByText('共攀高山之巅')).toBeInTheDocument()
    expect(screen.getByText('预览版')).toBeInTheDocument()
    expect(document.querySelector('[data-paimind-paramont-hero-mark] path')?.getAttribute('d')).toContain('M302.1 0 89.4 174.4')
    expect(document.title).toBe('Planning — Paramont Harness')
    expect(document.querySelector('style[data-paimind-plugin="@paimind/branding"]')).not.toBeNull()

    const nativeHeadline = document.querySelector('#headline')
    const nativePreview = document.querySelector('#preview')
    if (nativeHeadline === null || nativePreview === null) throw new Error('hero fixture is incomplete')
    nativeHeadline.textContent = 'Into the Unknown'
    nativePreview.textContent = 'Preview'
    await waitFor(() => expect(screen.getByText('Reach New Heights')).toBeInTheDocument())
    expect(screen.getByText('Preview')).toBeInTheDocument()

    view.unmount()
    fixture.disposeEffects()
    expect(document.querySelector('[data-paimind-brand-seat]')).toBeNull()
    expect(document.querySelector('[data-paimind-native-brand-art]')).toBeNull()
    expect(document.querySelector('[data-paimind-native-hero-brand]')).toBeNull()
    expect(document.querySelector('[data-paimind-hero-brand-seat]')).toBeNull()
    expect(document.title).toBe('Planning — DeepSeek Harness')
    expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href')).toBe('/favicon.svg')
    expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest')
  })
})
