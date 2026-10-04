<script lang="ts">
	import { LANGUAGE_CODE_LABELS } from '$lib/constants';
	import type { PageProps } from './$types';

	const RANGES = [
		{
			id: 'week',
			label: '7 días',
			current: 'currentWeekCount',
			previous: 'previousWeekCount'
		},
		{
			id: 'month',
			label: '30 días',
			current: 'currentMonthCount',
			previous: 'previousMonthCount'
		},
		{
			id: 'quarter',
			label: '90 días',
			current: 'currentQuarterCount',
			previous: 'previousQuarterCount'
		},
		{
			id: 'half',
			label: '6 meses',
			current: 'currentHalfYearCount',
			previous: 'previousHalfYearCount'
		}
	] as const;

	type Range = (typeof RANGES)[number];
	type CountField = Range['current'] | Range['previous'];

	const { data }: PageProps = $props();

	let rangeId = $state<Range['id']>('week');
	const range = $derived(RANGES.find((item) => item.id === rangeId) ?? RANGES[0]);

	const groups = $derived.by(() => {
		return data.errorIdentities.flatMap((group) => {
			const bucket = data.messages.find((item) => item.targetLanguage === group.targetLanguage);
			const messagesNow = count(bucket, range.current);
			const messagesBefore = count(bucket, range.previous);
			const rows = group.errorIdentities
				.map((identity) => {
					const stepsNow = count(identity, range.current);
					const stepsBefore = count(identity, range.previous);

					return {
						id: identity.id,
						label: identity.label,
						stepsNow,
						stepsBefore,
						detail: detailFor(stepsNow, stepsBefore, messagesNow, messagesBefore)
					};
				})
				.filter((row) => row.stepsNow > 0 || row.stepsBefore > 0)
				.sort((a, b) => b.stepsNow - a.stepsNow);

			if (rows.length === 0) return [];
			return [{ targetLanguage: group.targetLanguage, rows }];
		});
	});

	/** Reads a window count. Postgres values are numbers here; `Number` covers a string anyway. */
	function count(row: { [key in CountField]?: number } | undefined, field: CountField) {
		return Number(row?.[field] ?? 0);
	}

	/** "nuevo · 3 veces en 30 mensajes · antes 5 veces en 28 mensajes". */
	function detailFor(
		stepsNow: number,
		stepsBefore: number,
		messagesNow: number,
		messagesBefore: number
	) {
		const parts: string[] = [];
		const mark = markFor(stepsNow, stepsBefore, messagesNow, messagesBefore);
		if (mark) parts.push(mark);
		parts.push(timesIn(stepsNow, messagesNow));
		if (messagesBefore > 0) parts.push(`antes ${timesIn(stepsBefore, messagesBefore)}`);
		return parts.join(' · ');
	}

	function timesIn(steps: number, total: number) {
		const times = steps === 1 ? '1 vez' : `${steps} veces`;
		if (total === 0) return times;
		const written = total === 1 ? '1 mensaje' : `${total} mensajes`;
		return `${times} en ${written}`;
	}

	/** Word for the rate change. Null when this window has no messages to divide by. */
	function markFor(
		stepsNow: number,
		stepsBefore: number,
		messagesNow: number,
		messagesBefore: number
	) {
		if (messagesNow === 0) return null;
		if (stepsBefore === 0) return stepsNow > 0 ? 'nuevo' : null;
		if (messagesBefore === 0) return null;

		const rateNow = stepsNow / messagesNow;
		const rateBefore = stepsBefore / messagesBefore;
		if (rateNow < rateBefore) return 'bajó';
		if (rateNow > rateBefore) return 'subió';
		return null;
	}
</script>

<h1>Retroalimentaciones</h1>

<div class="ranges">
	{#each RANGES as item (item.id)}
		<button type="button" aria-pressed={rangeId === item.id} onclick={() => (rangeId = item.id)}>
			{item.label}
		</button>
	{/each}
</div>

{#each groups as group (group.targetLanguage)}
	<section>
		<h2>{LANGUAGE_CODE_LABELS.es[group.targetLanguage]}</h2>
		<ul>
			{#each group.rows as row (row.id)}
				<li>
					<span class="label">{row.label}</span>
					<span class="detail">{row.detail}</span>
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<p class="empty">Sin retroalimentaciones</p>
{/each}

<style>
	.ranges {
		display: flex;
		flex-wrap: wrap;
		gap: 1.15rem;
		margin: 0 0 1.35rem;
	}

	.ranges button {
		color: var(--muted);
	}

	.ranges button[aria-pressed='true'] {
		color: var(--ink);
	}

	section + section {
		margin-top: 1.35rem;
	}

	section h2 {
		margin-top: 0;
	}

	.label,
	.detail {
		display: block;
		overflow-wrap: break-word;
	}

	.detail {
		color: var(--muted);
		font-size: 0.85rem;
		margin-top: 0.15rem;
	}

	.empty {
		color: var(--muted);
		padding: 1rem 0 1.5rem;
	}
</style>
