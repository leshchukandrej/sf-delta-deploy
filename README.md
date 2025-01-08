## Deployment of delta changes between source and current branch

If there is a need to deploy the diffs to environment, then we can use the below command to deploy the changes to the environment.<br>
The process compares the last successfully deployed commit from the source branch with current changes<br>
If branch is not specified in `.deltaPackage.{orgAlias}.env` it will ask for the branch name to compare the changes with

Sample:

```bash .deltaDeploy {targetOrgAlias}```

If the targetOrgAlias is not specified, it will ask for the target org alias to deploy the changes to<br>

if there is no .env file for input alias, it will ask for the source branch to compare the changes with

The command will fetch the latest changes from the source branch and compare the changes with the current branch<br>
After that it will prepare the package.xml file and run the deployment to specified alias org

If the deployment is successful, it will update the last successfully deployed commit hash in the `.deltaPackage.{orgAlias}.env` file

If there is a need to deploy the delta from the specific commit, there should be updated the `.deltaPackage.{orgAlias}.env` file with the LAST_SUCCESS_DEPLOYMENT_HASH={commit hash}<br>
