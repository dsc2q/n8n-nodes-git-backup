# n8n-nodes-git-backup

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-orange)](https://docs.n8n.io/integrations/community-nodes/)

> **An n8n community node that automatically backs up workflow definitions as versioned JSON files to any GitHub repository — with SHA-aware conflict resolution, semantic commit messages, and full pagination support.**

---

## ✨ Features

| Feature | Details |
|---|---|
| **Backup Current Workflow** | Reads the executing workflow via n8n API and pushes it to GitHub |
| **Backup All Workflows** | Iterates all workflows (paginated) and pushes each as a separate file |
| **SHA-Aware Updates** | Fetches the file's SHA before writing — never causes GitHub conflicts |
| **Auto Commit Messages** | Generates Conventional Commit messages when none is provided |
| **Active-Only Filter** | Optionally skip inactive/disabled workflows |
| **Continue on Error** | "Backup All" can keep going even if one workflow fails |
| **Clean Filenames** | Workflow names are sanitized into safe, lowercase, hyphenated filenames |

---

## 📋 Prerequisites

- **n8n** ≥ 0.190.0 (requires REST API support)
- **Node.js** ≥ 18
- A **GitHub Personal Access Token (PAT)** with the `repo` scope
- n8n API enabled (`N8N_PUBLIC_API_DISABLED=false`, which is the default)

---

## 🚀 Installation

### Option A — Install from npm (once published)
```bash
# Inside your n8n Docker container or n8n installation directory
npm install n8n-nodes-git-backup
```
Then restart n8n. The node will appear under the **Utility** category.

---

### Option B — Local Development via `npm link`

Use this method to test the node locally **before publishing** to npm.

#### Step 1: Clone and build

```bash
git clone https://github.com/dsc2q/n8n-nodes-git-backup.git
cd n8n-nodes-git-backup

npm install
npm run build
```

#### Step 2: Register the package globally

```bash
npm link
```

This creates a global symlink pointing to your local build.

#### Step 3A: Link into n8n Desktop

```bash
# Find where n8n is installed (example paths):
# Windows:  %APPDATA%\npm\node_modules\n8n
# macOS:    /usr/local/lib/node_modules/n8n
# Linux:    ~/.npm-global/lib/node_modules/n8n

cd /path/to/your/n8n/installation
npm link n8n-nodes-git-backup
```

#### Step 3B: Link into n8n running in Docker

```bash
# Copy the built files into the Docker volume
docker cp ./dist <your-n8n-container>:/home/node/.n8n/custom/n8n-nodes-git-backup/dist
docker cp ./package.json <your-n8n-container>:/home/node/.n8n/custom/n8n-nodes-git-backup/package.json
docker cp ./credentials <your-n8n-container>:/home/node/.n8n/custom/n8n-nodes-git-backup/credentials

# OR: Mount the project directory as a volume in docker-compose.yaml:
```

```yaml
# docker-compose.yaml (example snippet)
services:
  n8n:
    image: n8nio/n8n
    volumes:
      - ./n8n-nodes-git-backup:/home/node/.n8n/custom/n8n-nodes-git-backup
    environment:
      - N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom
```

#### Step 4: Restart n8n

```bash
# If running as a process:
n8n start

# If running in Docker:
docker-compose restart n8n
```

#### Step 5: Verify it loaded

Open n8n in your browser → search for **"Git Backup"** in the node panel. 🎉

---

## ⚙️ Credentials Setup

Create a new credential of type **"Git Backup (GitHub + n8n API)"** and fill in:

| Field | Description | Example |
|---|---|---|
| GitHub PAT | Personal Access Token with `repo` scope | `ghp_xxxx...` |
| Repository Owner | GitHub username or org | `dsc2q` |
| Repository Name | Target repository name | `n8n-backups` |
| Branch | Must exist before first run | `main` |
| n8n Base URL | URL of your n8n instance | `http://localhost:5678` |
| n8n API Key | Generate in n8n Settings → API Keys | `n8n_api_xxxx...` |

> **Generating a GitHub PAT:** Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)** → check **repo** → Generate.
>
> **Generating an n8n API Key:** In n8n, go to **Settings → Personal Settings → API Keys** → Create new key.

---

## 🔧 Node Operations

### 1. Backup Current Workflow

Reads the workflow in which this node is executing and pushes its JSON to GitHub.

**Output item fields:**

```json
{
  "workflowId": "abc123",
  "workflowName": "Send Invoice",
  "filePath": "workflows/send-invoice.json",
  "status": "updated",
  "commitUrl": "https://github.com/dsc2q/n8n-backups/commit/abc...",
  "commitSha": "abc..."
}
```

**Tip:** Trigger this with a **Schedule** node (e.g., daily at midnight) to keep a continuous backup history.

### 2. Backup All Workflows

Fetches every workflow from n8n (paginated, no limit) and pushes each as an individual JSON file.

**Additional parameters:**

| Parameter | Default | Description |
|---|---|---|
| Continue on Individual Failure | `true` | Keep backing up other workflows if one fails |
| Backup Active Workflows Only | `false` | Skip inactive/disabled workflows |

**Output:** One item per workflow, with `status: "created"`, `"updated"`, or `"failed"`.

---

## 📂 GitHub Repository Structure

After running "Backup All Workflows", your GitHub repository will look like this:

```
n8n-backups/
└── workflows/
    ├── send-invoice.json
    ├── sync-crm-data.json
    ├── daily-report.json
    └── onboarding-sequence.json
```

Each JSON file is a full n8n workflow export — you can **import it directly** back into n8n using:
**n8n → Workflows → Import from File**.

---

## 💡 Usage Examples

### Example 1: Daily Automated Backup

```
[Schedule Trigger] → [Git Backup: Backup All Workflows]
```

Set the schedule to run every night at midnight. All your workflows will be versioned daily on GitHub with automatic commit messages like:
```
chore(backup): update workflow [Send Invoice] (2024-06-15)
```

### Example 2: Backup After Every Change (Webhook-triggered)

```
[n8n Trigger: Workflow Updated] → [Git Backup: Backup Current Workflow]
```

Use n8n's internal workflow hooks to trigger a backup every time you modify a workflow.

### Example 3: Custom Commit Messages

Set the **Commit Message** field to `{{ "release: " + $now.format("yyyy-MM-dd") }}` using n8n expressions to create release-tagged commits.

---

## 🏗️ Development

```bash
# Install dependencies
npm install

# Build TypeScript → dist/
npm run build

# Watch mode for development
npm run dev

# Format code
npm run format
```

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
