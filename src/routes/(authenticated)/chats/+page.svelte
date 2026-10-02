<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { LANGUAGE_CODE_LABELS, LANGUAGE_CODES } from '$lib/constants';
	import { createFormView } from '$lib/forms/create-form-view.svelte';
	import { DELETE_CHAT_ID, deleteChatFailure, deleteChatSuccess } from '$lib/forms/delete-chat';
	import { START_CHAT_ID, startChatFailure, startChatSuccess } from '$lib/forms/start-chat';
	import type { PageProps } from './$types';

	const FIELDS = [
		['you', 'Quién eres'],
		['partner', 'Quién es el otro'],
		['shared', 'Qué está pasando'],
		['private', 'Qué sabe el otro y tú no'],
		['want', 'Qué quieres']
	] as const;

	const PLACEHOLDERS: Record<(typeof FIELDS)[number][0], string> = {
		you: 'Un huésped. Llegaste sin reserva.',
		partner: 'La recepcionista. Puede decir que no.',
		shared: 'Están en la recepción. No quedan habitaciones.',
		private: 'Su turno termina en diez minutos.',
		want: 'Conseguir una habitación para esta noche.'
	};

	type ContextFields = Record<(typeof FIELDS)[number][0], string>;

	type Scene = ContextFields & {
		id: number;
		name: string;
		briefing: string;
	};

	type Choice = ContextFields & {
		name: string;
		briefing: string;
	};

	let { data, form }: PageProps = $props();

	let startChat = createFormView({
		id: START_CHAT_ID,
		success: startChatSuccess,
		failure: startChatFailure,
		getForm: () => form
	});

	let deleteChat = createFormView({
		id: DELETE_CHAT_ID,
		success: deleteChatSuccess,
		failure: deleteChatFailure,
		getForm: () => form
	});

	const scenes = $derived(listScenes(data.conversationPresets));
	const presetChoice = $derived(startingChoice(data.conversationPresets));

	let chosen = $state<Choice | null>(null);
	const committed = $derived(chosen ?? presetChoice);
	let dialogEl: HTMLDialogElement | undefined;
	let step = $state<'pick' | 'edit'>('pick');
	let query = $state('');
	let picked = $state<number | 'custom' | null>(null);
	let filledFrom = $state<number | 'custom' | null>(null);
	let base = $state<Scene | null>(null);
	let draft = $state<ContextFields>(emptyFields());

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return scenes;
		return scenes.filter(
			(scene) => scene.name.toLowerCase().includes(q) || scene.briefing.toLowerCase().includes(q)
		);
	});

	const draftReady = $derived(FIELDS.every(([key]) => draft[key].trim().length > 0));

	/** Conversation presets the picker can copy. One-shot rows stay out of this list. */
	function listScenes(presets: typeof data.conversationPresets): Scene[] {
		return presets
			.flatMap((preset) => {
				if (preset.kind !== 'conversation' || preset.context.version !== 1) return [];
				return [
					{
						id: preset.id,
						name: preset.name,
						briefing: preset.briefing,
						you: preset.context.payload.you,
						partner: preset.context.payload.partner,
						shared: preset.context.payload.shared,
						private: preset.context.payload.private,
						want: preset.context.payload.want
					}
				];
			})
			.sort((a, b) => a.id - b.id);
	}

	function emptyFields(): ContextFields {
		return { you: '', partner: '', shared: '', private: '', want: '' };
	}

	function copyFields(fields: ContextFields): ContextFields {
		return {
			you: fields.you,
			partner: fields.partner,
			shared: fields.shared,
			private: fields.private,
			want: fields.want
		};
	}

	function startingChoice(presets: typeof data.conversationPresets): Choice {
		const available = listScenes(presets);
		const practice = presets.find((preset) => preset.slug === 'practice');
		const scene = available.find((item) => item.id === practice?.id) ?? available[0];
		if (!scene) return { name: 'Personalizado', briefing: '', ...emptyFields() };
		return {
			name: scene.name,
			briefing: scene.briefing,
			...copyFields(scene)
		};
	}

	function sameFields(left: ContextFields, right: ContextFields) {
		return FIELDS.every(([key]) => left[key] === right[key]);
	}

	function rememberDialog(node: HTMLDialogElement) {
		dialogEl = node;
	}

	function openDialog() {
		step = 'pick';
		query = '';
		const current = scenes.find((scene) => sameFields(committed, scene));
		if (current) {
			picked = current.id;
			filledFrom = null;
			base = null;
		} else {
			picked = 'custom';
			filledFrom = 'custom';
			base = null;
			draft = copyFields(committed);
		}
		dialogEl?.showModal();
	}

	function closeDialog() {
		dialogEl?.close();
	}

	function continueStep() {
		if (step === 'pick') {
			if (picked === null) return;
			if (picked !== filledFrom) {
				base = picked === 'custom' ? null : (scenes.find((scene) => scene.id === picked) ?? null);
				draft = base ? copyFields(base) : emptyFields();
				filledFrom = picked;
			}
			step = 'edit';
			return;
		}

		const values = copyFields(draft);
		for (const [key] of FIELDS) values[key] = values[key].trim();
		if (!FIELDS.every(([key]) => values[key])) return;

		// An untouched preset keeps its name. Any edit becomes this chat's own scene.
		chosen =
			base && sameFields(values, base)
				? { name: base.name, briefing: base.briefing, ...values }
				: { name: 'Personalizado', briefing: values.shared, ...values };
		closeDialog();
	}
</script>

<h1>Chats</h1>

{#if deleteChat.view.status === 'failure'}
	<p>Error al eliminar</p>
{/if}

{#each data.chats as chat (chat.id)}
	<div class="row">
		<a href={resolve('/(authenticated)/chats/[id]', { id: String(chat.id) })} title={chat.title}
			>{chat.title}</a
		>
		<form method="post" action="?/deleteChat" use:enhance={deleteChat.enhance}>
			<button type="submit" disabled={deleteChat.view.status === 'pending'}>
				{deleteChat.view.status === 'pending' ? 'Cargando' : 'Eliminar'}
			</button>
			<input type="hidden" name="chat_id" value={chat.id} />
		</form>
	</div>
{:else}
	<p class="empty">Todavía no has iniciado ninguna conversación.</p>
{/each}

<form method="post" action="?/startChat" class="composer" use:enhance={startChat.enhance}>
	{#if startChat.view.status === 'failure'}
		<p>Error al iniciar el chat</p>
	{/if}
	<h2>Nueva conversación</h2>
	<label for="start_chat_content">Mensaje</label>
	<textarea id="start_chat_content" name="content" placeholder="¿Por dónde partimos?"></textarea>
	<div class="context">
		<label for="context_edit">Contexto</label>
		<div class="context-head">
			<p>{committed.name}</p>
			<button id="context_edit" type="button" onclick={openDialog}>Editar</button>
		</div>
		{#if committed.briefing}
			<p class="briefing">{committed.briefing}</p>
		{/if}
	</div>
	<input type="hidden" name="version" value="1" />
	<input type="hidden" name="you" value={committed.you} />
	<input type="hidden" name="partner" value={committed.partner} />
	<input type="hidden" name="shared" value={committed.shared} />
	<input type="hidden" name="private" value={committed.private} />
	<input type="hidden" name="want" value={committed.want} />
	<div class="composer-row">
		<div>
			<label for="start_chat_language">Idioma</label>
			<select id="start_chat_language" name="target_language">
				{#each LANGUAGE_CODES as languageCode (languageCode)}
					{#if data.signedInUser.nativeLanguage !== languageCode}
						<option value={languageCode}>{LANGUAGE_CODE_LABELS.es[languageCode]}</option>
					{/if}
				{/each}
			</select>
		</div>
		<button type="submit" disabled={startChat.view.status === 'pending'}>
			{startChat.view.status === 'pending' ? 'Cargando' : 'Enviar'}
		</button>
	</div>
</form>

<dialog {@attach rememberDialog} aria-labelledby="context-dialog-title">
	<p class="step">Paso {step === 'pick' ? 1 : 2} de 2</p>
	<h2 id="context-dialog-title">
		{step === 'pick' ? 'Elige un contexto' : 'Revisa las variables'}
	</h2>

	{#if step === 'pick'}
		<label for="context_query">Buscar</label>
		<input id="context_query" type="search" placeholder="Café, hotel, camisa…" bind:value={query} />
		<div class="results">
			{#each matches as scene (scene.id)}
				<button
					type="button"
					class="result"
					aria-pressed={picked === scene.id}
					onclick={() => (picked = scene.id)}
				>
					<strong>{scene.name}</strong>
					<span>{scene.briefing}</span>
				</button>
			{:else}
				<p class="hint">Ningún contexto coincide.</p>
			{/each}
		</div>
		<p class="or">o bien</p>
		<button
			type="button"
			class="custom"
			aria-pressed={picked === 'custom'}
			onclick={() => (picked = 'custom')}
		>
			<strong>Personalizado</strong>
			<span>Empiezas con las variables vacías y las escribes tú.</span>
		</button>
	{:else}
		<p class="hint">Si algo no calza, cámbialo. Si está bien, confirma.</p>
		<div class="fields">
			{#each FIELDS as [key, label] (key)}
				<label for="context_{key}">{label}</label>
				<textarea id="context_{key}" placeholder={PLACEHOLDERS[key]} bind:value={draft[key]}
				></textarea>
			{/each}
		</div>
	{/if}

	<div class="dialog-actions">
		{#if step === 'edit'}
			<button type="button" class="back" onclick={() => (step = 'pick')}>Atrás</button>
		{/if}
		<button type="button" onclick={closeDialog}>Cancelar</button>
		<button
			type="button"
			class="solid"
			disabled={step === 'pick' ? picked === null : !draftReady}
			onclick={continueStep}
		>
			{step === 'edit' ? 'Confirmar' : 'Continuar'}
		</button>
	</div>
</dialog>

<style>
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 0;
		border-bottom: 1px solid var(--wash);
	}

	.row a {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row button {
		background: none;
		color: var(--muted);
		border: none;
		padding: 0;
		text-decoration: underline;
		text-underline-offset: 0.18em;
		flex-shrink: 0;
	}

	.row button:hover:not(:disabled) {
		color: var(--ink);
		background: none;
	}

	.empty {
		color: var(--muted);
		padding: 1.5rem 0;
	}

	.composer {
		margin-top: 2rem;
		padding-top: 0.35rem;
		border-top: 1px solid var(--line);
	}

	.composer h2 {
		margin-top: 0.85rem;
	}

	.context {
		margin: 0 0 1rem;
	}

	.context-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.context p {
		margin: 0;
	}

	.briefing {
		margin-top: 0.35rem;
		color: var(--muted);
	}

	.context button {
		flex-shrink: 0;
		color: var(--muted);
	}

	.context button:hover {
		color: var(--ink);
	}

	.composer-row {
		display: flex;
		align-items: flex-end;
		gap: 0.85rem;
	}

	.composer-row > div {
		flex: 1;
	}

	.composer-row select {
		margin-bottom: 0;
	}

	.composer-row button {
		flex-shrink: 0;
		margin-bottom: 0.15rem;
	}

	dialog {
		width: min(36rem, calc(100vw - 2rem));
		height: fit-content;
		max-height: calc(100vh - 2rem);
		margin: auto;
		overflow: auto;
		border: 1px solid var(--line);
		padding: 1.1rem 1.15rem 1rem;
		color: var(--ink);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 25%);
	}

	.step {
		margin: 0;
		color: var(--muted);
		font-size: 0.8125rem;
	}

	dialog h2 {
		margin-top: 0.35rem;
	}

	.results {
		max-height: 16rem;
		overflow: auto;
	}

	button.result,
	button.custom {
		display: block;
		width: 100%;
		padding: 0.55rem 0;
		text-align: left;
		text-decoration: none;
		border-bottom: 1px solid var(--wash);
		background: none;
	}

	button.result strong,
	button.custom strong {
		display: block;
		font-weight: 650;
	}

	button.result span,
	button.custom span {
		display: block;
		margin-top: 0.15rem;
		color: var(--muted);
		font-weight: 400;
	}

	button.result[aria-pressed='true'],
	button.custom[aria-pressed='true'] {
		background: var(--wash);
	}

	.or {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		margin: 0.85rem 0;
		color: var(--muted);
		font-size: 0.8125rem;
	}

	.or::before,
	.or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	button.custom {
		border-bottom: 0;
	}

	.hint {
		margin: 0 0 0.75rem;
		color: var(--muted);
	}

	.fields textarea {
		min-height: 3.2rem;
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.dialog-actions .back {
		margin-right: auto;
	}

	button.solid {
		text-decoration: none;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--ink);
		background: var(--ink);
		color: #fff;
	}

	button.solid:hover:not(:disabled) {
		background: #000;
	}
</style>
