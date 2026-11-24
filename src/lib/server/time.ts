/** Today's date as 'YYYY-MM-DD' in the given IANA time zone (default: env TZ; unset or empty -> Europe/Paris). */
export function today(tz: string = process.env.TZ || 'Europe/Paris'): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
}
