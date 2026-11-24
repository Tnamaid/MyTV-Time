import { fail } from '@sveltejs/kit';

/** Thrown by the parsers below; `handleBadInput` turns it into fail(400). */
export class BadInput extends Error {}

function raw(form: FormData, name: string): string {
	const v = form.get(name);
	if (typeof v !== 'string') throw new BadInput(`missing ${name}`);
	return v.trim();
}

/** A non-negative integer field (ids, season numbers). */
export function intField(form: FormData, name: string): number {
	const v = raw(form, name);
	if (!/^\d{1,9}$/.test(v)) throw new BadInput(`invalid ${name}`);
	return Number(v);
}

/** '1'/'true' → true, '0'/'false' → false. */
export function boolField(form: FormData, name: string): boolean {
	const v = raw(form, name);
	if (v === '1' || v === 'true') return true;
	if (v === '0' || v === 'false') return false;
	throw new BadInput(`invalid ${name}`);
}

/** Like boolField, but '' (or 'auto') → null. */
export function optBoolField(form: FormData, name: string): boolean | null {
	const v = raw(form, name);
	return v === '' || v === 'auto' ? null : boolField(form, name);
}

/** Stars: '' → null (clear), '1'..'5' → that integer. */
export function starsField(form: FormData, name = 'stars'): 1 | 2 | 3 | 4 | 5 | null {
	const v = raw(form, name);
	if (v === '') return null;
	if (!/^[1-5]$/.test(v)) throw new BadInput(`invalid ${name}`);
	return Number(v) as 1 | 2 | 3 | 4 | 5;
}

/** Run an action body; BadInput → fail(400, { message }). */
export async function handleBadInput<T>(fn: () => T | Promise<T>) {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof BadInput) return fail(400, { message: e.message });
		throw e;
	}
}
