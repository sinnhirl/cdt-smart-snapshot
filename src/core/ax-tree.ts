/**
 * AX tree normalization — pure conversion from raw accessibility nodes to TextSnapshotNode.
 *
 * Why: Keep puppeteer out of core. browser.ts fetches page.accessibility.snapshot();
 * this module only normalizes the returned plain objects so unit tests can feed fixtures.
 */

import type {RawAxNode, TextSnapshotNode} from '../types.js';
import type {UidMapper} from './uid.js';

/**
 * Extracts a string from an AX property that may be a bare string or `{value}`.
 *
 * @param prop - Raw AX property.
 * @returns Normalized string (empty when absent).
 */
function axString(
  prop:
    string | number | boolean | {value: string | number | boolean} | undefined,
): string {
  if (prop === undefined) {
    return '';
  }
  if (typeof prop === 'string') {
    return prop;
  }
  if (typeof prop === 'number' || typeof prop === 'boolean') {
    return String(prop);
  }
  if (typeof prop.value === 'string') {
    return prop.value;
  }
  return String(prop.value);
}

/**
 * Normalizes a raw puppeteer AX snapshot node into a TextSnapshotNode tree.
 *
 * Why: Puppeteer's AX shape uses `{value}` wrappers and optional fields; our pipeline
 * wants a flat, predictable TextSnapshotNode. Skips `ignored` nodes when present.
 *
 * @param raw - Raw AX node (or null/undefined for empty page).
 * @param mapper - UidMapper for stable backendNodeId → uid assignment.
 * @returns Normalized root node, or a placeholder Document when raw is empty.
 * @throws Never throws.
 */
export function normalizeAxTree(
  raw: RawAxNode | null | undefined,
  mapper: UidMapper,
): TextSnapshotNode {
  if (raw === null || raw === undefined) {
    return {
      uid: mapper.getUid(undefined),
      role: 'Document',
      name: '',
      children: [],
    };
  }
  return normalizeNode(raw, mapper);
}

/**
 * Recursively normalizes one AX node.
 *
 * @param raw - Raw AX node.
 * @param mapper - Uid mapper.
 * @returns TextSnapshotNode.
 */
function normalizeNode(raw: RawAxNode, mapper: UidMapper): TextSnapshotNode {
  const role = axString(raw.role) || 'generic';
  const name = axString(raw.name);
  const valueStr = raw.value === undefined ? undefined : axString(raw.value);
  const backendNodeId = raw.backendDOMNodeId;
  const uid = mapper.getUid(backendNodeId);

  const children: TextSnapshotNode[] = [];
  if (raw.children !== undefined) {
    for (const child of raw.children) {
      if (child.ignored === true) {
        // Still walk ignored parents' interesting descendants if any.
        if (child.children !== undefined) {
          for (const grand of child.children) {
            if (grand.ignored !== true) {
              children.push(normalizeNode(grand, mapper));
            }
          }
        }
        continue;
      }
      children.push(normalizeNode(child, mapper));
    }
  }

  const node: TextSnapshotNode = {
    uid,
    role,
    name,
    children,
  };
  if (valueStr !== undefined && valueStr.length > 0) {
    node.value = valueStr;
  }
  if (backendNodeId !== undefined) {
    node.backendNodeId = backendNodeId;
  }
  return node;
}
