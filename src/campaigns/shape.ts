/**
 * Canonical Zod schema for a campaign's WRITABLE fields:
 * `type`, `triggering`, `targeting`, `content`.
 *
 * Note on what's intentionally NOT in this shape:
 *  - `name`, `state`, `project` — injected by the create/update tool wrappers
 *    (`buildCreateInput(projectId, name, args)`, `mergeUpdateInput(current, patch)`
 *    in `transform.ts`). Keeping them out keeps the shape focused on the parts
 *    that round-trip between read (`shapeGetCampaign`) and write.
 *  - `eventParam.compareType` / `valueType` — left as open `z.string()` because
 *    the backend `EventParamInput` carries defaults (`'==='` / `'string'`) and
 *    has no published enum at the GraphQL layer.
 *
 * Cross-field validation (e.g. `dateValue.type === 'absolute'` implies
 * `absoluteValue` is set) is enforced server-side by the backend's
 * `CampaignValidatorCollection`. Adding client-side discriminated refines is
 * a deferred polish item.
 */
import { z } from 'zod';

export const numberCompareType = z.enum(['equal','notEqual','greater','less','greaterOrEqual','lessOrEqual','isNotSet','isSet']);
export const includeTargetingType = z.enum(['include','exclude']);
export const customPropertyValueType = z.enum(['string','number','boolean','datetime']);
export const dateValueType = z.enum(['absolute','relative']);
export const timeDimension = z.enum(['days']);
export const eventType = z.enum(['custom','system']);
export const repeatType = z.enum(['interval','every']);
export const repeatEntity = z.enum(['event','session']);
export const campaignType = z.enum(['DeepLink','RateReview']);
export const campaignState = z.enum(['Draft','Active','Cancel']);
export const limitType = z.enum(['session','device']);
export const limitIntervalDimension = z.enum(['sec','min','hour','day']);

export const eventParam = z.object({
  name: z.string().min(1),
  value: z.string(),
  compareType: z.string().default('==='),
  valueType: z.string().default('string'),
});

const repeatBase = {
  repeatType,
  repeatEntity,
  // Backend TriggerRepeatValidator REQUIRES an array of ints — a scalar is rejected
  // ("Field 'repeatValue' must be array"). "Every 2nd event" => repeatValue: [2].
  repeatValue: z.array(z.number().int()).min(1),
};
export type Repeat = {
  repeatType: z.infer<typeof repeatType>;
  repeatEntity: z.infer<typeof repeatEntity>;
  repeatValue: number[];
  subRepeat?: Repeat;
};
export const repeat: z.ZodType<Repeat> = z.lazy(() => z.object({ ...repeatBase, subRepeat: repeat.optional() }));

export const limit = z.object({
  count: z.number().int().optional(),
  limit: z.number().int().optional(),
  limitType: limitType.optional(),
  interval: z.number().int().optional(),
  intervalDimension: limitIntervalDimension.optional(),
}).default({});

export const triggering = z.object({
  event: z.object({ name: z.string().min(1), type: eventType, params: z.array(eventParam).default([]) }),
  repeat,
  limit,
});

export const dateValue = z.object({
  type: dateValueType,
  absoluteValue: z.string().optional(),
  relativeValue: z.number().int().positive().optional(),
  dimension: timeDimension.optional(),
});

const numberSlot = z.object({ compareType: numberCompareType, value: z.string().min(1) });

export const targetingSlot = z.object({
  osVersion: numberSlot.optional(),
  appVersion: numberSlot.optional(),
  appInstallVersion: numberSlot.optional(),
  country: z.object({ type: includeTargetingType, values: z.array(z.string()).min(1) }).optional(),
  application: z.object({ type: includeTargetingType, values: z.array(z.string().uuid()).min(1) }).optional(),
  customProperty: z.object({
    key: z.string().min(1),
    compareType: numberCompareType,
    valueType: customPropertyValueType.optional(),
    value: z.string().optional(),
    dateValue: dateValue.optional(),
  }).optional(),
  installDate: z.object({ compareType: numberCompareType, value: dateValue }).optional(),
}).refine(
  (o) => Object.values(o).filter((v) => v !== undefined).length === 1,
  { message: 'each targeting item must set exactly one slot' },
);

export const campaignInputShape = z.object({
  type: campaignType,
  triggering,
  targeting: z.array(targetingSlot).default([]),
  content: z.record(z.unknown()).nullable().optional(),
});

export type CampaignInputShape = z.infer<typeof campaignInputShape>;
