// scripts/lib/engagement-contract.d.mts
export type EngagementEvent = 'like' | 'dislike' | 'save' | 'read';
export type ItemKind = 'post' | 'tutorial';
export interface EngagementChange { event: EngagementEvent; delta: 1 | -1 }
export const EVENTS: readonly EngagementEvent[];
export const ITEM_ID_RE: RegExp;
export const MAX_CHANGES: number;
export const MAX_BODY_BYTES: number;
export function kindOf(id: string): ItemKind;
export function isValidChange(change: unknown): change is EngagementChange;
export function parseEngagement(body: unknown): { postId: string; changes: EngagementChange[] } | null;
