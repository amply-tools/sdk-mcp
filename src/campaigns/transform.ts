import { campaignInputShape, type CampaignInputShape } from './shape.js';
import { targetingPayloadToInput, type RawTargetingPayload } from './targeting.js';

export interface RawCampaign {
  id: string; name: string; type: string; state: string;
  triggering: unknown; content: unknown;
  targeting: RawTargetingPayload[] | null;
  createdAt?: string; updatedAt?: string;
}

export interface ShapedCampaign extends CampaignInputShape {
  id: string; name: string; state: string; createdAt?: string; updatedAt?: string;
}

/** Normalize a get-campaign GraphQL result into the canonical (input-compatible) shape. */
export function shapeGetCampaign(raw: RawCampaign): ShapedCampaign {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type as ShapedCampaign['type'],
    state: raw.state,
    triggering: raw.triggering as ShapedCampaign['triggering'],
    targeting: targetingPayloadToInput(raw.targeting) as ShapedCampaign['targeting'],
    content: (raw.content ?? null) as ShapedCampaign['content'],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export interface CreateInputArgs {
  type: CampaignInputShape['type'];
  triggering: CampaignInputShape['triggering'];
  targeting?: CampaignInputShape['targeting'];
  content?: CampaignInputShape['content'];
}

/** Build a CampaignInput for campaignCreate. Always Draft; project + name required. */
export function buildCreateInput(projectId: string, name: string, args: CreateInputArgs) {
  const validated = campaignInputShape.parse(args);
  return { name, ...validated, state: 'Draft' as const, project: projectId };
}

export interface UpdatePatch {
  name?: string;
  state?: ShapedCampaign['state'];
  type?: CampaignInputShape['type'];
  triggering?: CampaignInputShape['triggering'];
  targeting?: CampaignInputShape['targeting'];
  content?: CampaignInputShape['content'];
}

/** Top-level replace: provided fields override; omitted fields keep current. */
export function mergeUpdateInput(current: ShapedCampaign, patch: UpdatePatch) {
  return {
    name: patch.name ?? current.name,
    type: patch.type ?? current.type,
    state: patch.state ?? current.state,           // never silently defaults to Draft
    triggering: patch.triggering ?? current.triggering,
    targeting: patch.targeting ?? current.targeting,
    content: patch.content !== undefined ? patch.content : current.content,
  };
}

/** Re-validate the writable campaign fields through the canonical shape. */
export function validateWriteInput(input: { type: unknown; triggering: unknown; targeting: unknown; content: unknown }) {
  return campaignInputShape.parse({ type: input.type, triggering: input.triggering, targeting: input.targeting, content: input.content });
}
