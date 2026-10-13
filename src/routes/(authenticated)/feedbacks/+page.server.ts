import { requireUserSession } from '$lib/server/session-user';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { feedbackPayloadSchema } from '$lib/feedback/feedback-payload';
import { parseExercisePayload } from '$lib/exercise/parse-exercise';
import { retry } from '$lib/server/retry';
import {
	buildPrompt as buildErrorPatternPrompt,
	outputSchema as errorPatternsOutputSchema,
	responseFormat as errorPatternsResponseFormat
} from '$lib/prompts/error-patterns';
import {
	buildPrompt as buildErrorDiagnosisPrompt,
	outputSchema as errorDiagnosisOutputSchema,
	responseFormat as errorDiagnosisResponseFormat
} from '$lib/prompts/error-diagnosis';
import { openai, parseLlmResponse, LLM_MODEL } from '$lib/server/llm';
import { createFormResponders } from '$lib/forms/result.server';
import {
	GIVE_FEEDBACK_ID,
	giveFeedbackFailure,
	giveFeedbackSuccess
} from '$lib/forms/give-feedback';
import { CalendarDate, today as intlToday } from '@internationalized/date';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import * as z from 'zod';

const giveFeedback = createFormResponders({
	id: GIVE_FEEDBACK_ID,
	success: giveFeedbackSuccess,
	failure: giveFeedbackFailure
});

export const load: PageServerLoad = async ({ locals }) => {
	const signedInUser = requireUserSession(locals);
	if (!signedInUser) return redirect(302, '/login');

	const today = intlToday(signedInUser.timeZone);

	const getIntervalCountSql = (field: PgColumn, from: CalendarDate, to?: CalendarDate) => {
		if (to) {
			return sql<number>`cast(count(*) filter (where ${field} >= ${from.toString()} and ${field} < ${to.toString()}) as int)`;
		}
		return sql<number>`cast(count(*) filter (where ${field} >= ${from.toString()}) as int)`;
	};

	const countMessageRewritesInInterval = (from: CalendarDate, to?: CalendarDate) =>
		getIntervalCountSql(schema.messageRewrite.createdAt, from, to);

	const sevenDaysAgo = today.subtract({ days: 7 });
	const fourteenDaysAgo = today.subtract({ days: 14 });
	const thirtyDaysAgo = today.subtract({ days: 30 });
	const sixtyDaysAgo = today.subtract({ days: 60 });
	const ninetyDaysAgo = today.subtract({ days: 90 });
	const oneEightyDaysAgo = today.subtract({ days: 180 });
	const threeSixtyDaysAgo = today.subtract({ days: 360 });

	const counts = db.$with('counts').as(
		db
			.select({
				id: schema.errorIdentity.id,
				targetLanguage: schema.errorIdentity.targetLanguage,
				label: schema.errorIdentity.label,
				currentWeekCount:
					sql<number>`cast(count(*) filter (where ${schema.messageRewrite.createdAt} >= ${today.subtract({ days: 7 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`.as(
						'current_week_count'
					),
				previousWeekCount:
					sql<number>`cast(count(*) filter (where ${schema.messageRewrite.createdAt} >= ${today.subtract({ days: 14 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz and ${schema.messageRewrite.createdAt} < ${today.subtract({ days: 7 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`.as(
						'previous_week_count'
					),
				currentMonthCount:
					sql<number>`cast(count(*) filter (where ${schema.messageRewrite.createdAt} >= ${today.subtract({ days: 30 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`.as(
						'current_month_count'
					),
				previousMonthCount:
					sql<number>`cast(count(*) filter (where ${schema.messageRewrite.createdAt} >= ${today.subtract({ days: 60 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz and ${schema.messageRewrite.createdAt} < ${today.subtract({ days: 30 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`.as(
						'previous_month_count'
					),
				currentQuarterCount:
					sql<number>`cast(count(*) filter (where ${schema.messageRewrite.createdAt} >= ${today.subtract({ days: 90 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`.as(
						'current_quarter_count'
					),
				previousQuarterCount:
					sql<number>`cast(count(*) filter (where ${schema.messageRewrite.createdAt} >= ${today.subtract({ days: 180 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz and ${schema.messageRewrite.createdAt} < ${today.subtract({ days: 90 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`.as(
						'previous_quarter_count'
					),
				currentHalfYearCount:
					sql<number>`cast(count(*) filter (where ${schema.messageRewrite.createdAt} >= ${today.subtract({ days: 180 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`.as(
						'current_half_year_count'
					),
				previousHalfYearCount:
					sql<number>`cast(count(*) filter (where ${schema.messageRewrite.createdAt} >= ${today.subtract({ days: 360 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz and ${schema.messageRewrite.createdAt} < ${today.subtract({ days: 180 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`.as(
						'previous_half_year_count'
					)
			})
			.from(schema.errorIdentity)
			.innerJoin(
				schema.messageRewrite,
				eq(schema.errorIdentity.id, schema.messageRewrite.errorIdentityId)
			)
			.where(
				and(
					eq(schema.errorIdentity.userId, signedInUser.id),
					isNull(schema.errorIdentity.archivedAt)
				)
			)
			.groupBy(schema.errorIdentity.id)
	);

	const errorIdentities = Array.from(
		Map.groupBy(
			await db
				.with(counts)
				.select({
					id: counts.id,
					targetLanguage: counts.targetLanguage,
					label: counts.label,
					diagnosis: schema.errorDiagnosis.diagnosis,
					currentWeekCount: counts.currentWeekCount,
					previousWeekCount: counts.previousWeekCount,
					currentMonthCount: counts.currentMonthCount,
					previousMonthCount: counts.previousMonthCount,
					currentQuarterCount: counts.currentQuarterCount,
					previousQuarterCount: counts.previousQuarterCount,
					currentHalfYearCount: counts.currentHalfYearCount,
					previousHalfYearCount: counts.previousHalfYearCount
				})
				.from(counts)
				.leftJoin(schema.errorDiagnosis, eq(counts.id, schema.errorDiagnosis.errorIdentityId)),
			({ targetLanguage }) => targetLanguage
		),
		([_, records]) => {
			const firstRecord = records.at(0);

			// This should never happen, but just in case, throw an error.
			if (!firstRecord) throw new Error('No record found');

			return {
				targetLanguage: firstRecord.targetLanguage,
				errorIdentities: records.map(
					({
						id,
						label,
						diagnosis,
						currentWeekCount,
						previousWeekCount,
						currentMonthCount,
						previousMonthCount,
						currentQuarterCount,
						previousQuarterCount,
						currentHalfYearCount,
						previousHalfYearCount
					}) => ({
						id,
						label,
						diagnosis,
						currentWeekCount,
						previousWeekCount,
						currentMonthCount,
						previousMonthCount,
						currentQuarterCount,
						previousQuarterCount,
						currentHalfYearCount,
						previousHalfYearCount
					})
				)
			};
		}
	);

	const messages = await db
		.select({
			targetLanguage: schema.chat.targetLanguage,
			currentWeekCount: sql<number>`cast(count(*) filter (where ${schema.message.createdAt} >= ${today.subtract({ days: 7 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`,
			previousWeekCount: sql<number>`cast(count(*) filter (where ${schema.message.createdAt} >= ${today.subtract({ days: 14 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz and ${schema.message.createdAt} < ${today.subtract({ days: 7 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`,
			currentMonthCount: sql<number>`cast(count(*) filter (where ${schema.message.createdAt} >= ${today.subtract({ days: 30 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`,
			previousMonthCount: sql<number>`cast(count(*) filter (where ${schema.message.createdAt} >= ${today.subtract({ days: 60 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz and ${schema.message.createdAt} < ${today.subtract({ days: 30 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`,
			currentQuarterCount: sql<number>`cast(count(*) filter (where ${schema.message.createdAt} >= ${today.subtract({ days: 90 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`,
			previousQuarterCount: sql<number>`cast(count(*) filter (where ${schema.message.createdAt} >= ${today.subtract({ days: 180 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz and ${schema.message.createdAt} < ${today.subtract({ days: 90 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`,
			currentHalfYearCount: sql<number>`cast(count(*) filter (where ${schema.message.createdAt} >= ${today.subtract({ days: 180 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`,
			previousHalfYearCount: sql<number>`cast(count(*) filter (where ${schema.message.createdAt} >= ${today.subtract({ days: 360 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz and ${schema.message.createdAt} < ${today.subtract({ days: 180 }).toDate(signedInUser.timeZone).toISOString()}::timestamptz) as int)`
		})
		.from(schema.message)
		.innerJoin(schema.chat, eq(schema.message.chatId, schema.chat.id))
		.where(and(eq(schema.chat.userId, signedInUser.id), eq(schema.message.role, 'user')))
		.groupBy(schema.chat.targetLanguage);

	return { errorIdentities, messages };
};

export const actions = {
	giveFeedback: async ({ locals, request }) => {
		const signedInUser = requireUserSession(locals);
		if (!signedInUser) return redirect(303, '/login');

		try {
			const mistakesByLanguage = (
				await db
					.select({
						payload: schema.exercise.payload,
						targetLanguage: schema.exercise.targetLanguage
					})
					.from(schema.exercise)
					.where(
						and(eq(schema.exercise.userId, signedInUser.id), isNull(schema.exercise.archivedAt))
					)
					.orderBy(desc(schema.exercise.createdAt))
			).reduce((mistakesByLanguage, exercise) => {
				const languageMistakes = mistakesByLanguage.get(exercise.targetLanguage) ?? [];
				const { type, version, payload } = parseExercisePayload(exercise.payload);

				if (type === 'full_answer') {
					if (version === 1) {
						languageMistakes.push({ wrote: payload.front, instead: payload.back, note: null });
						mistakesByLanguage.set(exercise.targetLanguage, languageMistakes);
					} else {
						throw new Error('Undefined exercise type or version');
					}
				} else {
					throw new Error('Undefined exercise type or version');
				}

				return mistakesByLanguage;
			}, new Map<typeof schema.exercise.$inferSelect.targetLanguage, { wrote: string; instead: string; note: string | null }[]>());

			if (mistakesByLanguage.size <= 0) {
				return giveFeedback.ok({ data: null });
			}

			const llmResponses = await Promise.all(
				Array.from(mistakesByLanguage).map(([targetLanguage, mistakes]) =>
					retry({
						fn: async () => {
							const chatCompletion = await openai.chat.completions.create({
								messages: buildErrorPatternPrompt({
									nativeLanguage: signedInUser.nativeLanguage,
									targetLanguage,
									mistakes
								}),
								response_format: errorPatternsResponseFormat,
								model: LLM_MODEL,
								reasoning_effort: 'low',
								max_completion_tokens: 2048
							});

							return {
								targetLanguage,
								...parseLlmResponse(
									chatCompletion.choices.at(0)?.message.content,
									errorPatternsOutputSchema
								)
							};
						}
					})
				)
			);

			await db.insert(schema.feedback).values(
				llmResponses.map(({ patterns }) => ({
					userId: signedInUser.id,
					payload: { version: 1 as const, payload: { patterns } }
				}))
			);
		} catch (error) {
			console.error(error);
			return giveFeedback.fail({ error: { code: 'unexpected' }, status: 500 });
		}

		return giveFeedback.ok({ data: null });
	},
	diagnose: async ({ locals, request }) => {
		const signedInUser = requireUserSession(locals);
		if (!signedInUser) return redirect(303, '/login');

		const formData = await request.formData();
		const formDataParse = z
			.object({ errorIdentityId: z.coerce.number().int().positive() })
			.safeParse({
				errorIdentityId: formData.get('error_identity_id')?.toString() ?? '-1'
			});

		if (!formDataParse.success) {
			console.error(formDataParse.error.issues);
			return giveFeedback.fail({ error: { code: 'invalid_input' }, status: 400 });
		}

		const { errorIdentityId } = formDataParse.data;
		const previousRewrite = alias(schema.messageRewrite, 'previous_rewrite');
		const samples = await db
			.select({
				messageRewriteId: schema.messageRewrite.id,
				label: schema.errorIdentity.label,
				appliesWhen: schema.errorIdentity.appliesWhen,
				targetLanguage: schema.errorIdentity.targetLanguage,
				text: sql<string>`coalesce(${previousRewrite.text}, ${schema.message.content})`,
				reason: schema.messageRewrite.reason
			})
			.from(schema.errorIdentity)
			.innerJoin(
				schema.messageRewrite,
				eq(schema.messageRewrite.errorIdentityId, schema.errorIdentity.id)
			)
			.innerJoin(schema.message, eq(schema.message.id, schema.messageRewrite.messageId))
			.leftJoin(
				previousRewrite,
				and(
					eq(previousRewrite.messageId, schema.messageRewrite.messageId),
					eq(previousRewrite.index, sql<number>`${schema.messageRewrite.index} - 1`)
				)
			)
			.where(
				and(
					eq(schema.errorIdentity.id, errorIdentityId),
					eq(schema.errorIdentity.userId, signedInUser.id),
					isNull(schema.errorIdentity.archivedAt)
				)
			)
			.orderBy(desc(schema.messageRewrite.createdAt))
			.limit(8);

		const latestSample = samples.at(0);
		if (!latestSample || samples.length < 4) {
			return giveFeedback.ok({ data: null });
		}

		try {
			const llmResponse = await retry({
				fn: async () => {
					const chatCompletion = await openai.chat.completions.create({
						messages: buildErrorDiagnosisPrompt({
							nativeLanguage: signedInUser.nativeLanguage,
							targetLanguage: latestSample.targetLanguage,
							label: latestSample.label,
							appliesWhen: latestSample.appliesWhen,
							samples: samples.map(({ text, reason }) => ({ text, reason }))
						}),
						response_format: errorDiagnosisResponseFormat,
						model: LLM_MODEL,
						reasoning_effort: 'low',
						max_completion_tokens: 2048
					});

					return parseLlmResponse(
						chatCompletion.choices.at(0)?.message.content,
						errorDiagnosisOutputSchema
					);
				}
			});

			const diagnosis = llmResponse.diagnosis;

			if (diagnosis === null) {
				await db
					.delete(schema.errorDiagnosis)
					.where(eq(schema.errorDiagnosis.errorIdentityId, errorIdentityId));
				return giveFeedback.ok({ data: null });
			}

			await db.transaction(async (tx) => {
				await tx
					.insert(schema.errorDiagnosis)
					.values({ errorIdentityId, diagnosis, createdAt: new Date() })
					.onConflictDoUpdate({
						target: schema.errorDiagnosis.errorIdentityId,
						set: { diagnosis, createdAt: new Date() }
					});

				await tx
					.delete(schema.errorDiagnosisMessageRewrite)
					.where(eq(schema.errorDiagnosisMessageRewrite.errorIdentityId, errorIdentityId));

				await tx
					.insert(schema.errorDiagnosisMessageRewrite)
					.values(samples.map(({ messageRewriteId }) => ({ errorIdentityId, messageRewriteId })));
			});
		} catch (error) {
			console.error(error);
			return giveFeedback.fail({ error: { code: 'unexpected' }, status: 500 });
		}

		return giveFeedback.ok({ data: null });
	}
} satisfies Actions;
