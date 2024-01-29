import { secretScanningAlertQueueMessageHandler } from './secret-scanning-alert';
import { WebhookContext } from '../routes/github/webhook/webhook-context';
import { secretScanningAlertWebhookHandler } from '../github/secret-scanning-alert';
import { GithubWebhookMiddleware } from '../middleware/github-webhook-middleware';
import { getLogger } from '../config/logger';

jest.mock('../github/secret-scanning-alert', () => ({
  secretScanningAlertWebhookHandler: jest.fn(),
}));

jest.mock('../middleware/github-webhook-middleware', () => ({
  GithubWebhookMiddleware: jest.fn().mockImplementation((handler) => handler),
}));

jest.mock('../config/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('secretScanningAlertQueueMessageHandler', () => {
  let mockContext;
  let mockPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPayload = {
      action: 'created',
      alert: {
        number: 42,
        created_at: '2021-04-01T00:00:00Z',
        url: 'https://api.github.com/repos/octocat/Hello-World/secret-scanning/42',
        html_url: 'https://github.com/octocat/Hello-World/security/secret-scanning/42',
        state: 'open',
        resolution: null,
        resolved_by: null,
        resolved_at: null,
      },
      repository: {
        id: 123456,
        name: 'Hello-World',
        full_name: 'octocat/Hello-World',
        private: false,
      },
      sender: {
        login: 'octocat',
        id: 1,
      },
    };
    mockContext = new WebhookContext({
      id: mockPayload.alert.number.toString(),
      name: 'secret_scanning_alert',
      payload: mockPayload,
      log: getLogger('secret-scanning-alert'),
      action: mockPayload.action,
      gitHubAppConfig: {},
    });
  });

  it('should process a secret scanning alert event successfully', async () => {
    await secretScanningAlertQueueMessageHandler(mockPayload);

    expect(GithubWebhookMiddleware).toHaveBeenCalledWith(secretScanningAlertWebhookHandler);
    expect(secretScanningAlertWebhookHandler).toHaveBeenCalledWith(mockContext);
    expect(mockContext.log.info).toHaveBeenCalledWith('Secret scanning alert was successfully processed');
  });

  it('should log an error and rethrow when processing of a secret scanning alert event fails', async () => {
    const error = new Error('Processing failed');
    (secretScanningAlertWebhookHandler as jest.Mock).mockRejectedValueOnce(error);

    await expect(secretScanningAlertQueueMessageHandler(mockPayload)).rejects.toThrow(error);

    expect(mockContext.log.error).toHaveBeenCalledWith({ err: error }, 'Failed to process secret scanning alert');
  });
});
