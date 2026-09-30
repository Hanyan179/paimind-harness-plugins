/** One source for the client identity and its static, source-owned manifest. */
export const PRODUCT_NAME = 'Paramont Harness'
export const MANIFEST_PATH = '/plugins/@paimind/branding/manifest.webmanifest'
export const MANIFEST_JSON = JSON.stringify({
  name: PRODUCT_NAME,
  short_name: 'Paramont',
  display: 'standalone',
  start_url: '/',
})
