import {
  CatalogLayoutError,
  LAYOUT_IDS,
  layoutForRenderCount,
} from "./layout_engine.mjs";

// 13.333 x 7.5 in at 96 px/in, matching the supplied source deck.
export const CANVAS = Object.freeze({ width: 1280, height: 720 });

export const GEOMETRY = Object.freeze({
  canvas: CANVAS,
  footerTop: 684,
  // Source slide 18 keeps slide content above the angled footer. The first
  // footer paint starts before its nominal placeholder top, so 636px is the
  // actual visual-safe bottom measured from the authoritative source slide.
  contentBottom: 636,
  infoRight: 1262,
  infoTop: 38,
  infoTopMax: 102,
  infoMaxWidth: 394,
  infoWidthOptions: Object.freeze([264, 312, 370, 394]),
  visualLeft: 32,
  visualTop: 64,
  visualGap: 24,
  cellGap: 24,
});

export const INFO_ZONE = Object.freeze({
  left: GEOMETRY.infoRight - GEOMETRY.infoMaxWidth,
  top: GEOMETRY.infoTop,
  width: GEOMETRY.infoMaxWidth,
  height: GEOMETRY.contentBottom - GEOMETRY.infoTop,
});

export const DEFAULT_INFO_BOX = Object.freeze({
  left: GEOMETRY.infoRight - 312,
  top: GEOMETRY.infoTop,
  width: 312,
  height: 260,
});

function fail(code, message, details) {
  throw new CatalogLayoutError(code, message, details);
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail("GEOMETRY_INVALID", `${field} must be finite`);
  return number;
}

function cloneBox(box, name = "box") {
  if (!box || typeof box !== "object") fail("GEOMETRY_INVALID", `${name} is required`);
  const normalized = {
    left: finiteNumber(box.left, `${name}.left`),
    top: finiteNumber(box.top, `${name}.top`),
    width: finiteNumber(box.width, `${name}.width`),
    height: finiteNumber(box.height, `${name}.height`),
  };
  if (normalized.width <= 0 || normalized.height <= 0) {
    fail("GEOMETRY_INVALID", `${name} must have positive width and height`);
  }
  return normalized;
}

export function boxArea(box) {
  return Math.max(0, Number(box?.width) || 0) * Math.max(0, Number(box?.height) || 0);
}

export function boxesOverlap(first, second) {
  return (
    first.left < second.left + second.width
    && first.left + first.width > second.left
    && first.top < second.top + second.height
    && first.top + first.height > second.top
  );
}

export function inset(box, padding) {
  const amount = Math.max(0, Number(padding) || 0);
  return {
    left: box.left + amount,
    top: box.top + amount,
    width: Math.max(1, box.width - amount * 2),
    height: Math.max(1, box.height - amount * 2),
  };
}

export function weightedSplit(box, axis, weights, gap = GEOMETRY.cellGap) {
  if (!Array.isArray(weights) || !weights.length || weights.some((value) => !(Number(value) > 0))) {
    fail("GEOMETRY_INVALID", "weightedSplit requires positive weights");
  }
  if (!["x", "y"].includes(axis)) fail("GEOMETRY_INVALID", `unsupported split axis ${axis}`);
  const source = cloneBox(box);
  const horizontal = axis === "x";
  const gapTotal = gap * (weights.length - 1);
  const available = (horizontal ? source.width : source.height) - gapTotal;
  if (available <= 0) fail("GEOMETRY_INVALID", "split gaps consume the available field");
  const totalWeight = weights.reduce((sum, value) => sum + Number(value), 0);
  let cursor = horizontal ? source.left : source.top;
  return weights.map((weight) => {
    const size = available * Number(weight) / totalWeight;
    const result = horizontal
      ? { left: cursor, top: source.top, width: size, height: source.height }
      : { left: source.left, top: cursor, width: source.width, height: size };
    cursor += size + gap;
    return result;
  });
}

export function equalStack(box, axis, count, gap = GEOMETRY.cellGap) {
  if (!Number.isInteger(count) || count < 1) {
    fail("GEOMETRY_INVALID", "equalStack requires an integer count >= 1");
  }
  return weightedSplit(box, axis, Array.from({ length: count }, () => 1), gap);
}

/**
 * Return a centered contain frame. Upscaling is allowed by default because the
 * generator must automatically enlarge Product Render images to their cells.
 */
export function aspectPlace(asset, box, options = {}) {
  const field = inset(cloneBox(box), options.padding ?? 0);
  const sourceWidth = Math.max(1, Number(asset?.width) || 1);
  const sourceHeight = Math.max(1, Number(asset?.height) || 1);
  const maximumWidth = Math.min(field.width, Number(options.maxWidth) || field.width);
  const maximumHeight = Math.min(field.height, Number(options.maxHeight) || field.height);
  let scale = Math.min(maximumWidth / sourceWidth, maximumHeight / sourceHeight);
  if (options.noEnlarge) scale = Math.min(scale, 1);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const alignX = Math.max(0, Math.min(1, options.alignX ?? 0.5));
  const alignY = Math.max(0, Math.min(1, options.alignY ?? 0.5));
  return {
    left: field.left + (field.width - width) * alignX,
    top: field.top + (field.height - height) * alignY,
    width,
    height,
  };
}

export const containFrame = aspectPlace;

export function normalizeInfoBox(infoBox = DEFAULT_INFO_BOX) {
  const box = cloneBox(infoBox, "infoBox");
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  if (Math.abs(right - GEOMETRY.infoRight) > 1) {
    fail(
      "INFO_ANCHOR_INVALID",
      `information box must end at x=${GEOMETRY.infoRight}; received ${right}`,
    );
  }
  if (box.top < GEOMETRY.infoTop - 1 || box.top > GEOMETRY.infoTopMax + 1) {
    fail(
      "INFO_ANCHOR_INVALID",
      `information box top must stay within ${GEOMETRY.infoTop}-${GEOMETRY.infoTopMax}; received ${box.top}`,
    );
  }
  if (box.width > GEOMETRY.infoMaxWidth + 1) {
    fail("INFO_OVERFLOW", `information box width ${box.width} exceeds ${GEOMETRY.infoMaxWidth}`);
  }
  if (bottom > GEOMETRY.contentBottom + 1) {
    fail("INFO_OVERFLOW", `information box bottom ${bottom} exceeds ${GEOMETRY.contentBottom}`);
  }
  return box;
}

/**
 * The caller measures information first and passes its final box here. The
 * visual field then consumes all safe space to the left of that anchored box.
 */
export function zonesForInfo(infoBox = DEFAULT_INFO_BOX) {
  const info = normalizeInfoBox(infoBox);
  const visualRight = info.left - GEOMETRY.visualGap;
  const visual = {
    left: GEOMETRY.visualLeft,
    top: GEOMETRY.visualTop,
    width: visualRight - GEOMETRY.visualLeft,
    height: GEOMETRY.contentBottom - GEOMETRY.visualTop,
  };
  if (visual.width < 240 || visual.height < 240) {
    fail("INFO_OVERFLOW", "information box leaves no usable Product Render field");
  }
  return Object.freeze({
    canvas: { ...CANVAS },
    info,
    visual,
    footer: {
      left: 0,
      top: GEOMETRY.footerTop,
      width: CANVAS.width,
      height: CANVAS.height - GEOMETRY.footerTop,
    },
  });
}

function gridCells(layoutId, visual) {
  if (layoutId === "render_0") return [];
  if (layoutId === "render_1") return [{ ...visual }];
  if (layoutId === "render_2") return equalStack(visual, "x", 2);
  if (layoutId === "render_3") return equalStack(visual, "x", 3);
  if (layoutId === "render_4") {
    const rows = equalStack(visual, "y", 2);
    return rows.flatMap((row) => equalStack(row, "x", 2));
  }
  fail("LAYOUT_FAMILY_UNSUPPORTED", `unknown deterministic layout ${layoutId}`);
}

function imageSlot(asset, index, box) {
  return Object.freeze({
    slotId: `render-${index + 1}`,
    semanticRole: "product_render",
    asset,
    box,
    padding: 12,
    stageFill: "transparent",
    fit: "contain",
  });
}

/**
 * Minimal production planning API. It computes stable cells from an image
 * count without requiring asset objects or any semantic classification.
 */
export function resolveCountLayout({ imageCount, infoBox = DEFAULT_INFO_BOX } = {}) {
  const layoutRule = layoutForRenderCount(imageCount);
  const zones = zonesForInfo(infoBox);
  const cells = gridCells(layoutRule, zones.visual);
  const slots = Object.freeze(cells.map((box, index) => Object.freeze({
    slot_id: `render-${index + 1}`,
    box,
    fit: "contain",
  })));
  return Object.freeze({
    layout_rule: layoutRule,
    visual_field: zones.visual,
    info_box: zones.info,
    slots,
  });
}

export function assertGeometry({ family, layoutId, infoBox, slots = [], zones } = {}) {
  const resolvedFamily = layoutId || family;
  const definitionCount = LAYOUT_IDS.indexOf(resolvedFamily);
  if (definitionCount < 0) {
    fail("LAYOUT_FAMILY_UNSUPPORTED", `unknown deterministic layout ${resolvedFamily}`);
  }
  const resolvedZones = zones || zonesForInfo(infoBox);
  if (slots.length !== definitionCount) {
    fail(
      "LAYOUT_COUNT_MISMATCH",
      `${resolvedFamily} requires ${definitionCount} slots; received ${slots.length}`,
    );
  }
  for (const item of slots) {
    const box = cloneBox(item.box, `${resolvedFamily}/${item.slotId}`);
    const visual = resolvedZones.visual;
    if (
      box.left < visual.left - 0.01
      || box.top < visual.top - 0.01
      || box.left + box.width > visual.left + visual.width + 0.01
      || box.top + box.height > visual.top + visual.height + 0.01
    ) {
      fail("GEOMETRY_OUT_OF_BOUNDS", `${resolvedFamily}/${item.slotId} escapes the visual field`);
    }
    if (boxesOverlap(box, resolvedZones.info)) {
      fail("GEOMETRY_OVERLAP", `${resolvedFamily}/${item.slotId} overlaps the information box`);
    }
    if (item.fit !== "contain") {
      fail("IMAGE_FIT_INVALID", `${resolvedFamily}/${item.slotId} must use contain`);
    }
  }
  for (let first = 0; first < slots.length; first += 1) {
    for (let second = first + 1; second < slots.length; second += 1) {
      if (boxesOverlap(slots[first].box, slots[second].box)) {
        fail(
          "GEOMETRY_OVERLAP",
          `${resolvedFamily}/${slots[first].slotId} overlaps ${slots[second].slotId}`,
        );
      }
    }
  }
  if (slots.length > 1) {
    const areas = slots.map((item) => boxArea(item.box));
    const ratio = Math.max(...areas) / Math.max(1, Math.min(...areas));
    if (ratio > 1.000001) {
      fail("EQUAL_WEIGHT_VIOLATION", `${resolvedFamily} cell area ratio ${ratio.toFixed(6)} exceeds 1`);
    }
  }
  return true;
}

export function resolveComposition({
  family,
  layoutId,
  variant = "fixed",
  infoBox = DEFAULT_INFO_BOX,
  assets = [],
} = {}) {
  if (!Array.isArray(assets)) fail("RENDER_ASSETS_INVALID", "assets must be an array");
  const expectedLayout = layoutForRenderCount(assets.length);
  const resolvedLayout = layoutId || family || expectedLayout;
  if (resolvedLayout !== expectedLayout) {
    fail(
      "LAYOUT_COUNT_MISMATCH",
      `${resolvedLayout} cannot render ${assets.length} Product Render images; expected ${expectedLayout}`,
    );
  }
  if (variant !== "fixed") {
    fail("LAYOUT_VARIANT_UNSUPPORTED", `${resolvedLayout} supports only the fixed variant`);
  }
  const zones = zonesForInfo(infoBox);
  const cells = gridCells(resolvedLayout, zones.visual);
  const slots = Object.freeze(cells.map((box, index) => imageSlot(assets[index], index, box)));
  assertGeometry({ layoutId: resolvedLayout, infoBox: zones.info, slots, zones });
  return Object.freeze({
    layout_id: resolvedLayout,
    family: resolvedLayout,
    variant: "fixed",
    zones,
    slots,
    unusedAssets: Object.freeze([]),
  });
}

export const COMPOSITION_FAMILIES = LAYOUT_IDS;
