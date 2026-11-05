<script lang="ts">
	import Button from './ui/Button.svelte';
	import Hint from './ui/Hint.svelte';
	import StatusPill from './ui/StatusPill.svelte';
	import { connection } from '$lib/state/connection.svelte.js';
	import { windowChrome } from '$lib/state/windowChrome.svelte.js';

	const label = $derived(
		{
			unsupported: 'Unsupported',
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

<div class="flex {windowChrome.visible ? 'flex-row items-center' : 'flex-col items-end'} gap-1.5">
	<div class="flex items-center gap-3">
		<StatusPill status={connection.status} />
		<Button
			size={windowChrome.visible ? 'sm' : 'md'}
			variant={connection.status === 'connected' ? 'secondary' : 'primary'}
			onclick={toggle}
			disabled={connection.status === 'unsupported' || connection.status === 'connecting'}
		>
			{label}
		</Button>
	</div>

	{#if !windowChrome.visible && connection.status === 'unsupported'}
		<div class="max-w-xs text-right">
			<Hint>
				WebHID needs a Chromium browser (Chrome or Edge) served over <code>localhost</code> or HTTPS.
			</Hint>
		</div>
	{:else if !windowChrome.visible && connection.status === 'error' && connection.error}
		<div class="max-w-xs text-right">
			<Hint tone="danger">{connection.error}</Hint>
		</div>
	{/if}
</div>
