/**
 * Anchor/Arlex instruction discriminator helper.
 *
 * The on-chain dispatch matches the first 8 bytes of
 *   sha256("global:" + <instruction_name>)
 * against each instruction. We compute it in the browser via the WebCrypto
 * SubtleCrypto digest (no extra dependency), memoising per name.
 *
 * NOTE: async because `crypto.subtle.digest` is async. Instruction builders
 * await this once and prepend the 8 bytes to the Borsh-encoded args.
 */

const cache = new Map<string, Uint8Array>();

/**
 * Returns the 8-byte discriminator for a global instruction name.
 * `name` is the snake_case handler name, e.g. "mint_rwt".
 */
export async function instructionDiscriminator(name: string): Promise<Uint8Array> {
	const cached = cache.get(name);
	if (cached) return cached;

	const preimage = new TextEncoder().encode(`global:${name}`);
	const hash = await crypto.subtle.digest('SHA-256', preimage);
	const disc = new Uint8Array(hash).slice(0, 8);
	cache.set(name, disc);
	return disc;
}
