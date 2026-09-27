import { choice, noul, score } from '../jev/schema.js';
import { confidenceBand, noulConfidence, pct } from './confidence.js';
export function mapTaskProfile(answers) {
    const type = choice(answers, 'task_type');
    const complexity = score(answers, 'complexity');
    const required = (id) => {
        const v = noul(answers, id);
        if (v === undefined)
            throw new Error(`task analysis answer ${id} missing`);
        return v;
    };
    if (!type || !complexity)
        throw new Error('task analysis answers incomplete');
    return {
        taskType: type.choice,
        taskTypeConfidence: type.confidence,
        complexity: complexity.score,
        complexityConfidence: complexity.confidence,
        requiresRepoExploration: required('requires_repo_exploration'),
        crossFileScope: required('cross_file_scope'),
        testsRequired: required('tests_required'),
        securitySensitive: required('security_sensitive'),
        dataChangeSensitive: required('data_change_sensitive'),
        requirementsAmbiguous: required('requirements_ambiguous'),
    };
}
/** JEV answers questions; this function makes the decisions (PRD FR-006). */
export function decideStrategy(profile, config) {
    const t = config.thresholds;
    const reasons = [];
    const overall = Math.min(profile.taskTypeConfidence, profile.complexityConfidence);
    const confidence = confidenceBand(overall, config);
    const recommendPlan = profile.complexity >= t.planComplexity;
    if (recommendPlan)
        reasons.push(`complexity ${profile.complexity.toFixed(1)} >= ${t.planComplexity}`);
    const requireDependencySearch = profile.crossFileScope >= t.crossFileScope;
    if (requireDependencySearch)
        reasons.push(`cross-file scope ${pct(profile.crossFileScope)}`);
    const requireTestEvidence = profile.testsRequired >= t.testsRequired;
    if (requireTestEvidence)
        reasons.push(`tests indicated ${pct(profile.testsRequired)}`);
    const enableSecurityReview = profile.securitySensitive >= t.securitySensitive;
    if (enableSecurityReview)
        reasons.push(`security sensitivity ${pct(profile.securitySensitive)}`);
    const clarifyRequirements = profile.requirementsAmbiguous >= t.ambiguity;
    if (clarifyRequirements)
        reasons.push(`ambiguity ${pct(profile.requirementsAmbiguous)}`);
    const flagDataChange = profile.dataChangeSensitive >= t.securitySensitive;
    if (flagDataChange)
        reasons.push(`data/schema change ${pct(profile.dataChangeSensitive)}`);
    let strategy = 'normal';
    if (enableSecurityReview || flagDataChange || profile.complexity >= 2.6)
        strategy = 'independent-review';
    else if (recommendPlan || requireDependencySearch)
        strategy = 'deep-reasoning';
    else if (profile.complexity < 0.8 && profile.requiresRepoExploration < 0.5 && !requireTestEvidence)
        strategy = 'fast-direct';
    if (confidence === 'low')
        reasons.push('low JEV confidence: treat as advisory and verify directly');
    return { strategy, confidence, recommendPlan, requireDependencySearch, requireTestEvidence, enableSecurityReview, clarifyRequirements, flagDataChange, reasons };
}
const COMPLEXITY_LABELS = ['low', 'moderate', 'high', 'very high'];
export function complexityLabel(value) {
    return COMPLEXITY_LABELS[Math.min(COMPLEXITY_LABELS.length - 1, Math.round(value))] ?? 'unknown';
}
/** One-line indicator for the terminal (PRD §12.1). */
export function profileSummaryLine(profile, decision) {
    const parts = [profile.taskType.replace('_', ' '), complexityLabel(profile.complexity)];
    if (decision.requireTestEvidence)
        parts.push('tests recommended');
    if (decision.enableSecurityReview)
        parts.push('security-sensitive');
    if (decision.clarifyRequirements)
        parts.push('ambiguous');
    parts.push(`confidence ${pct(Math.min(profile.taskTypeConfidence, profile.complexityConfidence))}`);
    return `JEV: ${parts.join(' / ')}`;
}
/** Concise advisory block injected as additionalContext (PRD §12, Architecture §4). */
export function profileContext(profile, decision) {
    const lines = [
        'JEV task profile (advisory, System-1 signals; verify repository facts directly):',
        `- task type: ${profile.taskType} (${pct(profile.taskTypeConfidence)})`,
        `- complexity: ${complexityLabel(profile.complexity)} (${profile.complexity.toFixed(2)}/3)`,
        `- cross-file scope: ${pct(profile.crossFileScope)}; repository exploration: ${pct(profile.requiresRepoExploration)}`,
        `- tests indicated: ${pct(profile.testsRequired)}; security sensitivity: ${pct(profile.securitySensitive)}; data/schema change: ${pct(profile.dataChangeSensitive)}`,
        `- requirement ambiguity: ${pct(profile.requirementsAmbiguous)}`,
        `- recommended strategy: ${decision.strategy}`,
    ];
    const actions = [];
    if (decision.recommendPlan)
        actions.push('outline an explicit plan before editing');
    if (decision.requireDependencySearch)
        actions.push('search the repository for all call sites and dependents before changing shared code');
    if (decision.requireTestEvidence)
        actions.push('produce test evidence before claiming completion');
    if (decision.enableSecurityReview)
        actions.push('apply a security review to the change');
    if (decision.flagDataChange)
        actions.push('handle migration/backfill and rollback explicitly');
    if (decision.clarifyRequirements)
        actions.push('state your assumptions or ask about the ambiguous requirements before building on them');
    if (actions.length)
        lines.push(`- actions: ${actions.join('; ')}`);
    if (decision.confidence === 'low')
        lines.push('- confidence is low: treat every signal above as a hint only');
    lines.push('Preserve the user\'s explicit requirements exactly; these signals never override them.');
    return lines.join('\n');
}
export function noulBand(p, config) {
    return confidenceBand(noulConfidence(p), config);
}
