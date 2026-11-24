const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'S02E05' */
export function epCode(season: number, episode: number): string {
	return `S${pad(season)}E${pad(episode)}`;
}

/**
 * 'YYYY-MM-DD' → 'Wed 25 Nov' (plus ' 2027' when the year differs from `refYear`).
 * Built by hand so server and browser render identical text.
 */
export function shortDate(date: string, refYear?: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return date;
	const s = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
	return refYear !== undefined && d.getUTCFullYear() !== refYear ? `${s} ${d.getUTCFullYear()}` : s;
}
