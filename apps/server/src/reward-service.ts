import { randomUUID } from 'node:crypto';
import type { BadgeKey, PointEvent, ScoreActivity, ScoreSummary } from '@classroom/shared';
import type { LearningStore } from './learning-store.js';
import { ServiceError } from './service-error.js';

const points: Record<PointEvent, { label: string; points: number }> = {
  explanation_completed: { label: 'Explanation', points: 20 },
  quiz_passed: { label: 'Quiz', points: 50 },
  quiz_first_attempt: { label: 'First-attempt bonus', points: 10 },
  drawing_completed: { label: 'Drawing', points: 5 },
  drawing_checklist_complete: { label: 'Drawing checklist', points: 5 },
  merge_verified: { label: 'Verified merge', points: 10 },
};

export class RewardService {
  constructor(private store: LearningStore) {}

  async sync(agentId: string, reviewVersion: string) {
    const explanation = await this.store.getExplanation(agentId, reviewVersion);
    const attempts = await this.store.listAttempts(agentId, reviewVersion);
    const drawing = await this.store.getDrawing(agentId, reviewVersion);
    const checklist = await this.store.getChecklist(agentId, reviewVersion);
    const merge = await this.store.getMerge(agentId, reviewVersion);
    const earned = new Set<PointEvent>();
    if (explanation?.status === 'completed') earned.add('explanation_completed');
    if (attempts.some(attempt => attempt.passed)) earned.add('quiz_passed');
    if (attempts[0]?.passed) earned.add('quiz_first_attempt');
    if (drawing?.status === 'completed') earned.add('drawing_completed');
    if (drawing?.status === 'completed' && checklist?.completed) earned.add('drawing_checklist_complete');
    if (merge?.status === 'succeeded' && merge.resultCommit) earned.add('merge_verified');

    const awardedEvents: PointEvent[] = [];
    for (const event of earned) {
      const award = await this.store.awardPoint({ id: randomUUID(), agentId, reviewVersion, event, points: points[event].points, createdAt: new Date().toISOString() });
      if (award.awarded) awardedEvents.push(event);
    }
    const badgeRules: Array<[BadgeKey, boolean]> = [
      ['code_reader', earned.has('explanation_completed')],
      ['quiz_master', earned.has('quiz_first_attempt')],
      ['visual_thinker', earned.has('drawing_completed') && earned.has('drawing_checklist_complete')],
      ['safe_merger', earned.has('merge_verified')],
      ['full_journey', ['explanation_completed', 'quiz_passed', 'drawing_completed', 'drawing_checklist_complete', 'merge_verified'].every(event => earned.has(event as PointEvent))],
    ];
    const awardedBadges: BadgeKey[] = [];
    for (const [badge, eligible] of badgeRules) if (eligible) {
      const award = await this.store.awardBadge({ id: randomUUID(), agentId, reviewVersion, badge, createdAt: new Date().toISOString() });
      if (award.awarded) awardedBadges.push(badge);
    }
    return { awardedEvents, awardedBadges };
  }

  async score(agentId: string, reviewVersion: string, stale = false): Promise<ScoreSummary> {
    try {
      await this.sync(agentId, reviewVersion);
      const transactions = await this.store.listPoints(agentId, reviewVersion);
      const badges = await this.store.listBadges(agentId, reviewVersion);
      const reviewerMark = await this.store.getReviewerMark(agentId, reviewVersion);
      const attempts = await this.store.listAttempts(agentId, reviewVersion);
      const byEvent = new Map(transactions.map(record => [record.event, record.points]));
      const activities: ScoreActivity[] = (Object.entries(points) as Array<[PointEvent, { label: string; points: number }]>).map(([event, definition]) => ({ event, label: definition.label, earned: byEvent.get(event) ?? 0, available: definition.points }));
      const total = transactions.reduce((sum, record) => sum + record.points, 0);
      const remaining = activities.reduce((sum, activity) => sum + (activity.earned ? 0 : activity.event === 'quiz_first_attempt' && attempts.length > 0 ? 0 : activity.available), 0);
      return { agentId, reviewVersion, stale, total, maximum: 100, remaining, activities, transactions, badges, drawingCompletion: { earned: (byEvent.get('drawing_completed') ?? 0) + (byEvent.get('drawing_checklist_complete') ?? 0), available: 10 }, reviewerMark };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('SCORE_UNAVAILABLE', `The learning score is temporarily unavailable: ${error instanceof Error ? error.message : 'storage error'}`, 503);
    }
  }
}
