# Deployment of delta changes between source and current branch

## Overview

This script facilitates incremental deployments of Salesforce metadata by detecting changes between the current branch and a reference commit (last successful deployment or specified branch). It generates a package.xml manifest for the delta and deploys it to a target org.

## Prerequisites

- Place the script in your project's root directory (same level as sfdx-project.json).
- Git must be installed
- Salesforce CLI (sf) must be installed and authenticated with target orgs.

## Usage

Basic Command

```bash deploy_delta.sh {targetOrgAlias}```

{targetOrgAlias}: Alias of the target Salesforce org. If omitted, the script will prompt for it.

## Key Features

**Delta Detection**: Compares changes against the last successfully deployed commit (stored in an environment file) or a user-specified branch.

**Automated Package Creation**: Generates a deployment package (package.xml) from changed files.

**Ignored Files**: Excludes files marked as ignored in the Salesforce project.

**Post-Deployment Update**: Updates the reference commit hash upon successful deployment.


## How It Works

1. Initialization
  Target Org Alias: If not provided in the command, the script prompts for it.

  Environment File: Checks for ./temp_delta/{targetOrgAlias}.env to retrieve LAST_SUCCESS_DEPLOYMENT_HASH.

  If the file or hash is missing, the script prompts for a source branch to compare against and uses its latest commit.

2. Delta Calculation
  Identifies changed files between the current branch and the reference commit (LAST_SUCCESS_DEPLOYMENT_HASH or branch tip).

  Excludes files ignored by the Salesforce project (via sf project list ignored).

3. Package Generation
  Converts changed files into Salesforce metadata components.

  Groups changes into batches (20 files per batch) to avoid CLI limitations.

  Merges batch manifests into a single package.xml.

4. Deployment
  Deploys the merged package.xml to the target org using sf project deploy start.

  On success, updates LAST_SUCCESS_DEPLOYMENT_HASH in the environment file with the latest commit.

## Notes
The changed files should be in the sfdx-project.json otherwise they are ignored
In order to deploy the chnages between the specific commit and current state, please, update the .env file for specific alias

Temporary Files: The script uses ./temp_delta/{targetOrgAlias} for temporary files (e.g., changed file lists, package manifests). These are cleaned up on next execution.

Error Handling:

Failed deployments exit with an error code and do not update the commit hash.

Successes update the hash to ensure future deltas are based on the latest state.
