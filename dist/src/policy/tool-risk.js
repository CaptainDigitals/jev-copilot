import { normalizePath, classifyFileRole } from '../security/exclusions.js';
const READ_ONLY_COMMANDS = /^(?:ls|dir|pwd|cat|head|tail|less|more|wc|grep|rg|ag|find|fd|which|where|whoami|echo|printf|type|stat|file|du|df|env|printenv|date|uname|tree|git\s+(?:status|log|diff|show|blame|branch(?:\s+-[avr]+)?|remote\s+-v|rev-parse|describe|ls-files|stash\s+list|tag(?:\s+-l)?)|npm\s+(?:ls|list|view|info|outdated|test|run\s+(?:test|lint|typecheck|check)\b)|pnpm\s+(?:ls|list|test|lint|typecheck)|yarn\s+(?:test|lint|typecheck)|node\s+--test|npx\s+(?:tsc\s+--noEmit|eslint|prettier\s+--check|vitest|jest|playwright\s+test)|python3?\s+-m\s+(?:pytest|unittest|mypy|ruff)|pytest|cargo\s+(?:test|check|clippy)|go\s+(?:test|vet)|dotnet\s+test|Get-ChildItem|Get-Content|Get-Item|Get-Location|Select-String|Test-Path|Get-Command|Get-Process)\b/i;
/** Tokens that make a recursive delete or move catastrophic: roots, home, parents, wildcards, system dirs. */
const DANGEROUS_TOKEN = /^["']?(?:\/|\/\*|~|~\/|~\/\*|\$HOME\/?|\$\{HOME\}\/?|%USERPROFILE%\\?|\$env:USERPROFILE\\?|\.\.|\.\.\/|\.\.\\|\*|\.\/?\*|[A-Za-z]:[\\/]?\*?|\/(?:etc|usr|var|home|bin|sbin|lib|opt|root|boot|System|Library|Applications|Users)(?:\/[^/]*)?|[A-Za-z]:[\\/](?:Windows|Users|Program Files(?: \(x86\))?)(?:[\\/][^\\/]*)?)["']?$/i;
function hasDangerousTarget(command) {
    return command.split(/\s+/).some((token) => DANGEROUS_TOKEN.test(token));
}
const PIPE_TO_SHELL = /(?:curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b|\|\s*(?:iex|Invoke-Expression)\b/i;
const FORCE_PUSH = /\bgit\s+push\b[^;&|]*(?:--force\b|-f\b|--force-with-lease\b)/i;
const HISTORY_REWRITE = /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s+\.|restore\s+(?:--staged\s+)?\.|filter-branch|rebase\b|branch\s+-D)/i;
const RECURSIVE_DELETE = /\b(?:rm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r)\b|rmdir\s+\/s|Remove-Item\b[^;&|]*-Recurse|del\s+\/[sq]|rd\s+\/s)/i;
const DESTRUCTIVE_DB = /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*;?\s*$|db:reset|migrate:fresh|prisma\s+migrate\s+reset|flushall|flushdb)\b/i;
const CREDENTIAL_PATHS = /(?:\.ssh\/|\.aws\/|\.gnupg\/|\.kube\/config|kubeconfig|\.npmrc|\.pypirc|\.netrc|\.docker\/config\.json|\.env\b|id_rsa|id_ed25519|credentials|\.pem\b|\.key\b)/i;
const CREDENTIAL_COMMANDS = /\b(?:gh\s+auth\s+(?:login|logout|refresh|token)|aws\s+configure|gcloud\s+auth|az\s+login|vault\s+(?:write|kv\s+put)|docker\s+login|npm\s+(?:login|adduser|token)|op\s+(?:signin|item))\b/i;
const DEPLOY = /\b(?:vercel\s+(?:--prod|deploy)|netlify\s+deploy|fly\s+deploy|heroku\s+(?:push|release)|kubectl\s+(?:apply|delete|rollout|scale|drain)|helm\s+(?:install|upgrade|uninstall|delete)|terraform\s+(?:apply|destroy)|pulumi\s+(?:up|destroy)|aws\s+\w+\s+(?:delete|terminate|put|update)|gcloud\s+\w+\s+(?:deploy|delete)|serverless\s+deploy|cdk\s+(?:deploy|destroy)|docker\s+(?:push|system\s+prune)|npm\s+publish|cargo\s+publish|twine\s+upload|gem\s+push)\b/i;
const PERMISSIONS = /\b(?:chmod\s+(?:-R\s+)?[0-7]*7[0-7]{2}\b|chmod\s+[a-z+]*\+[rwx]*x?\s+\/|chown\s+-R|icacls\b[^;&|]*\/grant|setfacl|sudo\s+(?:su|visudo|passwd|useradd|usermod)|net\s+user\b|Set-ExecutionPolicy\s+Unrestricted|Add-LocalGroupMember)\b/i;
const SYSTEM_MUTATION = /\b(?:mkfs|dd\s+if=|fdisk|diskpart|format\s+[a-z]:|shutdown|reboot|Stop-Computer|Restart-Computer|systemctl\s+(?:stop|disable|mask)|launchctl\s+unload|reg\s+(?:add|delete)|Set-ItemProperty\s+-Path\s+["']?HKLM|crontab\s+-r|kill\s+-9\s+-1|taskkill\s+\/f\s+\/im\s+\*)\b/i;
const PACKAGE_INSTALL = /\b(?:npm\s+(?:i|install|ci|add)|pnpm\s+(?:i|install|add)|yarn\s+(?:add|install)|pip3?\s+install|cargo\s+(?:add|install)|go\s+(?:get|install)|gem\s+install|brew\s+install|apt(?:-get)?\s+install|choco\s+install|winget\s+install|scoop\s+install|npx\s+(?!tsc|eslint|prettier|vitest|jest|playwright)\S+)\b/i;
const BULK_WRITE = /\b(?:sed\s+-i|perl\s+-pi|find\b[^|;&]*-exec\s+(?:rm|mv|sed)|xargs\s+(?:rm|mv|sed|chmod)|git\s+(?:add\s+-A|add\s+\.|commit\s+--amend|mv)|mv\s+\S+\s+\S+|Move-Item|Rename-Item)\b/i;
function stripQuotesForTargets(command) {
    const tokens = command.split(/\s+/).filter(Boolean);
    return tokens.filter((t) => !t.startsWith('-') && !/^(?:sudo|rm|del|rd|rmdir|Remove-Item|mv|cp|git|npm|node|python3?)$/i.test(t)).slice(0, 12);
}
function commandState(toolName, command) {
    const trimmed = command.trim();
    const recursive = RECURSIVE_DELETE.test(trimmed) || /\s-R\b|--recursive|-Recurse/.test(trimmed);
    const targets = stripQuotesForTargets(trimmed);
    const modifiesFilesystem = !READ_ONLY_COMMANDS.test(trimmed) || /[>]|tee\b/.test(trimmed);
    return {
        toolName,
        operation: trimmed.split(/\s+/)[0] ?? 'unknown',
        targets,
        parsedCommand: trimmed.slice(0, 2000),
        modifiesFilesystem,
        recursive,
        affectsRepoBoundary: hasDangerousTarget(trimmed) || /\bcd\s+(?:\/|~|\.\.)(?:\s|$)/.test(trimmed),
        touchesCredentials: CREDENTIAL_PATHS.test(trimmed) || CREDENTIAL_COMMANDS.test(trimmed),
        deploymentRelated: DEPLOY.test(trimmed),
    };
}
function fileState(toolName, filePath, cwd) {
    const normalized = normalizePath(filePath);
    const inside = !cwd || normalized.startsWith(normalizePath(cwd)) || !/^(?:[a-z]:\/|\/)/i.test(normalized);
    return {
        toolName,
        operation: toolName.toLowerCase(),
        targets: [normalized],
        modifiesFilesystem: true,
        recursive: false,
        affectsRepoBoundary: !inside,
        touchesCredentials: CREDENTIAL_PATHS.test(normalized),
        deploymentRelated: classifyFileRole(normalized).includes('config') && /(?:\.github\/workflows|deploy|helm|terraform|k8s)/i.test(normalized),
    };
}
/**
 * Deterministic classifier. Runs before any JEV call and its hard rules cannot be
 * overridden by JEV output (Security §6, Architecture §8).
 */
export function classifyToolAction(toolName, toolInput, cwd) {
    const reasons = [];
    if (toolName === 'Bash' || toolName === 'PowerShell') {
        const command = typeof toolInput.command === 'string' ? toolInput.command : '';
        const state = commandState(toolName, command);
        if (!command.trim())
            return { category: 'read-only', hardDeny: false, requireConfirmation: false, reasons: ['empty command'], state };
        if (PIPE_TO_SHELL.test(command))
            reasons.push('pipes remote content into a shell');
        if (RECURSIVE_DELETE.test(command) && state.affectsRepoBoundary)
            reasons.push('recursive delete targeting a root, home, parent or wildcard path');
        if (SYSTEM_MUTATION.test(command))
            reasons.push('mutates system or disk state');
        if (DESTRUCTIVE_DB.test(command))
            reasons.push('destructive database command');
        if (CREDENTIAL_COMMANDS.test(command) || (CREDENTIAL_PATHS.test(command) && /(?:>|rm\b|Remove-Item|mv\b|cp\b|cat\b|type\b|echo\b)/i.test(command)))
            reasons.push('touches credential stores or secret files');
        if (PERMISSIONS.test(command))
            reasons.push('broadens permissions or privileges');
        if (reasons.length)
            return { category: 'destructive', hardDeny: true, requireConfirmation: true, reasons, state };
        if (FORCE_PUSH.test(command))
            reasons.push('force push rewrites remote history');
        if (HISTORY_REWRITE.test(command))
            reasons.push('discards or rewrites local work/history');
        if (RECURSIVE_DELETE.test(command))
            reasons.push('recursive delete');
        if (DEPLOY.test(command))
            reasons.push('deployment or publish operation');
        if (reasons.length)
            return { category: 'destructive', hardDeny: false, requireConfirmation: true, reasons, state };
        if (PACKAGE_INSTALL.test(command))
            reasons.push('installs or executes third-party packages');
        if (BULK_WRITE.test(command))
            reasons.push('bulk filesystem or git mutation');
        if (/\bgit\s+(?:push|commit|merge|cherry-pick|tag\s+-a)/i.test(command))
            reasons.push('git history mutation');
        if (reasons.length)
            return { category: 'high', hardDeny: false, requireConfirmation: false, reasons, state };
        if (!state.modifiesFilesystem)
            return { category: 'read-only', hardDeny: false, requireConfirmation: false, reasons: ['read-only command'], state };
        return { category: 'ordinary', hardDeny: false, requireConfirmation: false, reasons: ['ordinary command'], state };
    }
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : typeof toolInput.notebook_path === 'string' ? toolInput.notebook_path : '';
    const state = fileState(toolName, filePath, cwd);
    if (state.touchesCredentials)
        return { category: 'destructive', hardDeny: false, requireConfirmation: true, reasons: ['edits a credential or secret file'], state };
    if (state.affectsRepoBoundary)
        return { category: 'high', hardDeny: false, requireConfirmation: false, reasons: ['writes outside the project directory'], state };
    if (state.deploymentRelated)
        return { category: 'high', hardDeny: false, requireConfirmation: false, reasons: ['edits deployment/CI configuration'], state };
    return { category: 'ordinary', hardDeny: false, requireConfirmation: false, reasons: ['ordinary source edit'], state };
}
