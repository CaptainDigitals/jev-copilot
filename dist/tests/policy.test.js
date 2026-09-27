import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskAnalysisQuestions } from '../src/jev/questions/task.js';
import { completionQuestions, requirementCoverageQuestions } from '../src/jev/questions/completion.js';
import { contextQuestions } from '../src/jev/questions/context.js';
import { validateDecisionResponse } from '../src/jev/schema.js';
import { decideStrategy, mapTaskProfile, profileContext, profileSummaryLine } from '../src/policy/task-profile.js';
import { evaluateCompletion, renderVerdict } from '../src/policy/completion.js';
import { rankCandidates } from '../src/policy/context-rank.js';
import { fakeAnswers, testConfig } from './helpers.js';
const config = testConfig();
function answers(questions, overrides, defaults) {
    return validateDecisionResponse({ answers: fakeAnswers(questions, overrides, defaults) }, questions).answers;
}
test('task profile maps answers and picks a strategy from thresholds', () => {
    const simple = mapTaskProfile(answers(taskAnalysisQuestions, { task_type: 'documentation', complexity: 0.3, requires_repo_exploration: 0.2, tests_required: 0.1 }));
    assert.equal(decideStrategy(simple, config).strategy, 'fast-direct');
    const feature = mapTaskProfile(answers(taskAnalysisQuestions, { task_type: 'feature', complexity: 2.2, cross_file_scope: 0.9, tests_required: 0.95 }));
    const d = decideStrategy(feature, config);
    assert.equal(d.strategy, 'deep-reasoning');
    assert.ok(d.recommendPlan && d.requireDependencySearch && d.requireTestEvidence);
    assert.ok(!d.enableSecurityReview);
    assert.match(profileSummaryLine(feature, d), /^JEV: feature \/ high \/ tests recommended/);
    assert.match(profileContext(feature, d), /recommended strategy: deep-reasoning/);
    const secure = mapTaskProfile(answers(taskAnalysisQuestions, { task_type: 'security', complexity: 1.5, security_sensitive: 0.9 }));
    assert.equal(decideStrategy(secure, config).strategy, 'independent-review');
});
const requirements = [
    { id: 'RQ-01', source: 'explicit', text: 'Add OAuth login', verification: 'diff', severity: 'medium', status: 'open' },
    { id: 'INF-TEST', source: 'inferred', text: 'Provide test evidence', verification: 'tests', severity: 'medium', status: 'open' },
];
test('completion review passes when evidence is strong', () => {
    const qs = { ...completionQuestions, ...requirementCoverageQuestions(2) };
    const v = evaluateCompletion(answers(qs, { implementation_complete: 0.95, tests_sufficient: 0.9, has_unresolved_requirement: 0.05, has_likely_regression: 0.1, has_security_concern: 0.05, needs_additional_repository_check: 0.1, regression_risk: 0.4, satisfied_r0: 0.95, evidence_r0: 3, satisfied_r1: 0.9, evidence_r1: 2 }), requirements, config, true);
    assert.equal(v.decision, 'pass');
    assert.equal(v.deficiencies.length, 0);
    assert.match(renderVerdict(v), /Decision: pass/);
});
test('completion review requests repair with actionable deficiencies and escalates on regression', () => {
    const qs = { ...completionQuestions, ...requirementCoverageQuestions(2) };
    const v = evaluateCompletion(answers(qs, { implementation_complete: 0.6, tests_sufficient: 0.2, has_unresolved_requirement: 0.7, has_likely_regression: 0.8, has_security_concern: 0.1, needs_additional_repository_check: 0.9, regression_risk: 2.5, satisfied_r0: 0.3, evidence_r0: 0.5, satisfied_r1: 0.9, evidence_r1: 2 }), requirements, config, true);
    assert.equal(v.decision, 'repair');
    assert.ok(v.deficiencies.some((d) => d.startsWith('RQ-01')));
    assert.ok(v.deficiencies.some((d) => d.includes('test evidence insufficient')));
    assert.ok(v.deficiencies.some((d) => d.includes('likely regression')));
    assert.equal(v.escalateToVerifier, true);
    assert.match(renderVerdict(v), /repair required/);
});
test('strict mode thresholds are tighter than enhance', () => {
    const qs = completionQuestions;
    const borderline = { implementation_complete: 0.85, tests_sufficient: 0.6, has_unresolved_requirement: 0.3, has_likely_regression: 0.55, has_security_concern: 0.35, needs_additional_repository_check: 0.2, regression_risk: 1 };
    assert.equal(evaluateCompletion(answers(qs, borderline), [], config, false).decision, 'pass');
    assert.equal(evaluateCompletion(answers(qs, borderline), [], { ...config, mode: 'strict' }, false).decision, 'repair');
});
test('context ranking maps positional ids back to real paths only', () => {
    const candidates = [{ path: 'src/a.ts', summary: 'a' }, { path: 'src/b.ts', summary: 'b' }, { path: 'src/c.ts', summary: 'c' }];
    const ranked = rankCandidates(candidates, answers(contextQuestions(3), { relevance_c0: 0.5, relevance_c1: 2.8, needs_full_c1: 0.9, relevance_c2: 1.9 }), config);
    assert.deepEqual(ranked.map((r) => [r.path, r.band]), [['src/b.ts', 'full'], ['src/c.ts', 'excerpt'], ['src/a.ts', 'fallback']]);
    assert.ok(ranked.every((r) => candidates.some((c) => c.path === r.path)));
});
