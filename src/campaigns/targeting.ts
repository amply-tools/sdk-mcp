import { AmplyError } from '../errors.js';

export interface RawTargetingPayload { __typename: string; [k: string]: unknown }

function pruneNullish(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

interface RawEventPayload {
  name: string;
  type: string;
  params?: Array<{ name: string; value: string; compareType: string; valueType: string }> | null;
}

/** Rebuild the EventInput-compatible event reference from an event payload. */
function eventPayloadToInput(event: RawEventPayload): Record<string, unknown> {
  return {
    name: event.name,
    type: event.type,
    params: (event.params ?? []).map((p) => ({ name: p.name, value: p.value, compareType: p.compareType, valueType: p.valueType })),
  };
}

export function targetingPayloadToInput(payloads: RawTargetingPayload[] | null | undefined): Array<Record<string, unknown>> {
  if (!payloads) return [];
  return payloads.map((p) => {
    switch (p.__typename) {
      case 'OSVersionTargetingPayload':
        return { osVersion: { compareType: p.compareType, value: p.value } };
      case 'AppVersionTargetingPayload':
        return { appVersion: { compareType: p.compareType, value: p.value } };
      case 'AppInstallVersionTargetingPayload':
        return { appInstallVersion: { compareType: p.compareType, value: p.value } };
      case 'CountryTargetingPayload':
        return { country: { type: p.type, values: p.values } };
      case 'ApplicationTargetingPayload':
        return { application: { type: p.type, values: ((p.applications as Array<{ id: string }>) ?? []).map((a) => a.id) } };
      case 'CustomPropertyTargetingPayload': {
        const cp = pruneNullish({ key: p.key, compareType: p.compareType, valueType: p.customPropertyValueType, value: p.customPropertyValue });
        if (p.dateValueType != null) {
          cp.dateValue = pruneNullish({ type: p.dateValueType, absoluteValue: p.absoluteValue, relativeValue: p.relativeValue, dimension: p.dimension });
        }
        return { customProperty: cp };
      }
      case 'InstallDateTargetingPayload':
        return { installDate: { compareType: p.compareType, value: pruneNullish({ type: p.installDateValueType, absoluteValue: p.absoluteValue, relativeValue: p.relativeValue, dimension: p.dimension }) } };
      case 'EventCountTargetingPayload':
        // `value` is Int on this payload and clashes with String! elsewhere in
        // the union, so the query aliases it as `eventCountValue` (see queries.ts).
        return {
          eventCount: {
            event: eventPayloadToInput(p.event as unknown as RawEventPayload),
            compareType: p.compareType,
            value: p.eventCountValue,
          },
        };
      case 'EventDateTargetingPayload':
        return {
          eventDate: {
            event: eventPayloadToInput(p.event as unknown as RawEventPayload),
            ...pruneNullish({ bound: p.bound, mode: p.mode, relativeValue: p.relativeValue, relativeUnit: p.relativeUnit, absoluteValue: p.absoluteValue }),
          },
        };
      default:
        throw new AmplyError('unsupported_targeting', `Campaign uses a targeting type this API can't render: ${p.__typename}`, {
          hint: 'Edit it in the Amply dashboard; the MCP cannot round-trip this targeting type.',
        });
    }
  });
}
