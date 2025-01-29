#!/bin/bash

PACKAGE_DIRS=$(jq -r '.packageDirectories[].path' sfdx-project.json)
TEMP_DELTA_DIR="./temp_delta"  # Temporary directory for delta changes
SALESFORCE_ALIAS=
LAST_COMMIT=

init_state() {
  SALESFORCE_ALIAS=$1

  TEMP_DELTA_ORG_DIR="$TEMP_DELTA_DIR/$SALESFORCE_ALIAS"

  if [ -z "$SALESFORCE_ALIAS" ]; then
    echo "Please, specify the target org alias"
    read -p "Target org alias? " SALESFORCE_ALIAS
  fi

  source "./temp_delta/$SALESFORCE_ALIAS.env"

  if [ -z "$LAST_SUCCESS_DEPLOYMENT_HASH" ]; then
    echo "Please, specify the target branch"
    read -p "Target branch name? " name
    LAST_COMMIT=$(git log -n 1 --pretty=format:"%H" "$name")
  else
    LAST_COMMIT=$LAST_SUCCESS_DEPLOYMENT_HASH
  fi
}

prepare_package_xml_for_changed_files() {
  write_changed_files_into_file
  create_package_xml_files
  merge_packages_to_deploy
}

deploy_delta_using_package_xml_and_update_last_success_commit() {
  TEMP_DELTA_ORG_DIR="$TEMP_DELTA_DIR/$SALESFORCE_ALIAS"

  if [ ! -f "$TEMP_DELTA_ORG_DIR/package.xml" ]; then
    echo "No changes to deploy."
    return 0
  fi

  echo "Deploying changes to target=$SALESFORCE_ALIAS"
  echo "running command: sf project deploy start --manifest $TEMP_DELTA_ORG_DIR/package.xml --target-org $SALESFORCE_ALIAS"

  sf project deploy start --manifest "$TEMP_DELTA_ORG_DIR/package.xml" --target-org "$SALESFORCE_ALIAS"

  # Reading the exit code for the last command
  if [ "$?" -ne "0" ]; then
    echo -e "$RED_TEXT----> Deployment to $SALESFORCE_ALIAS FAILED."
    exit 1
  fi
  echo -e "$GREEN_TEXT----> Deployment to $SALESFORCE_ALIAS successful. Updating the last commit hash in .deployDelta file."

  #updating the last commit hash in .deployDelta file
  echo "LAST_SUCCESS_DEPLOYMENT_HASH=$(git log -n 1 --pretty=format:"%H")" > "./temp_delta/$SALESFORCE_ALIAS.env"
}

# Function to merge package xml files
merge_packages_to_deploy() {
#skip execution if no packages created\
  TEMP_DELTA_ORG_DIR="$TEMP_DELTA_DIR/$SALESFORCE_ALIAS"
  PACKAGE_DIR="$TEMP_DELTA_ORG_DIR/packages"

  if [ ! -d "$PACKAGE_DIR" ]; then
    echo "No packages to merge."
    return 0
  fi

  echo "Merging package.xml files..."

  OUTPUT_FILE="$TEMP_DELTA_ORG_DIR/package.xml"

  # Create the output file and add the XML header
  echo '<?xml version="1.0" encoding="UTF-8"?>' > "$OUTPUT_FILE"
  echo '<Package xmlns="http://soap.sforce.com/2006/04/metadata">' >> "$OUTPUT_FILE"

  # Loop through each package.xml file and extract the types
  for package in "$PACKAGE_DIR"/*.xml; do
    # Extract the types and append to the output file
    echo "package: $package"
    xmllint --xpath '/*[local-name()="Package"]/*[local-name()="types"]' "$package" >> "$OUTPUT_FILE"
  done

  # Add the footer to the output file
  API_VERSION=$(jq -r '.sourceApiVersion' sfdx-project.json)

  echo "<version>$API_VERSION</version>" >> "$OUTPUT_FILE"
  echo '</Package>' >> "$OUTPUT_FILE"

  echo "Merged package.xml created at $OUTPUT_FILE"

  echo "Cleaning up temp packages..."

  rm -rf "$PACKAGE_DIR"
}

is_ignored() {
  if [[ $(sf project list ignored --source-dir "$1" 2>/dev/null) == *"Found the following ignored files:"* ]]; then
    return 0 # File is ignored
  else
    return 1 # File is not ignored
  fi
}

write_changed_files_into_file() {
  TEMP_DELTA_ORG_DIR="$TEMP_DELTA_DIR/$SALESFORCE_ALIAS"

  if [[ ! -e "$TEMP_DELTA_DIR" ]]; then mkdir "$TEMP_DELTA_DIR"; fi

  rm -rf "$TEMP_DELTA_ORG_DIR"

  mkdir "$TEMP_DELTA_ORG_DIR"

  echo "prepare package files for change log"

  touch "$TEMP_DELTA_ORG_DIR/changed_files.txt"
    git diff --name-only "$LAST_COMMIT" --diff-filter=AMRT | while IFS= read -r file; do
      if is_ignored "$file"; then
        echo "Ignoring $file"
        continue
      fi

      for package_dir in $PACKAGE_DIRS; do
        if [[ "$file" != "$package_dir"* ]]; then
          continue
        fi
          echo "$file" >> "$TEMP_DELTA_ORG_DIR/changed_files.txt"
          break  # Move to next file after first match
      done
    done
}

create_package_xml_files() {
  TEMP_DELTA_ORG_DIR="$TEMP_DELTA_DIR/$SALESFORCE_ALIAS"
  TEMP_DELTA_ORG_PACKAGES_DIR="$TEMP_DELTA_ORG_DIR/packages"

  package_index=0
  declare -a file_chunk=()

  # Read files line by line, preserving spaces
  while IFS= read -r file; do
    file_chunk+=("$file")  # Add file to chunk array

    # Process chunk when reaching 20 files
    if (( ${#file_chunk[@]} == 20 )); then
      echo "Processing chunk $package_index"
      sf project convert source --output-dir "$TEMP_DELTA_ORG_PACKAGES_DIR" --source-dir "${file_chunk[@]}"
      mv "$TEMP_DELTA_ORG_PACKAGES_DIR/package.xml" "$TEMP_DELTA_ORG_PACKAGES_DIR/package$package_index.xml"
      file_chunk=()  # Reset chunk
      ((package_index++))
    fi
  done < "$TEMP_DELTA_ORG_DIR/changed_files.txt"

  # Process remaining files in the last chunk
  if (( ${#file_chunk[@]} > 0 )); then
    echo "Processing remaining chunk"
    sf project convert source --output-dir "$TEMP_DELTA_ORG_PACKAGES_DIR" --source-dir "${file_chunk[@]}"
    mv "$TEMP_DELTA_ORG_PACKAGES_DIR/package.xml" "$TEMP_DELTA_ORG_PACKAGES_DIR/package$package_index.xml"
  fi
}

main() {
  init_state "$@"
  prepare_package_xml_for_changed_files
  deploy_delta_using_package_xml_and_update_last_success_commit
}

main "$@"
