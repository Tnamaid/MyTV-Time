const defaultTz = () => process.env.TZ || 'Europe/Paris';

/** An instant as 'YYYY-MM-DD' in the given IANA time zone (default: env TZ; unset or empty -> Europe/Paris). */
export function localDate(at: Date | string, tz: string = defaultTz()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(typeof at === 'string' ? new Date(at) : at);
}

/** Today's date as 'YYYY-MM-DD' in the given IANA time zone (default: env TZ; unset or empty -> Europe/Paris). */
export function today(tz: string = defaultTz()): string {
	return localDate(new Date(), tz);
}
