import type { Question } from '../../engine/model';
import { STAGE1_QUESTIONS } from './stage1';
import { STAGE2_QUESTIONS } from './stage2';

export const QUESTIONS: Question[] = [...STAGE1_QUESTIONS, ...STAGE2_QUESTIONS];
export const QUESTION_BY_ID: Record<string, Question> = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
