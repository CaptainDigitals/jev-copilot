/**
 * Path exclusion for outbound repository evidence. Excluded files never have their
 * contents sent to JEV; at most their path may appear in a changed-file count.
 */
function globToRegExp(glob) {
    let out = '^';
    for (let i = 0; i < glob.length; i += 1) {
        const ch = glob[i];
        if (ch === '*') {
            if (glob[i + 1] === '*') {
                // "**/" matches zero or more directories; "**" alone matches anything.
                if (glob[i + 2] === '/') {
                    out += '(?:.*/)?';
                    i += 2;
                }
                else {
                    out += '.*';
                    i += 1;
                }
            }
            else {
                out += '[^/]*';
            }
        }
        else if (ch === '?') {
            out += '[^/]';
        }
        else if (ch !== undefined && /[.+^${}()|[\]\\]/.test(ch)) {
            out += `\\${ch}`;
        }
        else {
            out += ch;
        }
    }
    return new RegExp(`${out}$`, 'i');
}
export function normalizePath(path) {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}
export class PathPolicy {
    matchers;
    constructor(patterns) {
        this.matchers = patterns.map(globToRegExp);
    }
    /** Matches against the full relative path and against the basename for patterns like ".env". */
    isExcluded(path) {
        const normalized = normalizePath(path);
        const base = normalized.split('/').pop() ?? normalized;
        return this.matchers.some((m) => m.test(normalized) || m.test(base));
    }
    filter(paths) {
        return paths.filter((p) => !this.isExcluded(p));
    }
}
const SECURITY_SENSITIVE = [
    /auth/i, /login/i, /session/i, /token/i, /oauth/i, /jwt/i, /permission/i, /acl/i, /rbac/i,
    /crypt/i, /secret/i, /credential/i, /password/i, /security/i, /csrf/i, /cors/i, /sanitiz/i,
    /middleware/i, /firewall/i, /policy/i, /iam/i,
];
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py|rs)$|Test[A-Za-z]*\.(java|kt|cs|swift)$/i;
const MIGRATION_PATH = /(^|\/)(migrations?|db\/migrate|alembic|flyway|liquibase|prisma\/migrations)(\/|$)|\.migration\./i;
const CONFIG_PATH = /(^|\/)(\.github|\.gitlab-ci|Dockerfile|docker-compose|helm|terraform|k8s|kubernetes|infra|deploy)(\/|$)|\.(ya?ml|toml|ini|cfg|conf|env\.example)$|(^|\/)(package\.json|tsconfig\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|build\.gradle)$/i;
export function classifyFileRole(path) {
    const p = normalizePath(path);
    const roles = [];
    if (TEST_PATH.test(p))
        roles.push('test');
    if (MIGRATION_PATH.test(p))
        roles.push('migration');
    if (CONFIG_PATH.test(p))
        roles.push('config');
    if (SECURITY_SENSITIVE.some((r) => r.test(p)))
        roles.push('security');
    if (!roles.length)
        roles.push('source');
    return roles;
}
