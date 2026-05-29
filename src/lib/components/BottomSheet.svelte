<script lang="ts">
	/**
	 * Shared bottom-sheet shell for the Buy / Sell / Stake / Unstake modals.
	 *
	 * Owns: backdrop, slide-up panel, ESC + outside-click close, body-scroll lock,
	 * focus management (focus first field on open, restore on close) and a simple
	 * focus trap (Tab cycles within the panel). Content is provided via the default
	 * snippet so each modal only writes its own form.
	 *
	 * Mobile-first: the panel docks to the bottom and slides up; on wider screens
	 * it centres as a card.
	 */
	import { X } from 'lucide-svelte';

	interface Props {
		open: boolean;
		title: string;
		/** Blocks close while a mock "tx" is in flight. */
		busy?: boolean;
		onClose: () => void;
		children: import('svelte').Snippet;
	}

	let { open, title, busy = false, onClose, children }: Props = $props();

	let panelEl = $state<HTMLDivElement | null>(null);
	let previousActive: HTMLElement | null = null;

	function close(): void {
		if (busy) return;
		onClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			close();
			return;
		}
		if (event.key === 'Tab' && panelEl) {
			const focusable = panelEl.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	$effect(() => {
		if (open) {
			previousActive = document.activeElement as HTMLElement | null;
			document.body.style.overflow = 'hidden';
			// Focus the first input (or the panel) once mounted.
			queueMicrotask(() => {
				const field = panelEl?.querySelector<HTMLElement>(
					'input, button:not([disabled])'
				);
				(field ?? panelEl)?.focus();
			});
		} else {
			document.body.style.overflow = '';
			previousActive?.focus?.();
		}
		return () => {
			document.body.style.overflow = '';
		};
	});
</script>

{#if open}
	<div
		class="backdrop"
		role="presentation"
		onclick={close}
		onkeydown={handleKeydown}
		tabindex="-1"
	>
		<div
			class="sheet"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			bind:this={panelEl}
			onclick={(e) => e.stopPropagation()}
			onkeydown={handleKeydown}
		>
			<div class="grip" aria-hidden="true"></div>
			<header class="head">
				<h2>{title}</h2>
				<button
					class="close"
					type="button"
					onclick={close}
					aria-label="Close"
					disabled={busy}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>

			<div class="body">
				{@render children()}
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal-backdrop);
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.sheet {
		position: relative;
		z-index: var(--z-modal);
		width: 100%;
		max-width: 480px;
		max-height: 92vh;
		max-height: 92dvh;
		overflow-y: auto;
		padding: var(--space-3) var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom));
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card) var(--radius-card) 0 0;
		box-shadow: var(--shadow-overlay);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		animation: slide-up var(--motion-base) var(--ease-out);
	}

	@keyframes slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	.grip {
		width: 36px;
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--color-border-strong);
		align-self: center;
		margin-bottom: var(--space-1);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.head h2 {
		font-size: var(--text-xl);
		font-weight: var(--font-weight-semibold);
	}

	.close {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}

	.close:hover:not(:disabled) {
		color: var(--color-text);
		background: var(--color-hover-tint);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	@media (min-width: 640px) {
		.backdrop {
			align-items: center;
		}

		.sheet {
			border-radius: var(--radius-card);
			animation: fade-in var(--motion-base) var(--ease-out);
		}

		@keyframes fade-in {
			from {
				opacity: 0;
				transform: translateY(8px);
			}
			to {
				opacity: 1;
				transform: translateY(0);
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet {
			animation: none;
		}
	}
</style>
