import { completionThresholds } from '../core/config.js';
import { noul, score } from '../jev/schema.js';
import { pct } from './confidence.js';
const REGRESSION_LABELS = ['low', 'limited', 'significant', 'high'];
function label(value) {
    return REGRESSION_LABELS[Math.min(3, Math.round(value))] ?? 'unknown';
}
/** Converts completion-review answers into a pass/repair decision (PRD FR-011/FR-012). */
export function evaluateCompletion(answers, requirements, config, testEvidenceExpected) {
    const t = completionThresholds(config);
    const get = (id) => {
        const v = noul(answers, id);
        if (v === undefined)
            throw new Error(`completion answer ${id} missing`);
        return v;
    };
    const implementationComplete = get('implementation_complete');
    const testsSufficient = get('tests_sufficient');
    const unresolvedRequirement = get('has_unresolved_requirement');
    const likelyRegression = get('has_likely_regression');
    const securityConcern = get('has_security_concern');
    const needsRepositoryCheck = get('needs_additional_repository_check');
    const regressionRisk = score(answers, 'regression_risk')?.score ?? 0;
    const verdicts = requirements.map((req, i) => ({
        id: req.id,
        text: req.text,
        source: req.source,
        satisfied: noul(answers, `satisfied_r${i}`) ?? 1,
        evidenceStrength: score(answers, `evidence_r${i}`)?.score ?? 3,
    }));
    const deficiencies = [];
    if (implementationComplete < t.implementationComplete)
        deficiencies.push(`implementation completeness ${pct(implementationComplete)} is below ${pct(t.implementationComplete)}: re-check the request against what was actually changed`);
    if (unresolvedRequirement > t.unresolvedRequirement)
        deficiencies.push(`an explicit requirement appears unresolved (${pct(unresolvedRequirement)})`);
    for (const v of verdicts) {
        const explicitBar = v.source === 'explicit' ? 0.6 : 0.4;
        if (v.satisfied < explicitBar || (v.source === 'explicit' && v.evidenceStrength < 1)) {
            deficiencies.push(`${v.id} (${v.source}): "${v.text}" satisfied ${pct(v.satisfied)}, evidence ${v.evidenceStrength.toFixed(1)}/3`);
        }
    }
    if (testEvidenceExpected && testsSufficient < t.testsSufficient)
        deficiencies.push(`test evidence insufficient (${pct(testsSufficient)}) for a change where tests are indicated`);
    if (likelyRegression > t.likelyRegression)
        deficiencies.push(`likely regression (${pct(likelyRegression)}, surface ${label(regressionRisk)}): verify callers and existing behavior`);
    if (securityConcern > t.securityConcern)
        deficiencies.push(`security concern (${pct(securityConcern)}): run a focused security review of the change`);
    const escalateToVerifier = likelyRegression > t.likelyRegression || securityConcern > t.securityConcern || (needsRepositoryCheck > 0.6 && deficiencies.length > 0);
    const decision = deficiencies.length ? 'repair' : 'pass';
    return { decision, implementationComplete, testsSufficient, unresolvedRequirement, likelyRegression, securityConcern, needsRepositoryCheck, regressionRisk, requirements: verdicts, deficiencies, escalateToVerifier };
}
export function renderVerdict(v) {
    const satisfied = v.requirements.filter((r) => r.satisfied >= 0.6).length;
    const lines = [
        'JEV Completion Review',
        `Requirements: ${satisfied}/${v.requirements.length} likely satisfied`,
        `Implementation completeness: ${v.implementationComplete.toFixed(2)}`,
        `Test sufficiency: ${v.testsSufficient.toFixed(2)}`,
        `Regression risk: ${label(v.regressionRisk)} (${pct(v.likelyRegression)} likely)`,
        `Security risk: ${pct(v.securityConcern)}`,
        `Decision: ${v.decision === 'pass' ? 'pass' : v.decision === 'repair' ? 'repair required' : 'manual review required'}`,
    ];
    for (const d of v.deficiencies)
        lines.push(`- ${d}`);
    if (v.escalateToVerifier)
        lines.push('Consider delegating to the jev-copilot:jev-verifier agent for evidence-based inspection.');
    return lines.join('\n');
}
