export function isAnime(d: { genres: { id: number }[]; origin_country?: string[] }): boolean {
	return d.genres.some((g) => g.id === 16) && (d.origin_country ?? []).includes('JP');
}
