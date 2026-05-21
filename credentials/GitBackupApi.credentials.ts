import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Credential definition for the Git Backup node.
 * Bundles GitHub authentication alongside n8n API access so both
 * operations (backup current / backup all) share a single credential entry.
 */
export class GitBackupApi implements ICredentialType {
  name = 'gitBackupApi';
  displayName = 'Git Backup (GitHub + n8n API)';
  documentationUrl = 'https://github.com/dsc2q/n8n-nodes-git-backup#credentials';

  properties: INodeProperties[] = [
    // ─────────────────────────────────────────────────────────────────────
    // SECTION — GitHub
    // ─────────────────────────────────────────────────────────────────────
    {
      displayName: 'GitHub Personal Access Token (PAT)',
      name: 'githubToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      description:
        'A GitHub PAT with the <strong>repo</strong> scope. ' +
        'Generate one at <a href="https://github.com/settings/tokens" target="_blank">github.com/settings/tokens</a>.',
    },
    {
      displayName: 'Repository Owner',
      name: 'owner',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'your-github-username',
      description:
        'The GitHub username or organisation that owns the backup repository ' +
        '(e.g., <code>dsc2q</code>).',
    },
    {
      displayName: 'Repository Name',
      name: 'repo',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'n8n-workflow-backups',
      description: 'Name of the GitHub repository that will store the workflow JSON files.',
    },
    {
      displayName: 'Branch',
      name: 'branch',
      type: 'string',
      default: 'main',
      required: true,
      placeholder: 'main',
      description:
        'Target branch in the repository. The branch <strong>must already exist</strong> before the first backup run.',
    },

    // ─────────────────────────────────────────────────────────────────────
    // SECTION — n8n API
    // ─────────────────────────────────────────────────────────────────────
    {
      displayName: 'n8n Base URL',
      name: 'n8nBaseUrl',
      type: 'string',
      default: 'http://localhost:5678',
      required: true,
      placeholder: 'http://localhost:5678',
      description:
        'Base URL of your n8n instance. ' +
        'For local Docker: <code>http://localhost:5678</code>. ' +
        'For n8n Cloud or self-hosted: <code>https://my-n8n.example.com</code>.',
    },
    {
      displayName: 'n8n API Key',
      name: 'n8nApiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      placeholder: 'n8n_api_xxxxxxxxxxxxxxxx',
      description:
        'Your n8n API key, required to read workflow definitions. ' +
        'Generate one under <strong>Settings → Personal Settings → API Keys</strong> in n8n.',
    },
  ];
}
