import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/** Credential data shape, mirroring GitBackupApi.credentials.ts */
interface GitBackupCredentials {
	githubToken: string;
	owner: string;
	repo: string;
	branch: string;
	n8nBaseUrl: string;
	n8nApiKey: string;
}

/** Shape returned by GET /repos/{owner}/{repo}/contents/{path} */
interface GitHubFileContent {
	sha: string;
	name: string;
	path: string;
	size: number;
	content?: string;
	encoding?: string;
}

/** Shape returned by PUT /repos/{owner}/{repo}/contents/{path} */
interface GitHubPutResponse {
	content: {
		path: string;
		sha: string;
		html_url: string;
	};
	commit: {
		sha: string;
		html_url: string;
		message: string;
	};
}

/** Full workflow object as returned by the n8n REST API */
interface N8nWorkflow {
	id: string;
	name: string;
	active: boolean;
	nodes: IDataObject[];
	connections: IDataObject;
	settings?: IDataObject;
	staticData?: IDataObject | null;
	tags?: Array<{ id: string; name: string }>;
	meta?: IDataObject;
	createdAt?: string;
	updatedAt?: string;
}

/** Paginated list response from GET /api/v1/workflows */
interface N8nWorkflowListResponse {
	data: N8nWorkflow[];
	nextCursor?: string | null;
}

/** Result object emitted per workflow in output items */
interface BackupResult {
	workflowId: string;
	workflowName: string;
	filePath: string;
	status: 'created' | 'updated' | 'failed';
	commitUrl?: string;
	commitSha?: string;
	errorMessage?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts an arbitrary workflow name into a safe, lowercase filename
 * suitable for Git repositories.
 *
 * @example
 *   sanitizeFilename('My Workflow (v2) — Final!')  →  'my-workflow-v2-final'
 */
function sanitizeFilename(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')           // spaces → hyphens
		.replace(/[^a-z0-9\-_.]/g, '')  // strip non-alphanumeric (keep - _ .)
		.replace(/-+/g, '-')            // collapse consecutive hyphens
		.replace(/^[-.]|[-.]$/g, '');   // trim leading/trailing hyphens/dots
}

/**
 * Ensures a path prefix always ends with '/' and never starts with '/'.
 *
 * @example
 *   normalizePrefix('workflows')   →  'workflows/'
 *   normalizePrefix('/backups/')   →  'backups/'
 *   normalizePrefix('')            →  ''
 */
function normalizePrefix(prefix: string): string {
	const cleaned = prefix.trim().replace(/^\/+/, '');
	if (cleaned === '') return '';
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

/**
 * Builds a semantic commit message.
 * Returns the custom message if provided, otherwise auto-generates one
 * in the Conventional Commits style.
 *
 * @example (auto-generated, new file)
 *   'chore(backup): add workflow [Send Invoice] (2024-06-15)'
 * @example (auto-generated, update)
 *   'chore(backup): update workflow [Send Invoice] (2024-06-15)'
 */
function buildCommitMessage(
	workflowName: string,
	isNew: boolean,
	customMessage?: string,
): string {
	if (customMessage?.trim()) {
		return customMessage.trim();
	}
	const verb = isNew ? 'add' : 'update';
	const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
	return `chore(backup): ${verb} workflow [${workflowName}] (${date})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GITHUB API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Shared headers sent with every GitHub API request. */
function githubHeaders(token: string): Record<string, string> {
	return {
		Authorization: `token ${token}`,
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'n8n-nodes-git-backup/0.1.0',
		'Content-Type': 'application/json',
	};
}

/**
 * Fetches the current SHA of a file in a GitHub repository.
 * Returns `undefined` when the file does not exist (HTTP 404).
 * Re-throws any other error so the caller gets a meaningful message.
 */
async function getGitHubFileSHA(
	ctx: IExecuteFunctions,
	creds: GitBackupCredentials,
	filePath: string,
): Promise<string | undefined> {
	try {
		const response = (await ctx.helpers.httpRequest({
			method: 'GET',
			url: `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${filePath}`,
			headers: githubHeaders(creds.githubToken),
			qs: { ref: creds.branch },
		})) as GitHubFileContent;

		return response?.sha;
	} catch (error: unknown) {
		// n8n wraps HTTP errors; 404 means the file simply doesn't exist yet
		const errObj = error as { response?: { status?: number } };
		if (errObj?.response?.status === 404) {
			return undefined;
		}
		// Any other error (401 Forbidden, rate-limit, network) — propagate
		throw error;
	}
}

/**
 * Creates or updates a single file inside a GitHub repository using the
 * Contents API.  Passing a `sha` triggers an update; omitting it creates
 * a new file.
 */
async function pushFileToGitHub(
	ctx: IExecuteFunctions,
	creds: GitBackupCredentials,
	filePath: string,
	content: string,
	commitMessage: string,
	existingSha?: string,
): Promise<GitHubPutResponse> {
	const body: IDataObject = {
		message: commitMessage,
		// GitHub requires file content encoded as base64
		content: Buffer.from(content, 'utf-8').toString('base64'),
		branch: creds.branch,
	};

	if (existingSha) {
		body.sha = existingSha;
	}

	const response = (await ctx.helpers.httpRequest({
		method: 'PUT',
		url: `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${filePath}`,
		headers: githubHeaders(creds.githubToken),
		body,
		json: true,
	})) as GitHubPutResponse;

	return response;
}

// ═══════════════════════════════════════════════════════════════════════════
// N8N API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Shared headers for n8n REST API calls. */
function n8nHeaders(apiKey: string): Record<string, string> {
	return {
		'X-N8N-API-KEY': apiKey,
		Accept: 'application/json',
	};
}

/**
 * Fetches the complete JSON definition of a single n8n workflow by ID.
 */
async function fetchN8nWorkflow(
	ctx: IExecuteFunctions,
	baseUrl: string,
	apiKey: string,
	workflowId: string,
): Promise<N8nWorkflow> {
	const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/workflows/${workflowId}`;

	const response = (await ctx.helpers.httpRequest({
		method: 'GET',
		url,
		headers: n8nHeaders(apiKey),
		json: true,
	})) as N8nWorkflow;

	return response;
}

/**
 * Fetches ALL workflows from n8n, handling pagination transparently.
 * Returns a flat array of workflow objects.
 */
async function fetchAllN8nWorkflows(
	ctx: IExecuteFunctions,
	baseUrl: string,
	apiKey: string,
): Promise<N8nWorkflow[]> {
	const normalizedUrl = baseUrl.replace(/\/+$/, '');
	const workflows: N8nWorkflow[] = [];
	let cursor: string | null | undefined;

	do {
		const qs: IDataObject = { limit: 100 };
		if (cursor) {
			qs.cursor = cursor;
		}

		const response = (await ctx.helpers.httpRequest({
			method: 'GET',
			url: `${normalizedUrl}/api/v1/workflows`,
			headers: n8nHeaders(apiKey),
			qs,
			json: true,
		})) as N8nWorkflowListResponse;

		if (Array.isArray(response.data)) {
			workflows.push(...response.data);
		}

		cursor = response.nextCursor ?? null;
	} while (cursor);

	return workflows;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE BACKUP LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Backs up a single workflow to GitHub.
 * Handles both file creation and update (SHA-aware to prevent conflicts).
 */
async function backupSingleWorkflow(
	ctx: IExecuteFunctions,
	creds: GitBackupCredentials,
	workflow: N8nWorkflow,
	filePathPrefix: string,
	customCommitMessage: string,
): Promise<BackupResult> {
	const safeName = sanitizeFilename(workflow.name || `workflow-${workflow.id}`);
	const filePath = `${filePathPrefix}${safeName}.json`;
	const fileContent = JSON.stringify(workflow, null, 2);

	// Determine if the file already exists on GitHub
	const existingSha = await getGitHubFileSHA(ctx, creds, filePath);

	const commitMessage = buildCommitMessage(
		workflow.name,
		!existingSha,
		customCommitMessage,
	);

	const pushResponse = await pushFileToGitHub(
		ctx,
		creds,
		filePath,
		fileContent,
		commitMessage,
		existingSha,
	);

	return {
		workflowId: String(workflow.id),
		workflowName: workflow.name,
		filePath,
		status: existingSha ? 'updated' : 'created',
		commitUrl: pushResponse.commit?.html_url,
		commitSha: pushResponse.commit?.sha,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// NODE CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class GitBackup implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Git Backup',
		name: 'gitBackup',
		// Font Awesome free icon — no SVG file needed
		icon: 'fa:code-branch',
		group: ['organization'],
		version: 1,
		subtitle:
			'={{$parameter["operation"] === "backupCurrentWorkflow" ? "Backup Current Workflow" : "Backup All Workflows"}}',
		description:
			'Backup n8n workflows as versioned JSON files to a GitHub repository, with automatic SHA-aware conflict resolution and semantic commit messages.',
		defaults: {
			name: 'Git Backup',
			color: '#24292e',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'gitBackupApi',
				required: true,
			},
		],
		properties: [
			// ── Operation ────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Backup Current Workflow',
						value: 'backupCurrentWorkflow',
						description:
							'Fetch the currently executing workflow from n8n API and push its JSON to GitHub',
						action: 'Backup the current workflow to GitHub',
					},
					{
						name: 'Backup All Workflows',
						value: 'backupAllWorkflows',
						description:
							'Fetch every workflow from the n8n API and push each as a separate JSON file to GitHub',
						action: 'Backup all workflows to GitHub',
					},
				],
				default: 'backupCurrentWorkflow',
			},

			// ── File Path Prefix ─────────────────────────────────────────────
			{
				displayName: 'File Path Prefix',
				name: 'filePathPrefix',
				type: 'string',
				default: 'workflows/',
				placeholder: 'workflows/',
				description:
					'Folder path inside the repository where JSON files will be stored. ' +
					'Example: <code>workflows/</code> → produces <code>workflows/my-workflow-name.json</code>. ' +
					'Leave empty to store at the repository root.',
			},

			// ── Commit Message ───────────────────────────────────────────────
			{
				displayName: 'Commit Message',
				name: 'commitMessage',
				type: 'string',
				default: '',
				placeholder: 'chore(backup): update workflow [My Workflow] (2024-06-15)',
				description:
					'Custom Git commit message. When left empty, an auto-generated Conventional Commit message is used: ' +
					'<code>chore(backup): [add|update] workflow [Name] (YYYY-MM-DD)</code>.',
			},

			// ── Continue on Error (Backup All only) ──────────────────────────
			{
				displayName: 'Continue on Individual Workflow Failure',
				name: 'continueOnError',
				type: 'boolean',
				default: true,
				description:
					'Whether to continue backing up remaining workflows if one fails. ' +
					'When disabled, the first failure stops execution with an error.',
				displayOptions: {
					show: {
						operation: ['backupAllWorkflows'],
					},
				},
			},

			// ── Active Only (Backup All only) ─────────────────────────────────
			{
				displayName: 'Backup Active Workflows Only',
				name: 'activeOnly',
				type: 'boolean',
				default: false,
				description:
					'Whether to skip inactive (disabled) workflows when running "Backup All Workflows".',
				displayOptions: {
					show: {
						operation: ['backupAllWorkflows'],
					},
				},
			},
		],
	};

	// ─────────────────────────────────────────────────────────────────────────
	// EXECUTE
	// ─────────────────────────────────────────────────────────────────────────

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// ── Load and validate credentials ─────────────────────────────────────
		const credentials = (await this.getCredentials(
			'gitBackupApi',
		)) as unknown as GitBackupCredentials;

		const { githubToken, owner, repo, branch, n8nBaseUrl, n8nApiKey } = credentials;

		if (!githubToken?.trim()) {
			throw new NodeOperationError(
				this.getNode(),
				'GitHub Personal Access Token is missing in credentials.',
			);
		}
		if (!owner?.trim() || !repo?.trim()) {
			throw new NodeOperationError(
				this.getNode(),
				'Repository Owner and Repository Name are required in credentials.',
			);
		}
		if (!n8nApiKey?.trim()) {
			throw new NodeOperationError(
				this.getNode(),
				'n8n API Key is required in credentials to read workflow definitions.',
			);
		}

		// ── Load node parameters ───────────────────────────────────────────────
		const operation = this.getNodeParameter('operation', 0) as string;
		const filePathPrefix = normalizePrefix(
			this.getNodeParameter('filePathPrefix', 0) as string,
		);
		const customCommitMessage = this.getNodeParameter('commitMessage', 0) as string;

		// Provide a typed credential object for helpers
		const creds: GitBackupCredentials = {
			githubToken,
			owner,
			repo,
			branch: branch || 'main',
			n8nBaseUrl: n8nBaseUrl || 'http://localhost:5678',
			n8nApiKey,
		};

		// ════════════════════════════════════════════════════════════════════
		// OPERATION: Backup Current Workflow
		// ════════════════════════════════════════════════════════════════════
		if (operation === 'backupCurrentWorkflow') {
			// Retrieve current workflow metadata from n8n execution context
			const workflowMeta = this.getWorkflow();
			const workflowId = workflowMeta.id;

			if (!workflowId) {
				throw new NodeOperationError(
					this.getNode(),
					'Could not determine the current workflow ID. ' +
						'Make sure the workflow has been saved at least once before running this node.',
				);
			}

			// Fetch the full workflow definition via n8n REST API
			let workflowData: N8nWorkflow;
			try {
				workflowData = await fetchN8nWorkflow(
					this,
					creds.n8nBaseUrl,
					creds.n8nApiKey,
					String(workflowId),
				);
			} catch (error) {
				throw new NodeApiError(this.getNode(), error as any, {
					message:
						`Failed to fetch workflow "${workflowMeta.name ?? workflowId}" from n8n API ` +
						`(${creds.n8nBaseUrl}). ` +
						'Verify the n8n Base URL and API Key in credentials, and ensure n8n API is enabled.',
				});
			}

			// Perform the backup
			let result: BackupResult;
			try {
				result = await backupSingleWorkflow(
					this,
					creds,
					workflowData,
					filePathPrefix,
					customCommitMessage,
				);
			} catch (error) {
				throw new NodeApiError(this.getNode(), error as any, {
					message:
						`Failed to push workflow "${workflowData.name}" to GitHub ` +
						`(${owner}/${repo}@${branch}). ` +
						'Verify that the PAT has "repo" scope and the branch exists.',
				});
			}

			// Emit one output item per input item (standard n8n pattern)
			for (let i = 0; i < items.length; i++) {
				returnData.push({
					json: result as unknown as IDataObject,
					pairedItem: { item: i },
				});
			}
		}

		// ════════════════════════════════════════════════════════════════════
		// OPERATION: Backup All Workflows
		// ════════════════════════════════════════════════════════════════════
		else if (operation === 'backupAllWorkflows') {
			const continueOnError = this.getNodeParameter('continueOnError', 0) as boolean;
			const activeOnly = this.getNodeParameter('activeOnly', 0) as boolean;

			// Fetch all workflows from n8n
			let allWorkflows: N8nWorkflow[];
			try {
				allWorkflows = await fetchAllN8nWorkflows(this, creds.n8nBaseUrl, creds.n8nApiKey);
			} catch (error) {
				throw new NodeApiError(this.getNode(), error as any, {
					message:
						`Failed to retrieve workflow list from n8n API (${creds.n8nBaseUrl}). ` +
						'Verify the n8n Base URL and API Key in credentials.',
				});
			}

			// Optionally filter to active workflows only
			const workflows = activeOnly
				? allWorkflows.filter((wf) => wf.active)
				: allWorkflows;

			if (workflows.length === 0) {
				// Return an empty output so the workflow doesn't break
				returnData.push({
					json: {
						message: activeOnly
							? 'No active workflows found to back up.'
							: 'No workflows found in this n8n instance.',
						totalBackedUp: 0,
					} as IDataObject,
					pairedItem: { item: 0 },
				});
				return [returnData];
			}

			// Back up each workflow, emitting one output item per workflow
			for (const workflow of workflows) {
				try {
					const result = await backupSingleWorkflow(
						this,
						creds,
						workflow,
						filePathPrefix,
						customCommitMessage,
					);

					returnData.push({
						json: result as unknown as IDataObject,
						pairedItem: { item: 0 },
					});
				} catch (error: unknown) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);

					if (!continueOnError) {
						throw new NodeApiError(this.getNode(), error as any, {
							message:
								`Backup failed for workflow "${workflow.name}" (ID: ${workflow.id}): ` +
								errorMessage,
						});
					}

					// continueOnError: log the failure as an output item and move on
					returnData.push({
						json: {
							workflowId: String(workflow.id),
							workflowName: workflow.name,
							filePath: `${filePathPrefix}${sanitizeFilename(workflow.name)}.json`,
							status: 'failed',
							errorMessage,
						} as unknown as IDataObject,
						pairedItem: { item: 0 },
					});
				}
			}
		}

		return [returnData];
	}
}
