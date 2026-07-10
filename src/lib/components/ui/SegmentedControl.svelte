<script lang="ts">
	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		name: string;
		options: Option[];
		value: string;
		onchange: (value: string) => void;
	}

	let { name, options, value, onchange }: Props = $props();
</script>

<div class="inline-flex flex-wrap gap-0.5 rounded-control border border-line bg-slate-950/50 p-0.5">
	{#each options as option (option.value)}
		<label
			class="cursor-pointer rounded-[0.2rem] px-3 py-1.5 text-label font-medium transition
				{value === option.value ? 'bg-accent-strong text-white' : 'text-slate-300 hover:text-white'}"
		>
			<input
				type="radio"
				{name}
				value={option.value}
				checked={value === option.value}
				onchange={() => onchange(option.value)}
				class="sr-only"
			/>
			{option.label}
		</label>
	{/each}
</div>
