import { enqueuePush, processPush } from "./push";
import { sqsQueues } from "../sqs/queues";
import { when } from "jest-when";
import { GitHubCommit, GitHubRepository } from "interfaces/github";
import { shouldSendAll, booleanFlag, BooleanFlags, numberFlag, NumberFlags } from "config/feature-flags";
import { getLogger } from "config/logger";
import { GitHubInstallationClient } from "../github/client/github-installation-client";
import { GithubClientCommitNotFoundBySHAError } from "../github/client/github-client-errors";
import { DatabaseStateCreator, CreatorResult } from "test/utils/database-state-creator";

jest.mock("../sqs/queues");
jest.mock("config/feature-flags");
const logger = getLogger("test");

describe("Enqueue push", () => {

	let db: CreatorResult;
	let issueKey: string;
	let sha: string;
	beforeEach(async () => {
		db = await new DatabaseStateCreator()
			.forCloud()
			.create();
		when(shouldSendAll).calledWith("commits", expect.anything(), expect.anything()).mockResolvedValue(false);
		when(numberFlag).calledWith(NumberFlags.SKIP_PROCESS_QUEUE_IF_ISSUE_NOT_FOUND_TIMEOUT, expect.anything(), expect.anything())
			.mockResolvedValue(10000);
		issueKey = `KEY-${new Date().getTime()}`;
		sha = `sha-${issueKey}`;
	});

	it("should push GitHubAppConfig to payload", async () => {
		await enqueuePush({
			installation: { id: 123, node_id: 456 },
			webhookId: "wh123",
			webhookReceived: Date.now(),
			repository: {} as GitHubRepository,
			commits: [{
				id: "c123",
				message: "ARC-1 some message",
				added: [],
				modified: [],
				removed: []
			} as unknown as GitHubCommit]
		}, jiraHost, getLogger("test"), {
			gitHubAppId: 1,
			appId: 2,
			clientId: "clientId",
			gitHubBaseUrl: "https://whatever.url",
			gitHubApiUrl: "https://api.whatever.url",
			uuid: "xxx-xxx-xxx"
		});

		expect(sqsQueues.push.sendMessage).toBeCalledWith(expect.objectContaining({
			shas: [
				{ id: "c123", issueKeys: ["ARC-1"] }
			],
			gitHubAppConfig: {
				gitHubAppId: 1,
				appId: 2,
				clientId: "clientId",
				gitHubBaseUrl: "https://whatever.url",
				gitHubApiUrl: "https://api.whatever.url",
				uuid: "xxx-xxx-xxx"
			}
		}), 0, expect.anything());
	});

	it("should push shas with no issue keys", async () => {
		when(shouldSendAll).calledWith("commits", expect.anything(), expect.anything()).mockResolvedValue(true);
		await enqueuePush({
			installation: { id: 123, node_id: 456 },
			webhookId: "wh123",
			webhookReceived: Date.now(),
			repository: {} as GitHubRepository,
			commits: [{
				id: "c123",
				message: "some message",
				added: [],
				modified: [],
				removed: []
			} as unknown as GitHubCommit]
		}, jiraHost, getLogger("test"), {
			gitHubAppId: 1,
			appId: 2,
			clientId: "clientId",
			gitHubBaseUrl: "https://whatever.url",
			gitHubApiUrl: "https://api.whatever.url",
			uuid: "xxx-xxx-xxx"
		});
		expect(sqsQueues.push.sendMessage).toBeCalledWith(expect.objectContaining({
			shas: [
				{ id: "c123", issueKeys: [] }
			]
		}), 0, expect.anything());
	});

	it("should not push shas with no issue keys", async () => {
		when(shouldSendAll).calledWith("commits", expect.anything(), expect.anything()).mockResolvedValue(false);
		await enqueuePush({
			installation: { id: 123, node_id: 456 },
			webhookId: "wh123",
			webhookReceived: Date.now(),
			repository: {} as GitHubRepository,
			commits: [{
				id: "c123",
				message: "some message",
				added: [],
				modified: [],
				removed: []
			} as unknown as GitHubCommit]
		}, jiraHost, getLogger("test"), {
			gitHubAppId: 1,
			appId: 2,
			clientId: "clientId",
			gitHubBaseUrl: "https://whatever.url",
			gitHubApiUrl: "https://api.whatever.url",
			uuid: "xxx-xxx-xxx"
		});
		expect(sqsQueues.push.sendMessage).toBeCalledWith(expect.objectContaining({
			shas: []
		}), 0, expect.anything());
	});

	describe("Maybe skipp commit when ff is on and commimt sha on not found", () => {
		it("when ff is OFF, should throw error for the problematic commits if 422 and even on last try", async () => {

			when(booleanFlag).calledWith(BooleanFlags.SKIP_COMMIT_IF_SHA_NOT_FOUND_ON_LAST_TRY, expect.anything())
				.mockResolvedValue(false);

			githubUserTokenNock(db.subscription.gitHubInstallationId);
			githubUserTokenNock(db.subscription.gitHubInstallationId);
			mockGitHubCommitRestApi();
			mockGitHubCommitRestApi422("invalid-sha");

			const pushPayload = getPushPayload();
			pushPayload.shas.push({
				id: "invalid-sha",
				issueKeys: [ issueKey ]
			});

			await expect(async () => {
				await processPush(getGitHubClient(), getContext({ lastAttempt: true }), pushPayload, logger);
			}).rejects.toThrow(GithubClientCommitNotFoundBySHAError);
		});

		it("should throw error for the problematic commits if 422 but NOT on last try", async () => {

			when(booleanFlag).calledWith(BooleanFlags.SKIP_COMMIT_IF_SHA_NOT_FOUND_ON_LAST_TRY, expect.anything())
				.mockResolvedValue(true);

			githubUserTokenNock(db.subscription.gitHubInstallationId);
			githubUserTokenNock(db.subscription.gitHubInstallationId);
			mockGitHubCommitRestApi();
			mockGitHubCommitRestApi422("invalid-sha");

			const pushPayload = getPushPayload();
			pushPayload.shas.push({
				id: "invalid-sha",
				issueKeys: [ issueKey ]
			});

			await expect(async () => {
				await processPush(getGitHubClient(), getContext({ lastAttempt: false }), pushPayload, logger);
			}).rejects.toThrow(GithubClientCommitNotFoundBySHAError);
		});

		it("should success skip the problematic commits if 422 on last try", async () => {

			when(booleanFlag).calledWith(BooleanFlags.SKIP_COMMIT_IF_SHA_NOT_FOUND_ON_LAST_TRY, expect.anything())
				.mockResolvedValue(true);

			githubUserTokenNock(db.subscription.gitHubInstallationId);
			githubUserTokenNock(db.subscription.gitHubInstallationId);
			mockGitHubCommitRestApi();
			mockGitHubCommitRestApi422("invalid-sha");

			mockJiraDevInfoAcceptUpdate();

			const pushPayload = getPushPayload();
			pushPayload.shas.push({
				id: "invalid-sha",
				issueKeys: [ issueKey ]
			});

			await processPush(getGitHubClient(), getContext({ lastAttempt: true }), pushPayload, logger);
		});
	});

	describe("Skipping msg when issue not exist", () => {

		describe("Use redis to avoid overload jira", () => {
			it("should reuse status from redis and only call jira once for same issue-key", async () => {
				when(booleanFlag).calledWith(BooleanFlags.SKIP_PROCESS_QUEUE_IF_ISSUE_NOT_FOUND, expect.anything())
					.mockResolvedValue(true);

				mockIssueNotExists();

				await processPush(getGitHubClient(), getContext(), getPushPayload(), logger);
				await processPush(getGitHubClient(), getContext(), getPushPayload(), logger);
			});
		});

		it("should NOT process issue if skip ff is on and the issue keys is not valid", async () => {

			when(booleanFlag).calledWith(BooleanFlags.SKIP_PROCESS_QUEUE_IF_ISSUE_NOT_FOUND, expect.anything())
				.mockResolvedValue(true);

			mockIssueNotExists();

			await processPush(getGitHubClient(), getContext(), getPushPayload(), logger);

		});

		it("should process issue if skip ff is on and the issue keys is valid", async () => {

			when(booleanFlag).calledWith(BooleanFlags.SKIP_PROCESS_QUEUE_IF_ISSUE_NOT_FOUND, expect.anything())
				.mockResolvedValue(true);

			mockIssueExists();

			githubUserTokenNock(db.subscription.gitHubInstallationId);
			mockGitHubCommitRestApi();

			mockJiraDevInfoAcceptUpdate();

			await processPush(getGitHubClient(), getContext(), getPushPayload(), logger);

		});

		it("should process issue if skip ff is off and the issue keys is not valid", async () => {

			when(booleanFlag).calledWith(BooleanFlags.SKIP_PROCESS_QUEUE_IF_ISSUE_NOT_FOUND, expect.anything())
				.mockResolvedValue(false);

			githubUserTokenNock(db.subscription.gitHubInstallationId);
			mockGitHubCommitRestApi();

			mockJiraDevInfoAcceptUpdate();

			await processPush(getGitHubClient(), getContext(), getPushPayload(), logger);

		});
	});

	const mockJiraDevInfoAcceptUpdate = () => {
		jiraNock.post("/rest/devinfo/0.10/bulk", (reqBody) => {
			return reqBody.repositories[0].commits.flatMap(c => c.issueKeys).some(ck => ck === issueKey);
		}).reply(202, "");
	};

	const mockGitHubCommitRestApi = () => {
		githubNock
			.get("/repos/org1/repo1/commits/" + sha)
			.reply(200, {
				files: [],
				sha
			});
	};

	const mockGitHubCommitRestApi422 = (sha: string) => {
		githubNock
			.get("/repos/org1/repo1/commits/" + sha)
			.reply(422, {
				message: `No commit found for SHA: ${sha}`,
				documentation_url: "https://docs.github.com"
			});
	};

	const getPushPayload = () => {
		return {
			jiraHost,
			installationId: db.subscription.gitHubInstallationId,
			gitHubAppConfig: undefined,
			webhookId: "aaa",
			repository: {
				owner: { login: "org1" },
				name: "repo1"
			} as GitHubRepository,
			shas: [{
				id: sha,
				issueKeys: [issueKey]
			}]
		};
	};

	const mockIssueExists = () => {
		jiraNock.get(`/rest/api/latest/issue/${issueKey}`)
			.query({ fields: "summary" }).reply(200, {});
	};

	const mockIssueNotExists = () => {
		jiraNock.get(`/rest/api/latest/issue/${issueKey}`)
			.query({ fields: "summary" }).reply(404, "");
	};

	const getGitHubClient = () => {
		return new GitHubInstallationClient({
			appId: 2,
			githubBaseUrl: "https://api.github.com",
			installationId: db.subscription.gitHubInstallationId
		}, {
			apiUrl: "https://api.github.com",
			baseUrl: "https://github.com",
			graphqlUrl: "https://api.github.com/graphql",
			hostname: "https://github.com",
			apiKeyConfig: undefined,
			proxyBaseUrl: undefined
		}, jiraHost, { trigger: "test" }, logger, undefined);
	};

	const getContext = (override?: any): any => {
		return {
			...override
		};
	};

});
