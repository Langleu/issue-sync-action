import { Issue, IssueComment } from './issue'
import { GitHub } from './github'

export class Utils {
    targetIssueFooterTemplate: string
    targetCommentFooterTemplate: string
    skipCommentSyncKeywords: string[]
    skippedCommentMessage: string
    issueCreatedCommentTemplate: string

    constructor(
        targetIssueFooterTemplate: string,
        targetCommentFooterTemplate: string,
        skipCommentSyncKeywords: string[],
        skippedCommentMessage: string,
        issueCreatedCommentTemplate: string
    ) {
        this.targetCommentFooterTemplate = targetCommentFooterTemplate
        this.targetIssueFooterTemplate = targetIssueFooterTemplate
        this.skipCommentSyncKeywords = skipCommentSyncKeywords
        this.skippedCommentMessage = skippedCommentMessage
        this.issueCreatedCommentTemplate = issueCreatedCommentTemplate
    }

    public findTargetComment(sourceComment: IssueComment, targetComments: Array<IssueComment>): IssueComment {
        const matchContent = this.getIssueCommentFooter(sourceComment)
        let result: IssueComment = null
        targetComments.forEach(targetComment => {
            if (matchContent.trim() && targetComment.body.includes(matchContent)) {
                result = targetComment
                return
            }
        })

        const message = result
            ? `Found a match for the source comment ${sourceComment.id} in the target: ${result.id}`
            : `Could not find a match for the source comment ${sourceComment.id} in the target`
        console.info(message)
        return result
    }

    private getIssueCommentFooter(issueComment: IssueComment): string {
        return this.targetCommentFooterTemplate
            .replace('{{<link>}}', issueComment.html_url)
            .replace('{{<author>}}', `@${issueComment.user.login}`)
    }

    public getIssueCreatedComment(gitHub: GitHub, issueId: number): string {
        return this.issueCreatedCommentTemplate.replace(
            '{{<link>}}',
            `https://github.com/${gitHub.owner}/${gitHub.repo}/issues/${issueId}`
        )
    }

    public isIssueCreatedComment(gitHub: GitHub, body: string): boolean {
        return this.getIssueCreatedCommentTemplate(gitHub, body).includes(this.issueCreatedCommentTemplate)
    }

    private getIssueCreatedCommentTemplate(gitHub: GitHub, body: string): string {
        // replaces a link to the target issue with {{<link>}} placeholder for
        // message matching (template unrender)
        const baseLinkTemplate = `https://github.com/${gitHub.owner}/${gitHub.repo}/issues/`
        const regex = new RegExp(baseLinkTemplate.replace('/', '\\/') + '\\d+')
        return body.replace(regex, '{{<link>}}')
    }

    private getIssueNumberFromCreatedComment(gitHub: GitHub, body: string): number | null {
        const regex = new RegExp(`https://github.com/${gitHub.owner}/${gitHub.repo}/issues/(\\d+)`.replace('/', '\\/'))
        const match = body.match(regex)
        if (match && match[1]) {
            return Number(match[1])
        }
        return null
    }

    private getTargetIssueNumberFromSourceComments(
        targetGitHub: GitHub,
        sourceComments: IssueComment[]
    ): number | null {
        if (!this.issueCreatedCommentTemplate.trim()) {
            return null
        }

        for (let i = 0; i < sourceComments.length; i++) {
            const renderedBody = sourceComments[i].body
            if (this.isIssueCreatedComment(targetGitHub, renderedBody)) {
                // it's a created issue comment from the bot
                const parseIssueNumber = this.getIssueNumberFromCreatedComment(targetGitHub, renderedBody)
                if (parseIssueNumber) {
                    return parseIssueNumber
                }
            }
        }
        return null
    }

    private getIssueCommentBodyFiltered(issueComment: IssueComment): string {
        for (let i = 0; i < this.skipCommentSyncKeywords.length; i++) {
            if (issueComment.body.includes(this.skipCommentSyncKeywords[i])) {
                return this.skippedCommentMessage
            }
        }
        return issueComment.body
    }

    public getIssueCommentTargetBody(issueComment: IssueComment): string {
        const footer = this.getIssueCommentFooter(issueComment)
        const body = this.getIssueCommentBodyFiltered(issueComment)
        return footer ? body + '\n\n' + footer : body
    }

    public getIssueFooter(issue: Issue): string {
        return this.targetIssueFooterTemplate.replace('{{<link>}}', issue.html_url)
    }

    public getIssueTargetBody(issue: Issue): string {
        const footer = this.getIssueFooter(issue)
        const body = issue.body || ''
        return footer ? body + '\n\n' + footer : body
    }

    public getIssueNumber(
        gitHubSource: GitHub,
        gitHubTarget: GitHub,
        useCommentForIssueMatching: boolean,
        sourceIssueNumber: number,
        sourceIssueTitle: string
    ): Promise<number | null> {
        if (useCommentForIssueMatching) {
            return gitHubSource.getComments(sourceIssueNumber).then(sourceComments => {
                const issueNumber = this.getTargetIssueNumberFromSourceComments(gitHubTarget, sourceComments)
                if (!issueNumber) {
                    return gitHubTarget.getIssueNumberByTitle(sourceIssueTitle)
                }
                return Promise.resolve(issueNumber)
            })
        } else {
            return gitHubTarget.getIssueNumberByTitle(sourceIssueTitle)
        }
    }
}
