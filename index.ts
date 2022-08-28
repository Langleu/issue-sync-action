// import octokit
import * as core from '@actions/core';
import * as github from "@actions/github";
import { Octokit } from "octokit";
import { Issue, IssueComment } from "./issue";
import { LabelSyncer } from "./labelSyncer";
// use label from ./Label.ts

let owner_source = "";
let repo_source = "";
let owner_target = "";
let repo_target = "";
let GITHUB_TOKEN = "";
let ONLY_SYNC_ON_LABEL: string;

// Determine which context we are running from
if (process.env.CI == "true") {
    console.log("Reading params from actions context...");
    // Read source and target repos
    repo_source = core.getInput("repo_source")? core.getInput("repo_source") : github.context.repo.owner + '/' + github.context.repo.repo;
    owner_source = repo_source.split('/')[0];
    repo_source = repo_source.split('/')[1];
    repo_target = core.getInput("repo_target");
    owner_target = repo_target.split('/')[0];
    repo_target = repo_target.split('/')[1];
    // Read token and params
    GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    ONLY_SYNC_ON_LABEL = core.getInput("only_sync_on_label");

    console.log("Repos: " + owner_source + "/" + repo_source + " -> " + owner_target + "/" + repo_target);
    console.log("Only sync on label: " + ONLY_SYNC_ON_LABEL);
    console.log("Do not sync comments: " + core.getBooleanInput("only_sync_main_issue"));
} else {
    console.log("Reading params from CLI context...");
    // read all variables from launch parameters
    const launchArgs = process.argv;
    for (let i = 0; i < launchArgs.length; i++) {
        if (launchArgs[i] === "--owner_source") {
            owner_source = launchArgs[i + 1];
        } else if (launchArgs[i] === "--repo_source") {
            repo_source = launchArgs[i + 1];
        } else if (launchArgs[i] === "--owner_target") {
            owner_target = launchArgs[i + 1];
        } else if (launchArgs[i] === "--repo_target") {
            repo_target = launchArgs[i + 1];
        } else if (launchArgs[i] === "--github_token") {
            GITHUB_TOKEN = launchArgs[i + 1];
        }
    }
}

// Init octokit
const octokit = new Octokit({
    auth: GITHUB_TOKEN,
    // TODO: add ghes IP support here, or use github.octokit
});

LabelSyncer.syncLabels(
    octokit,
    owner_source,
    repo_source,
    owner_target,
    repo_target
).then(() => console.log("Successfully synced labels")
).then(() => {
    const payload = require(process.env.GITHUB_EVENT_PATH as string);
    const number = (payload.issue || payload.pull_request || payload).number;

    // retrieve issue by owner, repo and number from octokit
    octokit.request('GET /repos/{owner}/{repo}/issues/{number}', {
        owner: owner_source,
        repo: repo_source,
        number: number,
    }).then((response) => {
        // Retrieved issue
        const issue: Issue = response.data;

        console.log("Found issue:", issue.title);
        console.log("Labels:", issue.labels.map(label => label.name));
        
        // If flag for only syncing labelled issues is set, check if issue has label of specified sync type
        if (ONLY_SYNC_ON_LABEL == "true" && !issue.labels.find(label => label.name === process.env.ONLY_SYNC_ON_LABEL))
            return;

        switch (process.env.GITHUB_EVENT_NAME) {
            case "issue_comment":
                // If flag for only syncing issue bodies is set and skip if true
                if (core.getBooleanInput("only_sync_main_issue"))
                    return;
                if (payload.action !== "created") {
                    console.warn("This will only sync new comments, events of current type are ignored", payload.action);
                    return;
                }
                // Retrieve new comment
                let issueComment: IssueComment;
                octokit.request('GET /repos/{owner}/{repo}/issues/comments/{comment_id}', {
                    owner: owner_source,
                    repo: repo_source,
                    issue_number: number,
                    comment_id: payload.comment.id,
                }).then((response) => {
                    issueComment = response.data;
                    // Transfer new comment to target issue
                    octokit.request('POST /repos/{owner}/{repo}/issues/comments', {
                        owner: owner_target,
                        repo: repo_target,
                        issue_number: number,
                        body: issueComment.body || "",
                    }).then((result) => {
                        console.info("Successfully created new comment on issue");
                    }).catch((err) => {
                        let msg = "Failed to create new comment on issue";
                        console.error(msg, err);
                        core.setFailed(msg + " ${err}");
                    })
                }).catch((err) => {
                    let msg = "Failed to retrieve issue comments"
                    console.error(msg, err);
                    core.setFailed(msg + " ${err}");
                });
                break;
            case "issues":
                    // If the issue was updated, we need to sync labels
                    switch(payload.action) {
                        case "opened":
                            // Create new issue in target repo
                            octokit.request('POST /repos/{owner}/{repo}/issues', {
                                owner: owner_target,
                                repo: repo_target,
                                title: issue.title,
                                body: issue.body,
                                labels: issue.labels.map(label => label.name),
                            })
                            .then((response) => {
                                console.log("Created issue:", response.data.title);
                            }).catch((error) => {
                                let msg = "Error creating issue:"
                                console.error(msg, error);
                                core.setFailed(msg + " ${error}");
                            });
                            break;
                        case "edited":
                        case "closed":
                        case "reopened":
                        case "labeled":
                        case "unlabeled":
                            // Find issue number from target repo where the issue title matches the title of the issue in the source repo
                            octokit.request('GET /repos/{owner}/{repo}/issues', {
                                owner: owner_target,
                                repo: repo_target,
                                filter: "all",
                                state: "all",
                                title: issue.title,
                            }).then((response) => {
                                // Found issue in target repo
                                const targetIssue = response.data.find(targetIssue => targetIssue.title === issue.title);
                                if (targetIssue) {
                                    // Update issue in target repo
                                    // Update issue in target repo, identify target repo issue number by title match
                                    octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
                                        owner: owner_target,
                                        repo: repo_target,
                                        title: issue.title,
                                        body: issue.body,
                                        state: issue.state,
                                        issue_number: targetIssue.number,
                                        labels: issue.labels.map(label => label.name),
                                    })
                                    .then((response) => {
                                        console.log("Updated issue:", response.data.title);
                                    }).catch((error) => {
                                        console.error("Error updating issue:", error);
                                    });
                                } else {
                                    console.error("Could not find matching issue in target repo for title", issue.title);
                                    // Create issue anew
                                    octokit.request('POST /repos/{owner}/{repo}/issues', {
                                        owner: owner_target,
                                        repo: repo_target,
                                        title: issue.title,
                                        body: issue.body,
                                        labels: issue.labels.map(label => label.name),
                                    }).then((response) => {
                                        console.log("Created issue for lack of a match:", response.data.title);
                                    }).catch((error) => {
                                        let msg = "Error creating issue for lack of a match:"
                                        console.error(msg, error);
                                        core.setFailed(msg + " ${error}");
                                    });
                                }
                            }).catch((error) => {
                                let msg = "Error finding issue in target repo:";
                                console.error(msg, error);
                                core.setFailed(msg + " ${error}");
                            });
                            break;
                        default:
                            console.log("We are currently not handling events of type " + payload.action);
                            break;
                    }
                break;
            default:
                break;
        }
    }).catch((err) => {
        console.error("Failed to retrieve issue", err);
        core.setFailed("Failed to retrieve issue ${err}");
    });
});