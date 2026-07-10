<script lang="ts">
	import type { ConnectionStatus } from '$lib/types.js';

	interface Props {
		status: ConnectionStatus;
	}

	let { status }: Props = $props();

	const meta: Record<ConnectionStatus, { label: string; dot: string; text: string }> = {
		unsupported: { label: 'Unsupported browser', dot: 'bg-slate-500', text: 'text-slate-400' },
		disconnected: { label: 'Disconnected', dot: 'bg-slate-500', text: 'text-slate-400' },
		connecting: { label: 'Connecting…', dot: 'bg-warning animate-pulse', text: 'text-warning' },
		connected: { label: 'Connected', dot: 'bg-success-strong', text: 'text-success' },
		error: { label: 'Connection error', dot: 'bg-danger', text: 'text-danger' }
	};

	const current = $derived(meta[status]);
</script>

<span
	role="status"
	aria-live="polite"
	class="inline-flex items-center gap-1.5 rounded-full border border-line bg-slate-900/60 px-2.5 py-1 text-label font-medium {current.text}"
>
	<span class="h-1.5 w-1.5 flex-none rounded-full {current.dot}"></span>
	{current.label}
</span>
