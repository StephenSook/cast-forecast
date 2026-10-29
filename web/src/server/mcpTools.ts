import "server-only";
import { type Bottle, RETAIL_ERROR_L, TONES, type Whitening, findBottle, formatValue, labelUrl } from "@/lib/catalogue";
import { LIGHTNESS_RANGE, ZINC_RANGE, predictInStudy } from "@/lib/labelModel";
import { type LabelModelPayload, labelModelPayload } from "@/server/routes/labelModel";

/**
 * The tools the MCP endpoint (routes/mcp.ts) serves. All three are pure compute over the shipped catalogue and the
 * label model the site itself uses: no YouCam call, no key, no cost. Argument problems come back as tool results with
 * isError (the spec's tool execution errors, which a model can read and correct); only an unknown tool is a protocol
 * error, and that is the caller's job (callTool answers null).
 */

export type TextBlock = { type: "text"; text: string };
export type ToolResult = { content: TextBlock[]; structuredContent?: Record<string, unknown>; isError?: true };
export type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, object>; required?: string[]; additionalProperties: false };
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: false };
};

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const NO_ARGUMENTS = { type: "object", properties: {}, additionalProperties: false } as const;
const [Z_LO, Z_HI] = ZINC_RANGE;
const [L_LO, L_HI] = LIGHTNESS_RANGE;
const SITE_TONES = TONES.map((t) => t.lStar).join(", ");
const STUDY = `${Z_LO} to ${Z_HI}% zinc oxide, skin L* ${L_LO.toFixed(1)} to ${L_HI.toFixed(1)}`;

export const INSTRUCTIONS =
  "Cast Forecast predicts how white a zinc oxide sunscreen looks on skin, as a CIELAB L* change, from the zinc oxide " +
  "percent on its FDA label. Call list_bottles for bottle ids, then predict_cast with a bottle_id and the skin's L*. " +
  "Predictions describe appearance only.";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_bottles",
    title: "List bottles",
    description:
      "Every bottle in the Cast Forecast catalogue: id, name, brand and the evidence behind its prediction (the zinc " +
      "oxide percent on its FDA label, the label's DailyMed set id and effective date), with a link to the label.",
    inputSchema: NO_ARGUMENTS,
    annotations: ANNOTATIONS,
  },
  {
    name: "predict_cast",
    title: "Predict the white cast",
    description:
      "Predicted lightening of skin under a zinc oxide sunscreen (CIELAB L* change, dL*), with its band, from the zinc " +
      "oxide percent on the label. Give bottle_id (from list_bottles) or zinc_oxide_pct, not both, and skin_lightness. " +
      `No prediction outside the study (${STUDY}): the model is never extrapolated. Appearance only.`,
    inputSchema: {
      type: "object",
      properties: {
        bottle_id: { type: "string", description: "A bottle id from list_bottles. Give this or zinc_oxide_pct." },
        zinc_oxide_pct: {
          type: "number",
          minimum: Z_LO,
          maximum: Z_HI,
          description: "Zinc oxide percent from a label's Drug Facts. Give this or bottle_id.",
        },
        skin_lightness: {
          type: "number",
          minimum: L_LO,
          maximum: L_HI,
          description: `Skin CIELAB L* before sunscreen. The site's tones are L* ${SITE_TONES}.`,
        },
      },
      required: ["skin_lightness"],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS,
  },
  {
    name: "held_out_error",
    title: "Held-out error",
    description:
      "Refits the label model from the study table and recomputes its held-out error (Gate 1): overall, on darker " +
      "skin, and on the study's differently formulated benchmark product, whose error is each prediction's band. " +
      "The same payload as GET /api/label-model.",
    inputSchema: NO_ARGUMENTS,
    annotations: ANNOTATIONS,
  },
];

/** A result whose text is a sentence and then the structured content as JSON (the spec's fallback for older clients). */
function done(sentence: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: sentence }, { type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
}

function refused(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * True when `args` holds a name outside `allowed`. Messages never repeat what the caller sent, only fixed text and
 * numbers, so a reply can never carry copy the site would not write (Codex review).
 */
function hasUnknown(args: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(args).some((k) => !allowed.includes(k));
}

/** Six places, as castforecast/label_catalogue.py publishes every float, so a published value comes back unchanged. */
const published = (x: number) => Number(x.toFixed(6));

/** The band label_catalogue.py `_whitening` gives one prediction. */
function whitening(value: number): Whitening {
  return { value: published(value), low: published(value - RETAIL_ERROR_L), high: published(value + RETAIL_ERROR_L), unit: "L*" };
}

const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;

function listBottles(args: Record<string, unknown>, catalogue: readonly Bottle[]): ToolResult {
  if (hasUnknown(args, [])) return refused("list_bottles takes no arguments.");
  const bottles = catalogue.map((b) => ({ id: b.id, name: b.name, brand: b.brand, evidence: b.evidence, labelUrl: labelUrl(b) }));
  return done(`${bottles.length} bottles. Pass an id to predict_cast as bottle_id.`, { bottles });
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function predictCast(args: Record<string, unknown>, catalogue: readonly Bottle[]): ToolResult {
  const no = (why: string) => refused(`No prediction: ${why}`);
  if (hasUnknown(args, ["bottle_id", "zinc_oxide_pct", "skin_lightness"])) {
    return no("predict_cast takes only bottle_id or zinc_oxide_pct, and skin_lightness.");
  }
  // A null reads as not given: some clients send every optional property, null when unused.
  const given = (k: string) => args[k] !== undefined && args[k] !== null;
  if (given("bottle_id") && given("zinc_oxide_pct")) return no("give bottle_id or zinc_oxide_pct, not both.");
  if (!given("bottle_id") && !given("zinc_oxide_pct")) return no("give bottle_id (see list_bottles) or zinc_oxide_pct.");
  if (!given("skin_lightness")) return no("skin_lightness (the skin's CIELAB L*) is required.");
  const lBefore = args.skin_lightness;
  if (!isNumber(lBefore)) return no("skin_lightness must be a finite number (CIELAB L*).");

  let bottle: Bottle | undefined;
  let zinc: number;
  if (given("bottle_id")) {
    const id = args.bottle_id;
    if (typeof id !== "string") return no("bottle_id must be a string.");
    bottle = findBottle(id, catalogue);
    if (!bottle) return no("no bottle has that bottle_id. Call list_bottles for the ids.");
    zinc = bottle.evidence.zincOxidePct;
  } else {
    const pct = args.zinc_oxide_pct;
    if (!isNumber(pct)) return no("zinc_oxide_pct must be a finite number.");
    zinc = pct;
  }

  const p = predictInStudy(zinc, lBefore);
  if ("refusal" in p) return no(`${p.refusal}. The model is never extrapolated.`);
  const w = whitening(p.value);
  const subject = bottle ? `${bottle.name} (${zinc}% zinc oxide)` : `${zinc}% zinc oxide`;
  return done(
    `${subject} on skin L* ${lBefore}: predicted lightening ${formatValue(w)}, band ${signed(w.low)} to ${signed(w.high)} L*.`,
    {
      bottle: bottle ? { id: bottle.id, name: bottle.name, brand: bottle.brand } : null,
      zincOxidePct: zinc,
      skinLightness: lBefore,
      whitening: w,
    },
  );
}

let heldOut: LabelModelPayload | undefined;

function heldOutError(args: Record<string, unknown>): ToolResult {
  if (hasUnknown(args, [])) return refused("held_out_error takes no arguments.");
  heldOut ??= labelModelPayload();
  const h = heldOut.heldOut;
  return done(
    `Held-out error, L*: ${h.maeL.toFixed(2)} on ${h.cells} cells, ${h.darkerSkin.maeL.toFixed(2)} on darker skin ` +
      `(${h.darkerSkin.cells}), ${h.benchmark.maeL.toFixed(2)} on the benchmark product (${h.benchmark.cells}).`,
    heldOut,
  );
}

/** Runs one tool, or answers null for a name no tool has. `args` is the call's arguments object ({} when absent). */
export function callTool(name: string, args: Record<string, unknown>, catalogue: readonly Bottle[]): ToolResult | null {
  switch (name) {
    case "list_bottles":
      return listBottles(args, catalogue);
    case "predict_cast":
      return predictCast(args, catalogue);
    case "held_out_error":
      return heldOutError(args);
    default:
      return null;
  }
}
