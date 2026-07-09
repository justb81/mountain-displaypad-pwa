<script lang="ts">
	import { connection } from '$lib/state/connection.svelte.js';

	const label = $derived(
		{
			unsupported: 'WebHID unsupported',
			disconnected: 'Connect DisplayPad',
			connecting: 'Connecting…',
			connected: 'Disconnect',
			error: 'Retry connection'
		}[connection.status]
	);

	function toggle() {
		if (connection.status === 'connected') void connection.disconnect();
		else void connection.connect();
	}
</script>

<button
	type="button"
	onclick={toggle}
	disabled={connection.status === 'unsupported' || connection.status === 'connecting'}
	class="rounded-md bg-sky-600 px-4 py-2 font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
>
	{label}
</button>

{#if connection.status === 'error' && connection.error}
	<p class="mt-1 text-sm text-red-400">{connection.error}</p>
{/if}
