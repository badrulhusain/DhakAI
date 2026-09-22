'use client';
import { useCallback, useEffect, useState } from 'react';
import { learningDiagramSchema, type AgentRecord, type LearningDiagram, type MergeEligibility, type MergeOperation, type PublicQuiz, type QuizAttempt } from '@classroom/shared';
import confetti from 'canvas-confetti';
import DrawingScore from './drawing-score';
import LearningDiagramView from './learning-diagram';
import { backendFetch } from '../lib/backend-fetch';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await backendFetch(url, init); const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { code: data.code, status: response.status, details: data.details });
  return data;
}

export default function QuizMerge({ agent, backend, version, explanationCompleted }: { agent: AgentRecord; backend: string; version: string; explanationCompleted: boolean }) {
  const endpoint = `${backend}/api/agents/${agent.id}`;
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null); const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({}); const [eligibility, setEligibility] = useState<MergeEligibility | null>(null);
  const [operation, setOperation] = useState<MergeOperation | null>(null); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [achievementTick, setAchievementTick] = useState(0);
  const [diagram, setDiagram] = useState<LearningDiagram | null>(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [diagramError, setDiagramError] = useState('');
  const celebrate = () => { if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) void confetti({ particleCount: 60, spread: 55, origin: { y: .75 }, disableForReducedMotion: true, scalar: .8, ticks: 130 }); };
  const refreshEligibility = useCallback(async () => { try { setEligibility(await api(`${endpoint}/merge/eligibility`)); } catch (e) { setError((e as Error).message); } }, [endpoint]);
  const loadQuiz = useCallback(async () => { if (!explanationCompleted) { setQuiz(null); return; } try { const data = await api<{ quiz: PublicQuiz | null }>(`${endpoint}/quiz`); setQuiz(data.quiz); } catch (e) { const problem = e as Error & { code?: string }; if (problem.code !== 'EXPLANATION_REQUIRED') setError(problem.message); } }, [endpoint, explanationCompleted]);
  useEffect(() => { setAnswers({}); setAttempt(null); setOperation(null); setError(''); setDiagram(null); setDiagramError(''); void loadQuiz(); void refreshEligibility(); }, [version, loadQuiz, refreshEligibility]);
  async function generate() { setBusy('generate'); setError(''); try { const data = await api<{ quiz: PublicQuiz }>(`${endpoint}/quiz`, { method: 'POST' }); setQuiz(data.quiz); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }
  async function generateAutoDiagram() { setDiagramLoading(true); setDiagramError(''); try { const data = await api<{ diagram: unknown }>(`${endpoint}/diagram`, { method: 'POST' }); const parsed = learningDiagramSchema.safeParse(data.diagram); if (!parsed.success) throw new Error('The backend returned an older flowchart format. Restart both services with npm run dev, then try again.'); setDiagram(parsed.data); } catch (e) { setDiagram(null); setDiagramError((e as Error).message); } finally { setDiagramLoading(false); } }
  async function submit() {
    if (!quiz) return; setBusy('submit'); setError('');
    try { const data = await api<{ attempt: QuizAttempt; achievements?: { awardedEvents?: string[]; awardedBadges?: string[] } }>(`${endpoint}/quiz/attempts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, quizId: quiz.id, submissionId: crypto.randomUUID(), answers: quiz.questions.map(question => ({ questionId: question.id, optionId: answers[question.id] })) }) }); setAttempt(data.attempt); setQuiz({ ...quiz, attemptCount: quiz.attemptCount + 1, passed: quiz.passed || data.attempt.passed }); if (data.achievements?.awardedEvents?.length || data.achievements?.awardedBadges?.length) { celebrate(); setAchievementTick(tick => tick + 1); } await refreshEligibility(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function merge() { setBusy('merge'); setError(''); try { const data = await api<{ operation: MergeOperation; achievements?: { awardedEvents?: string[]; awardedBadges?: string[] } }>(`${endpoint}/merge`, { method: 'POST' }); setOperation(data.operation); if (data.achievements?.awardedEvents?.length || data.achievements?.awardedBadges?.length) { celebrate(); setAchievementTick(tick => tick + 1); } await refreshEligibility(); } catch (e) { setError((e as Error).message); const details = (e as { details?: MergeOperation }).details; if (details?.resultCommit) setOperation(details); } finally { setBusy(''); } }
  const flowState = (complete: boolean, available: boolean, active = false) => complete ? 'completed' : active ? 'in-progress' : available ? 'available' : 'locked';
  return <section className="quiz-merge" aria-label="Quiz, drawing, score, and merge gate"><ol className="flow-steps" aria-label="Learning progress"><li className="completed"><strong>Agent</strong><small>Completed</small></li><li className="completed"><strong>Review</strong><small>Completed</small></li><li className={flowState(explanationCompleted, true, !explanationCompleted)}><strong>Explain</strong><small>{explanationCompleted ? 'Completed' : 'In progress'}</small></li><li className={flowState(!!quiz?.passed, explanationCompleted, !!quiz && !quiz.passed)}><strong>Quiz</strong><small>{quiz?.passed ? 'Completed' : quiz ? 'In progress' : explanationCompleted ? 'Available' : 'Locked'}</small></li><li className={flowState(false, !!quiz?.passed)}><strong>Draw</strong><small>{quiz?.passed ? 'Available' : 'Locked'}</small></li><li className={flowState(operation?.status === 'succeeded', !!eligibility?.eligible, busy === 'merge')}><strong>Merge</strong><small>{operation?.status === 'succeeded' ? 'Completed' : busy === 'merge' ? 'In progress' : eligibility?.eligible ? 'Available' : 'Locked'}</small></li></ol>
    <div className="quiz-heading"><div><h2>Knowledge checkpoint</h2><p>{agent.runner === 'demo' ? 'The bundled demo uses three deterministic questions and sends nothing to Groq.' : 'Generating sends the reviewed code changes to Groq. Secret-like files are blocked server-side.'}</p></div>{quiz && <span className="quiz-label">{quiz.label}</span>}</div>
    {!explanationCompleted && <div className="review-notice">Complete the explanation for this exact review version to unlock the quiz.</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {explanationCompleted && !quiz && (
      <div className="quiz-create">
        <button className="primary-review" disabled={!!busy} onClick={generate}>{busy === 'generate' ? 'Generating three questions…' : agent.runner === 'demo' ? 'Create Demo quiz' : 'Generate quiz with Groq'}</button>
        {agent.runner !== 'demo' && <span>Uses the server-configured Groq model.</span>}
      </div>
    )}
    {quiz && <div className="quiz-form">{quiz.questions.map((question, index) => { const feedback = attempt?.feedback.find(item => item.questionId === question.id); return <fieldset key={question.id}><legend>{index + 1}. {question.prompt}</legend><p className="quiz-evidence">Evidence: {question.evidence.path} — “{question.evidence.excerpt}”</p>{question.options.map(option => <label key={option.id} className={feedback ? option.id === feedback.correctOptionId ? 'quiz-correct' : option.id === feedback.selectedOptionId ? 'quiz-incorrect' : '' : ''}><input type="radio" name={`question-${question.id}`} value={option.id} checked={answers[question.id] === option.id} disabled={!!attempt || !!busy} onChange={() => setAnswers({ ...answers, [question.id]: option.id })} /><span>{option.text}</span></label>)}{feedback && <p className={feedback.correct ? 'feedback correct' : 'feedback incorrect'}>{feedback.correct ? 'Correct. ' : 'Not quite. '}{feedback.explanation}</p>}</fieldset> })}
      {!attempt ? <button className="primary-review" disabled={!!busy || quiz.questions.some(question => !answers[question.id])} onClick={submit}>{busy === 'submit' ? 'Grading…' : 'Submit answers'}</button> : <div className="quiz-result" role="status"><strong>Score: {attempt.score}/3</strong><span>{attempt.passed ? 'Passed' : '3/3 is required to pass.'}</span>{!attempt.passed && <button onClick={() => { setAttempt(null); setAnswers({}); }}>Retry quiz</button>}<small>Attempt {quiz.attemptCount}. Passing is a learning checkpoint, not proof that the software is correct.</small></div>}
    </div>}
    {quiz && <DrawingScore agentId={agent.id} backend={backend} version={version} quizPassed={quiz.passed} achievementTick={achievementTick} />}
    {quiz && quiz.passed && (
      <section className="drawing-section learning-diagram-section">
        <div className="phase4-heading"><div><span className="eyebrow">LEARNING FLOWCHART</span><h2>See the change as a flow</h2><p>{agent.runner === 'demo' ? 'Built locally from the deterministic Demo change.' : 'Generated from this exact reviewed version using the configured Groq model.'}</p></div><span className="drawing-status">{diagram ? 'Ready' : 'Optional'}</span></div>
        {!diagram && <button className="primary-review diagram-generate" disabled={diagramLoading} onClick={generateAutoDiagram}>{diagramLoading ? 'Building flowchart…' : agent.runner === 'demo' ? 'Build Demo flowchart' : 'Generate flowchart'}</button>}
        {diagramError && <div className="error" role="alert">{diagramError}</div>}
        {diagram && <><LearningDiagramView diagram={diagram}/><button className="diagram-regenerate" disabled={diagramLoading} onClick={generateAutoDiagram}>{diagramLoading ? 'Rebuilding…' : 'Rebuild flowchart'}</button></>}
      </section>
    )}
    <div className="merge-gate" style={{ marginTop: '28px' }}><h2>Merge gate</h2><p className="drawing-policy"><strong>Drawing earns bonus points and is optional for merge.</strong> Explanation, quiz, unchanged review content, repository safety, and Git checks remain required.</p>{eligibility && !eligibility.eligible && <ul>{eligibility.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}><code>{blocker.code}</code> {blocker.message}</li>)}</ul>}{eligibility?.eligible && !eligibility.existingOperation?.resultCommit && <p className="merge-ready">All server-side checks pass for version {eligibility.version?.slice(0, 10)}.</p>}<button className="primary-review" disabled={!eligibility?.eligible || !!busy || !!eligibility.existingOperation?.resultCommit} onClick={merge}>{busy === 'merge' ? 'Preparing and verifying merge…' : eligibility?.existingOperation?.resultCommit ? 'Already merged' : 'Merge reviewed changes'}</button>{(operation ?? eligibility?.existingOperation)?.resultCommit && <div className="merge-success" role="status"><strong>Merged successfully</strong><span>Branch: {(operation ?? eligibility?.existingOperation)!.branch}</span><code>{(operation ?? eligibility?.existingOperation)!.resultCommit}</code>{(operation ?? eligibility?.existingOperation)!.validation && <small>Validation: {(operation ?? eligibility?.existingOperation)!.validation!.status} — {(operation ?? eligibility?.existingOperation)!.validation!.message}</small>}</div>}</div>
  </section>;
}
