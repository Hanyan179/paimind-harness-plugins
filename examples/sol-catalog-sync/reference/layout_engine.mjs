/**
 * Deterministic product-render layout selection.
 *
 * Production layout is intentionally count-driven. Image roles, orientation,
 * source dimensions, item number, previous pages, and model output never
 * influence the selected layout.
 */

export const MAX_RENDER_IMAGES = 4;

export const LAYOUT_IDS = Object.freeze([
  "render_0",
  "render_1",
  "render_2",
  "render_3",
  "render_4",
]);

// Kept as public names because the renderer and the transitional builder use
// the former registry-shaped API. The registry now contains only count rules.
export const SCENE_MODES = LAYOUT_IDS;
export const FAMILY_IDS = LAYOUT_IDS;

function fixedVariant(familyId) {
  return Object.freeze({
    variant_id: "fixed",
    silhouette_id: familyId,
  });
}

export const FAMILY_REGISTRY = Object.freeze(Object.fromEntries(
  LAYOUT_IDS.map((familyId, renderCount) => [
    familyId,
    Object.freeze({
      family_id: familyId,
      kind: "product",
      render_count: renderCount,
      variants: Object.freeze([fixedVariant(familyId)]),
    }),
  ]),
));

export class CatalogLayoutError extends Error {
  constructor(code, message, details = undefined) {
    super(`${code}: ${message}`);
    this.name = "CatalogLayoutError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new CatalogLayoutError(code, message, details);
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    fail("RENDER_COUNT_INVALID", `render image count must be a non-negative integer; received ${value}`);
  }
  return count;
}

export function layoutForRenderCount(value) {
  const count = normalizeCount(value);
  if (count > MAX_RENDER_IMAGES) {
    fail(
      "RENDER_COUNT_UNSUPPORTED",
      `received ${count} Product Render images; supported range is 0-${MAX_RENDER_IMAGES}`,
      { render_count: count, max_render_images: MAX_RENDER_IMAGES },
    );
  }
  return LAYOUT_IDS[count];
}

export const layoutForImageCount = layoutForRenderCount;

function imageKey(image, index) {
  return String(image?.id || image?.name || image?.local_name || `render-${index + 1}`);
}

function imageOrientation(image) {
  if (["portrait", "square", "landscape"].includes(image?.orientation)) {
    return image.orientation;
  }
  const width = Math.max(0, Number(image?.width) || 0);
  const height = Math.max(0, Number(image?.height) || 0);
  if (!width || !height) return "square";
  const ratio = width / height;
  if (ratio < 0.82) return "portrait";
  if (ratio > 1.25) return "landscape";
  return "square";
}

export function validRenderImages(images = []) {
  if (!Array.isArray(images)) return Object.freeze([]);
  return Object.freeze(images.filter((image) => (
    image
    && image.valid !== false
    && image.decodeValid !== false
  )));
}

/**
 * Classify only by the number of valid Product Render images.
 * Input order is preserved exactly; no role or resolution sorting occurs.
 */
export function classifyScene(images = []) {
  const renderImages = validRenderImages(images);
  const layoutId = layoutForRenderCount(renderImages.length);
  const keys = Object.freeze(renderImages.map(imageKey));
  return Object.freeze({
    mode: layoutId,
    layout_id: layoutId,
    image_count: renderImages.length,
    render_count: renderImages.length,
    primary_orientation: renderImages[0] ? imageOrientation(renderImages[0]) : null,
    emphasis: "equal",
    images: renderImages,
    image_keys: keys,
    roles: Object.freeze({ product_render: renderImages }),
    role_keys: Object.freeze({ product_render: keys }),
  });
}

export const sceneMode = classifyScene;

function resolveScene({ scene, images, compositionAssets } = {}) {
  if (Array.isArray(compositionAssets)) return classifyScene(compositionAssets);
  if (scene?.mode && Number.isInteger(scene.image_count)) {
    const expected = layoutForRenderCount(scene.image_count);
    if (scene.mode !== expected) {
      fail(
        "LAYOUT_COUNT_MISMATCH",
        `scene mode ${scene.mode} does not match ${scene.image_count} render images (${expected})`,
      );
    }
    return scene;
  }
  return classifyScene(images);
}

export function compatibleFamilies(options = {}) {
  return Object.freeze([resolveScene(options).mode]);
}

export function compatibleVariants(familyId, { imageCount } = {}) {
  const definition = FAMILY_REGISTRY[familyId];
  if (!definition) {
    fail("LAYOUT_FAMILY_UNSUPPORTED", `unknown deterministic layout ${familyId}`);
  }
  if (imageCount !== undefined && normalizeCount(imageCount) !== definition.render_count) {
    return Object.freeze([]);
  }
  return definition.variants;
}

/**
 * Transitional state shape for callers that have not yet removed scheduler
 * plumbing. Production selection does not read or mutate any of these fields.
 */
export function createSelectionState(initial = {}) {
  return {
    familyUsage: { ...(initial?.familyUsage || {}) },
    variantUsage: { ...(initial?.variantUsage || {}) },
    recentFamilies: Array.isArray(initial?.recentFamilies)
      ? initial.recentFamilies.slice()
      : [],
    recentSilhouettes: Array.isArray(initial?.recentSilhouettes)
      ? initial.recentSilhouettes.slice()
      : [],
  };
}

/**
 * Select the one layout allowed for the render count. Additional properties
 * are accepted for transitional callers but deliberately ignored.
 */
export function selectComposition(options = {}) {
  const scene = resolveScene(options);
  const familyId = scene.mode;
  const variant = FAMILY_REGISTRY[familyId].variants[0];
  const nextState = createSelectionState(options.state);
  return Object.freeze({
    scene_mode: familyId,
    layout_id: familyId,
    render_count: scene.image_count,
    emphasis: "equal",
    family_id: familyId,
    variant_id: variant.variant_id,
    silhouette_id: variant.silhouette_id,
    eligible_families: Object.freeze([familyId]),
    selection_reason: "product_render_count",
    forced_repeat_reason: null,
    role_assignments: Object.freeze({ product_render: scene.image_keys }),
    nextState,
  });
}

export const selectCountLayout = selectComposition;

export function selectDetailComposition() {
  fail("DETAIL_SHEETS_UNSUPPORTED", "deterministic SKU generation does not create detail sheets");
}

/**
 * Deprecated transitional exports. They remain only because the builder still
 * imports them while it is being migrated. None affects count-driven layout.
 */
export function normalizeImageRole() {
  return "product_render";
}

export function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const LEGACY_INFO_KEYS = Object.freeze([
  "retail", "pkg_dimensions", "dimensions", "size", "materials",
  "features", "function", "moq", "packaging", "quantity", "brand",
  "age_grade", "weight", "upc",
]);

export function infoDensity(meta = {}) {
  return LEGACY_INFO_KEYS.reduce((count, key) => {
    const value = meta[key];
    return count + (value !== undefined && value !== null && value !== "" ? 1 : 0);
  }, 0);
}

export function productArchetype() {
  return "product_render";
}
