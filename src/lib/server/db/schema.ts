import {
	pgTable,
	serial,
	integer,
	text,
	pgEnum,
	timestamp,
	index,
	jsonb,
	primaryKey,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';
import { user } from './auth.schema';
import {
	CHAT_KIND,
	LANGUAGE_CODES,
	MESSAGE_STATUS,
	PRESET_ORIGINS,
	ROLES,
	SRS_ALGORITHMS
} from '$lib/constants';
import type { ChatPayload } from '$lib/chat/payload';
import type { ExercisePayload } from '$lib/exercise/exercise-payload';
import type { ExerciseCheckPayload } from '$lib/exercise/exercise-check-payload';
import type { FeedbackPayloadSchema } from '$lib/feedback/feedback-payload';

export const languageCodeEnum = pgEnum('language_code', LANGUAGE_CODES);
export const messageRoleEnum = pgEnum('message_role', ROLES);
export const messageStatusEnum = pgEnum('message_status', MESSAGE_STATUS);
export const srsAlgorithmEnum = pgEnum('srs_algorithm', SRS_ALGORITHMS);
export const chatKindEnum = pgEnum('chat_kind', CHAT_KIND);
export const presetOriginEnum = pgEnum('preset_origin', PRESET_ORIGINS);

export const userSrsProfile = pgTable('user_srs_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	algorithm: srsAlgorithmEnum('algorithm').notNull(),
	setup: jsonb('setup').notNull()
});

export const chat = pgTable(
	'chat',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.references(() => user.id, { onDelete: 'cascade' })
			.notNull(),
		targetLanguage: languageCodeEnum('target_language').notNull(),
		title: text('title').notNull(),
		kind: chatKindEnum('kind').notNull(),
		payload: jsonb('payload').$type<ChatPayload>().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('chat_userid_idx').on(table.userId)]
);

export const conversationPreset = pgTable('conversation_preset', {
	id: serial('id').primaryKey(),
	slug: text('slug').unique('conversationpreset_slug_uq'),
	origin: presetOriginEnum('origin').notNull(),
	kind: chatKindEnum('kind').notNull(),
	name: text('name').notNull(),
	briefing: text('briefing').notNull(),
	context: jsonb('context').$type<ChatPayload>().notNull(),
	authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

export const message = pgTable(
	'message',
	{
		id: serial('id').primaryKey(),
		chatId: integer('chat_id')
			.references(() => chat.id, { onDelete: 'cascade' })
			.notNull(),
		role: messageRoleEnum('role').notNull(),
		content: text('content').notNull(),
		intent: text('intent'),
		status: messageStatusEnum('status').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('message_chatid_idx').on(table.chatId)]
);

export const messageRewrite = pgTable(
	'message_rewrite',
	{
		id: serial('id').primaryKey(),
		messageId: integer('message_id')
			.references(() => message.id, { onDelete: 'cascade' })
			.notNull(),
		text: text('text').notNull(),
		index: integer('index').notNull(),
		reason: text('reason').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('messagerewrite_messageid_idx').on(table.messageId)]
);

export const exercise = pgTable(
	'exercise',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.references(() => user.id, { onDelete: 'cascade' })
			.notNull(),
		targetLanguage: languageCodeEnum('target_language').notNull(),
		payload: jsonb('payload').$type<ExercisePayload>().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		archivedAt: timestamp('archived_at')
	},
	(table) => [
		index('exercise_userid_createdat_desc_idx').on(table.userId, table.createdAt.desc()),
		index('exercise_userid_createdat_desc_active_idx')
			.on(table.userId, table.createdAt.desc())
			.where(isNull(table.archivedAt))
	]
);

export const exerciseCheck = pgTable(
	'exercise_check',
	{
		id: serial('id').primaryKey(),
		exerciseId: integer('exercise_id')
			.references(() => exercise.id, { onDelete: 'cascade' })
			.notNull(),
		payload: jsonb('payload').$type<ExerciseCheckPayload>().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		ratedAt: timestamp('rated_at')
	},
	(table) => [
		index('exercisecheck_id_createdat_desc_idx').on(table.exerciseId, table.createdAt.desc()),
		uniqueIndex('exercisecheck_exerciseid_unrated_uq')
			.on(table.exerciseId)
			.where(isNull(table.ratedAt))
	]
);

export const exerciseMessageRewrite = pgTable(
	'exercise_message_rewrite',
	{
		exerciseId: integer('exercise_id')
			.references(() => exercise.id, { onDelete: 'cascade' })
			.notNull(),
		messageRewriteId: integer('message_rewrite_id')
			.references(() => messageRewrite.id, { onDelete: 'cascade' })
			.notNull()
	},
	(table) => [primaryKey({ columns: [table.exerciseId, table.messageRewriteId] })]
);

export const feedback = pgTable(
	'feedback',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.references(() => user.id, { onDelete: 'cascade' })
			.notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		payload: jsonb('payload').$type<FeedbackPayloadSchema>().notNull()
	},
	(table) => [index('feedback_userId_idx').on(table.userId)]
);

export * from './auth.schema';
export * from './fsrs.schema';
