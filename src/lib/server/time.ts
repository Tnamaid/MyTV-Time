/** Today's date as 'YYYY-MM-DD' in the given IANA time zone (default: process TZ). */
export function today(tz?: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
}
