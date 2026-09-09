const INFO_RIGHT = 1262;
const INFO_TOP = 38;
const INFO_WIDTH_OPTIONS = Object.freeze([264, 312, 370, 394]);
const INFO_MAX_HEIGHT = 622;

export const IMU_THRESHOLD_PERCENT = 60;
export const IMU_VALUE_COLORS = Object.freeze({
  below_threshold: "#C00000",
  at_or_above_threshold: "#008000",
});

export const INFO_FIELD_SPECS = Object.freeze([
  Object.freeze({
    key: "suggested_retail",
    sourceField: "Retail",
    label: "Suggested Retail",
    metaKeys: Object.freeze(["retail", "Retail"]),
    format: "currency",
  }),
  Object.freeze({
    key: "imu",
    sourceField: "New DO IMU",
    label: "IMU",
    metaKeys: Object.freeze(["imu", "new_do_imu", "New DO IMU"]),
    format: "percent",
  }),
  Object.freeze({
    key: "quantity",
    sourceField: "Inner Qty",
    label: "Quantity",
    metaKeys: Object.freeze(["quantity", "inner_qty", "Inner Qty"]),
  }),
  Object.freeze({
    key: "materials",
    sourceField: "Product Spec",
    label: "Materials",
    metaKeys: Object.freeze(["materials", "product_spec", "Product Spec"]),
  }),
  Object.freeze({
    key: "package_dimensions",
    sourceField: "Item Packaging Spec",
    label: "Package Dimensions",
    metaKeys: Object.freeze(["pkg_dimensions", "item_packaging_spec", "Item Packaging Spec"]),
    format: "package_dimensions",
  }),
  Object.freeze({
    key: "packaging",
    sourceField: "Packaging Type",
    label: "Packaging",
    metaKeys: Object.freeze(["packaging", "packaging_type", "Packaging Type"]),
  }),
]);

export function scalarText(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(scalarText).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    if ("text" in value) return scalarText(value.text);
    if ("name" in value) return scalarText(value.name);
    return "";
  }
  return String(value).replace(/\r\n?/g, "\n").trim();
}

export function compactText(value) {
  return scalarText(value).replace(/\s+/g, " ").trim();
}

export function containsForbiddenPlaceholder(value) {
  const text = scalarText(value);
  return /\bTBD\b/i.test(text) || /…/.test(text) || /\.{3}/.test(text);
}

export function canonicalFieldValue(value) {
  return compactText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function valueFor(meta, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(meta || {}, key)) continue;
    const value = meta[key];
    if (compactText(value)) return value;
  }
  return "";
}

export function formatRetail(value) {
  const text = compactText(value);
  if (!text) return "";
  const numeric = Number(text.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric)) return text;
  return `$${numeric.toFixed(2)}`;
}

export function formatImu(value) {
  const text = compactText(value);
  if (!text) return "";
  if (/^-?\d+(?:\.\d+)?\s*%$/.test(text)) {
    return `${Math.round(Number(text.replace("%", "")))}%`;
  }
  const numeric = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return text;
  const percentage = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${Math.round(percentage)}%`;
}

export function imuValueColor(value) {
  const rendered = formatImu(value);
  const match = rendered.match(/^(-?\d+)%$/);
  if (!match) return null;
  return Number(match[1]) < IMU_THRESHOLD_PERCENT
    ? IMU_VALUE_COLORS.below_threshold
    : IMU_VALUE_COLORS.at_or_above_threshold;
}

export function cleanPackageDimensions(value, packagingType) {
  const raw = scalarText(value);
  if (!raw) return { value: "", transform: null };
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const packaging = compactText(packagingType);
  let transform = null;
  if (
    lines.length
    && packaging
    && canonicalFieldValue(lines[0]) === canonicalFieldValue(packaging)
  ) {
    lines.shift();
    transform = "remove_packaging_type_prefix";
  }
  return { value: lines.join(" ").replace(/\s+/g, " ").trim(), transform };
}

function transformField(spec, rawValue, meta) {
  if (spec.format === "currency") {
    return { value: formatRetail(rawValue), transform: compactText(rawValue) ? "format_usd" : null };
  }
  if (spec.format === "percent") {
    return { value: formatImu(rawValue), transform: compactText(rawValue) ? "format_integer_percent" : null };
  }
  if (spec.format === "package_dimensions") {
    const packaging = valueFor(meta, ["packaging", "packaging_type", "Packaging Type"]);
    return cleanPackageDimensions(rawValue, packaging);
  }
  return { value: compactText(rawValue), transform: null };
}

export function buildInfoFields(meta = {}) {
  return INFO_FIELD_SPECS.map((spec) => {
    const sourceFields = meta && typeof meta.source_fields === "object"
      ? meta.source_fields
      : {};
    const rawValue = Object.prototype.hasOwnProperty.call(sourceFields, spec.sourceField)
      ? sourceFields[spec.sourceField]
      : valueFor(meta, spec.metaKeys);
    const rawText = scalarText(rawValue);
    const transformMeta = {
      ...meta,
      ...(Object.prototype.hasOwnProperty.call(sourceFields, "Packaging Type")
        ? { "Packaging Type": sourceFields["Packaging Type"] }
        : {}),
    };
    const transformed = transformField(spec, rawValue, transformMeta);
    const renderedValue = compactText(transformed.value);
    return {
      key: spec.key,
      source_field: spec.sourceField,
      label: spec.label,
      raw_value: rawText,
      rendered_value: renderedValue,
      displayed: Boolean(renderedValue),
      transform: transformed.transform,
      value_color: spec.key === "imu" && renderedValue ? imuValueColor(renderedValue) : null,
    };
  });
}

export function productTitle(meta = {}, manifestEntry = {}) {
  const raw = valueFor(meta, ["item_description", "Item Description", "title"])
    || manifestEntry.title
    || meta.item_no
    || manifestEntry.item_no;
  return compactText(raw).toUpperCase();
}

export function estimatedTextWidth(text, fontSizePx) {
  let units = 0;
  for (const character of String(text || "")) {
    if (/\s/.test(character)) units += 0.3;
    else if (/[,.;:!|/\\()[\]{}'"`\-–—+]/.test(character)) units += 0.36;
    else if (/[A-Z]/.test(character)) units += 0.64;
    else if (/[a-z]/.test(character)) units += 0.52;
    else if (/[0-9]/.test(character)) units += 0.56;
    else units += 1;
  }
  return units * Number(fontSizePx || 0);
}

export function estimateWrappedLines(text, widthPx, fontSizePx) {
  const words = compactText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let lines = 1;
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && estimatedTextWidth(candidate, fontSizePx) > widthPx) {
      lines += 1;
      line = word;
    } else {
      line = candidate;
    }
  }
  return lines;
}

function infoHeight(fields, width) {
  const innerWidth = Math.max(1, width - 8);
  const bodyFontPx = 10 * 96 / 72;
  const headingHeight = 20;
  const rowLineHeight = 15;
  const rows = fields.filter((field) => field.displayed).reduce((sum, field) => (
    sum + estimateWrappedLines(`${field.label}: ${field.rendered_value}`, innerWidth, bodyFontPx)
  ), 0);
  return Math.max(159, Math.ceil(headingHeight + rows * rowLineHeight + 4));
}

export function planInfoBox(fields, options = {}) {
  const right = Number(options.right ?? INFO_RIGHT);
  const top = Number(options.top ?? INFO_TOP);
  const widths = options.widthOptions || INFO_WIDTH_OPTIONS;
  const compactTarget = Number(options.compactTarget ?? 260);
  let selected = null;
  for (const width of widths) {
    const height = infoHeight(fields, width);
    selected = { left: right - width, top, width, height };
    if (height <= compactTarget) break;
  }
  if (!selected || selected.height > INFO_MAX_HEIGHT) {
    const height = selected?.height ?? 0;
    const error = new Error(`INFO_OVERFLOW: information block requires ${height}px`);
    error.code = "INFO_OVERFLOW";
    throw error;
  }
  return selected;
}

export function assertTitleFits(title, width = 640, fontSizePt = 18) {
  const fontSizePx = fontSizePt * 96 / 72;
  if (estimatedTextWidth(title, fontSizePx) <= width * 0.97) return;
  const error = new Error(`TITLE_OVERFLOW: ${JSON.stringify(title)} does not fit ${width}px at ${fontSizePt}pt`);
  error.code = "TITLE_OVERFLOW";
  throw error;
}

export function planTitleLayout(title, options = {}) {
  const left = Number(options.left ?? 621);
  const top = Number(options.top ?? 8);
  const width = Number(options.width ?? 640);
  const fontSizePt = Number(options.fontSizePt ?? 18);
  const fontSizePx = fontSizePt * 96 / 72;
  const lines = estimateWrappedLines(title, width * 0.97, fontSizePx);
  if (lines < 1 || lines > 2) {
    const error = new Error(`TITLE_OVERFLOW: ${JSON.stringify(title)} requires ${lines} lines at ${fontSizePt}pt`);
    error.code = "TITLE_OVERFLOW";
    throw error;
  }
  const box = lines === 1
    ? { left, top, width, height: 39 }
    : { left, top: 4, width, height: 58 };
  return {
    box,
    lines,
    font_size_pt: fontSizePt,
    info_top: lines === 1 ? INFO_TOP : box.top + box.height + 6,
  };
}

export function formatGenerationDate(value) {
  const input = compactText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const error = new Error(`GENERATION_DATE_INVALID: expected YYYY-MM-DD, received ${JSON.stringify(value)}`);
    error.code = "GENERATION_DATE_INVALID";
    throw error;
  }
  const date = new Date(`${input}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input) {
    const error = new Error(`GENERATION_DATE_INVALID: ${JSON.stringify(value)}`);
    error.code = "GENERATION_DATE_INVALID";
    throw error;
  }
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const INFO_GEOMETRY = Object.freeze({
  right: INFO_RIGHT,
  top: INFO_TOP,
  widthOptions: INFO_WIDTH_OPTIONS,
  maxHeight: INFO_MAX_HEIGHT,
});
