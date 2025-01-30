const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const TEMP_DELTA_DIR = './temp_delta';
let SALESFORCE_ALIAS = '';
let LAST_COMMIT = '';

const SFDX_PROJECT = read_sfdx_project();

function read_sfdx_project() {
    try {
        return JSON.parse(fs.readFileSync('./sfdx-project.json', 'utf-8'));
    } catch (error) {
        console.warn('Looks like the sfdx-project.json file is missing or broken.\nAssuming that the project has only force-app structure');
        return null;
    }
}

async function initState(alias) {
    SALESFORCE_ALIAS = alias || await prompt('Please, specify the target org alias: ');

    if (!SALESFORCE_ALIAS) {
        SALESFORCE_ALIAS = await prompt('Please, specify the target org alias: ');
    }

    const envFilePath = path.join(TEMP_DELTA_DIR, `${SALESFORCE_ALIAS}.env`);
    if (fs.existsSync(envFilePath)) {
        // Load the last successful deployment hash from the .env file
        process.env = { ...process.env, ...parseEnv(fs.readFileSync(envFilePath, 'utf-8')) };
    }

    if (!process.env.LAST_SUCCESS_DEPLOYMENT_HASH) {
        const branchName = await prompt('Please, specify the target branch: ');
        LAST_COMMIT = execSync(`git log -n 1 --pretty=format:"%H" ${branchName}`).toString().trim();
    } else {
        LAST_COMMIT = process.env.LAST_SUCCESS_DEPLOYMENT_HASH;
    }
}

async function preparePackageXmlForChangedFiles() {
    await writeChangedFilesIntoFile();
    await createPackageXmlFiles();
    await mergePackagesToDeploy();
}

function deployDeltaUsingPackageXmlAndUpdateLastSuccessCommit() {
    const TEMP_DELTA_ORG_DIR = path.join(TEMP_DELTA_DIR, SALESFORCE_ALIAS);
    const packageXmlPath = path.join(TEMP_DELTA_ORG_DIR, 'package.xml');

    if (!fs.existsSync(packageXmlPath)) {
        console.log('No changes to deploy.');
        return;
    }

    console.log(`Deploying changes to target=${SALESFORCE_ALIAS}`);
    console.log(`running command: sf project deploy start --manifest ${packageXmlPath} --target-org ${SALESFORCE_ALIAS}`);

    try {
        execSync(`sf project deploy start --manifest ${packageXmlPath} --target-org ${SALESFORCE_ALIAS}`, { stdio: 'inherit' });
        console.log(`Deployment to ${SALESFORCE_ALIAS} successful. Updating the last commit hash in .deployDelta file.`);
        const lastCommitHash = execSync('git log -n 1 --pretty=format:"%H"').toString().trim();
        fs.writeFileSync(path.join(TEMP_DELTA_DIR, `${SALESFORCE_ALIAS}.env`), `LAST_SUCCESS_DEPLOYMENT_HASH=${lastCommitHash}`);
    } catch (error) {
        console.error(`Deployment to ${SALESFORCE_ALIAS} FAILED.`);
        process.exit(1);
    }
}

async function mergePackagesToDeploy() {
    const TEMP_DELTA_ORG_DIR = path.join(TEMP_DELTA_DIR, SALESFORCE_ALIAS);
    const PACKAGE_DIR = path.join(TEMP_DELTA_ORG_DIR, 'packages');

    if (!fs.existsSync(PACKAGE_DIR)) {
        console.log('No packages to merge.');
        return;
    }

    console.log('Merging package.xml files...');
    const OUTPUT_FILE = path.join(TEMP_DELTA_ORG_DIR, 'package.xml');

    fs.writeFileSync(OUTPUT_FILE, '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n');

    const packageFiles = fs.readdirSync(PACKAGE_DIR).filter(file => file.endsWith('.xml'));
    for (const packageFile of packageFiles) {
        const packageContent = fs.readFileSync(path.join(PACKAGE_DIR, packageFile), 'utf-8');
        //remove the first 2 and last 2 lines of the package.xml file
        const typesDataArray = packageContent.split('\n').slice(2, -3);
        fs.appendFileSync(OUTPUT_FILE, typesDataArray.join('\n') + '\n');
    }

    const apiVersion = SFDX_PROJECT?.sourceApiVersion || '62.0';
    fs.appendFileSync(OUTPUT_FILE, `    <version>${apiVersion}</version>\n</Package>`);

    console.log(`Merged package.xml created at ${OUTPUT_FILE}`);
    console.log('Cleaning up temp packages...');
    fs.rmSync(PACKAGE_DIR, { recursive: true, force: true });
}

function isIgnored(file) {
    try {
        const result = execSync(`sf project list ignored --source-dir ${file}`).toString();
        return result.includes('Found the following ignored files:');
    } catch {
        return false;
    }
}

async function writeChangedFilesIntoFile() {
    const TEMP_DELTA_ORG_DIR = path.join(TEMP_DELTA_DIR, SALESFORCE_ALIAS);

    if (!fs.existsSync(TEMP_DELTA_DIR)) {
        fs.mkdirSync(TEMP_DELTA_DIR);
    }

    fs.rmSync(TEMP_DELTA_ORG_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEMP_DELTA_ORG_DIR);

    console.log('prepare package files for change log');
    const changedFilesPath = path.join(TEMP_DELTA_ORG_DIR, 'changed_files.txt');
    fs.writeFileSync(changedFilesPath, '');

    const changedFiles = execSync(`git diff --name-only ${LAST_COMMIT} --diff-filter=AMRT`).toString().split('\n');
    for (const file of changedFiles) {
        // if (isIgnored(file)) {
        //     console.log(`Ignoring ${file}`);
        //     continue;
        // }

        const packageDirs = SFDX_PROJECT?.packageDirectories.map(pckg => pckg.path) || ['force-app'];
        for (const packageDir of packageDirs) {
            if (file.startsWith(packageDir)) {
                fs.appendFileSync(changedFilesPath, `${file}\n`);
                break;
            }
        }
    }
}

async function createPackageXmlFiles() {
    const TEMP_DELTA_ORG_DIR = path.join(TEMP_DELTA_DIR, SALESFORCE_ALIAS);
    const TEMP_DELTA_ORG_PACKAGES_DIR = path.join(TEMP_DELTA_ORG_DIR, 'packages');

    let packageIndex = 0;
    let fileChunk = [];

    const changedFilesPath = path.join(TEMP_DELTA_ORG_DIR, 'changed_files.txt');
    const changedFiles = fs.readFileSync(changedFilesPath, 'utf-8').split('\n');

    for (const file of changedFiles) {
        if (!file) continue;

        fileChunk.push('"./' + file + '"');

        if (fileChunk.length === 20) {
            console.log(`Processing chunk ${packageIndex}`);
            execSync(`sf project convert source --output-dir ${TEMP_DELTA_ORG_PACKAGES_DIR} --source-dir ${fileChunk.join(' ')}`);
            fs.renameSync(path.join(TEMP_DELTA_ORG_PACKAGES_DIR, 'package.xml'), path.join(TEMP_DELTA_ORG_PACKAGES_DIR, `package${packageIndex}.xml`));
            fileChunk = [];
            packageIndex++;
        }
    }

    if (fileChunk.length > 0) {
        console.log('Processing remaining chunk');
        execSync(`sf project convert source --output-dir ${TEMP_DELTA_ORG_PACKAGES_DIR} --source-dir ${fileChunk.join(' ')}`);
        fs.renameSync(path.join(TEMP_DELTA_ORG_PACKAGES_DIR, 'package.xml'), path.join(TEMP_DELTA_ORG_PACKAGES_DIR, `package${packageIndex}.xml`));
    }
}

function parseEnv(env) {
    return env.split('\n').reduce((acc, line) => {
        const [key, value] = line.split('=');
        if (key && value) {
            acc[key.trim()] = value.trim();
        }
        return acc;
    }, {});
}

function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => rl.question(question, answer => {
        rl.close();
        resolve(answer);
    }));
}

async function main() {
    const alias = process.argv[2];
    await initState(alias);
    await preparePackageXmlForChangedFiles();
    deployDeltaUsingPackageXmlAndUpdateLastSuccessCommit();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
