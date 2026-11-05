/**
 * Shared formatting utilities used across route pages and components.
 *
 * `stripFrontmatter` and `formatDate` are re-exported from
 * `@vattelum/document-registry-js` so the canonical content-hash chain
 * (`stripFrontmatter` feeds `hashBody`) and the UTC date format are a single
 * source across all consumer repos.
 */

export { stripFrontmatter, formatDate } from '@vattelum/document-registry-js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format an ISO date string ("YYYY-MM-DD" from <input type="date">) as "DD Mon YYYY".
 * Returns the input unchanged if it does not match the ISO shape.
 */
export function formatISODate(iso: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return iso;
	const [, y, mo, d] = m;
	const monthIdx = Number(mo) - 1;
	if (monthIdx < 0 || monthIdx > 11) return iso;
	return `${d} ${MONTHS[monthIdx]} ${y}`;
}

/**
 * Cutoff T for a date picked in <input type="date"> ("YYYY-MM-DD"): the last
 * second of that day, UTC, in unix seconds. Null if the input is not a date.
 */
export function endOfDayUTC(iso: string): bigint | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return null;
	const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
	return Number.isNaN(ms) ? null : BigInt(ms / 1000);
}

/**
 * Truncate an Ethereum address to "0xAbCd...EfGh" form.
 */
export function truncAddr(addr: string): string {
	return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Format a relative countdown from now to a future Unix timestamp (seconds).
 * Returns short-form "Nd Nh", "Nh Nm", "Nm", or "now" when elapsed.
 */
export function formatCountdown(targetTimestamp: number): string {
	const now = Math.floor(Date.now() / 1000);
	const diff = targetTimestamp - now;
	if (diff <= 0) return 'now';
	const days = Math.floor(diff / 86400);
	const hours = Math.floor((diff % 86400) / 3600);
	const mins = Math.floor((diff % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${mins}m`;
	return `${mins}m`;
}
