<script lang="ts">
	import { enhance } from '$app/forms';
	import { Popover } from 'melt/builders';
	import { mergeAttrs } from 'melt';
	import { createFormView } from '$lib/forms/create-form-view.svelte';
	import {
		ADD_ONE_SHOT_MESSAGE_ID,
		addOneShotMessageFailure,
		addOneShotMessageSuccess
	} from '$lib/forms/add-one-shot-message';
	import {
		RETRY_ONE_SHOT_CORRECTION_ID,
		retryOneShotCorrectionFailure,
		retryOneShotCorrectionSuccess
	} from '$lib/forms/retry-one-shot-correction';
	import type { PageProps } from './$types';

	const { data, form }: PageProps = $props();
	const popover = new Popover();
	let triggerData = $state<{ reason: string } | null>();

	let addMessage = createFormView({
		id: ADD_ONE_SHOT_MESSAGE_ID,
		success: addOneShotMessageSuccess,
		failure: addOneShotMessageFailure,
		getForm: () => form
	});

	let retryCorrection = createFormView({
		id: RETRY_ONE_SHOT_CORRECTION_ID,
		success: retryOneShotCorrectionSuccess,
		failure: retryOneShotCorrectionFailure,
		getForm: () => form
	});
</script>

<p class="back"><a href="/one-shots">← Correcciones</a></p>
<h1>{data.title}</h1>
<p class="context">{data.you}</p>

<div class="thread">
	{#each data.messages as message (message.id)}
		<div class="msg">
			<p class="who">Tú</p>
			<p>
				{#if message.status === 'complete'}
					{#each message.rewriteHistory as change, index (index)}
						{#if change.kind === 'removed'}
							{#if change.text.trim() === ''}
								<span>{change.text}</span>
							{:else}
								<button
									type="button"
									class="corr-rm"
									{...mergeAttrs(popover.trigger, {
										onclick: () => (triggerData = { reason: change.reason })
									})}
								>
									{change.text}
								</button>
								<!--
								Add a space after a removed chunk if the next difference also starts with a word/number character,
								so that deleted tokens don't merge with new/untouched ones visually.
								-->
								{#if /[\p{L}\p{N}]+/gu.test(message.rewriteHistory.at(index + 1)?.text ?? '')}
									<span>{' '}</span>
								{/if}
							{/if}
						{:else if change.kind === 'added'}
							{#if change.text.trim() === ''}
								<span>{change.text}</span>
							{:else}
								<button
									type="button"
									class="corr-add"
									{...mergeAttrs(popover.trigger, {
										onclick: () => (triggerData = { reason: change.reason })
									})}
								>
									{change.text}
								</button>
							{/if}
						{:else}
							<span>{change.text}</span>
						{/if}
					{:else}
						<span>{message.content}</span>
					{/each}
				{:else}
					<span>{message.content}</span>
				{/if}
			</p>

			{#if message.status === 'correcting' || message.status === 'pending'}
				<p class="note">Generando corrección…</p>
			{:else if message.status === 'failed'}
				<form
					class="retry"
					method="post"
					action="?/retryCorrection"
					use:enhance={retryCorrection.enhance}
				>
					{#if retryCorrection.view.status === 'pending'}
						Generando corrección…
					{:else}
						<span>No se pudo generar la corrección.</span>
						<button type="submit">Reintentar</button>
					{/if}
					<input type="hidden" name="message_id" value={message.id} />
				</form>
			{/if}
		</div>
	{/each}
</div>

<div
	{...mergeAttrs(popover.content, {
		class: triggerData ? 'reason visible' : 'reason'
	})}
>
	{#if triggerData}
		Corrección: {triggerData.reason}
	{/if}
</div>

<form method="post" action="?/addMessage" class="composer" use:enhance={addMessage.enhance}>
	{#if addMessage.view.status === 'failure'}
		<p>Error al enviar</p>
	{/if}
	<label for="one_shot_intent">Intención</label>
	<textarea id="one_shot_intent" name="intent" placeholder="¿Qué quieres expresar?"></textarea>
	<label for="one_shot_content">Texto</label>
	<textarea id="one_shot_content" name="content" placeholder="¿Cómo lo quieres expresar?"
	></textarea>
	<button type="submit" disabled={addMessage.view.status === 'pending'}>
		{addMessage.view.status === 'pending' ? 'Cargando' : 'Enviar'}
	</button>
</form>

<style>
	.back {
		margin: 0 0 0.65rem;
		font-size: 0.85rem;
	}

	.back a {
		color: var(--muted);
	}

	.context {
		margin: 0 0 1.25rem;
		color: var(--muted);
	}

	.thread {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.msg p {
		margin: 0;
	}

	.msg .note,
	.msg .retry {
		margin-top: 0.3rem;
	}

	.who {
		font-size: 0.7rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
		margin-bottom: 0.3rem;
		font-weight: 600;
	}

	.note,
	.retry {
		margin: 0.3rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.retry button {
		background: none;
		color: var(--muted);
		border: none;
		padding: 0;
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 0.18em;
	}

	.retry button:hover:not(:disabled) {
		color: var(--ink);
		background: none;
	}

	.corr-rm,
	.corr-add {
		font: inherit;
		padding: 0;
		background: none;
		border: none;
		cursor: pointer;
	}

	.corr-rm {
		text-decoration: line-through;
		color: var(--muted);
		text-decoration-thickness: 1px;
		box-shadow: inset 0 -1px 0 var(--line);
	}

	.corr-add {
		font-weight: 600;
		text-decoration: none;
		box-shadow: inset 0 -1px 0 var(--ink);
	}

	.reason.visible {
		padding: 0.65rem 0.8rem;
		background: var(--wash);
		font-size: 0.85rem;
		max-width: 18rem;
	}

	.composer {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		margin-top: 0.5rem;
		padding-top: 1.15rem;
		border-top: 1px solid var(--line);
	}

	.composer textarea {
		width: 100%;
	}
</style>
