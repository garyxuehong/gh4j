import { WebhookContext } from "../routes/github/webhook/webhook-context";
import { secretScanningAlertWebhookHandler } from "../github/secret-scanning-alert";
import { GithubWebhookMiddleware } from "../middleware/github-webhook-middleware";
import { Logger } from "bunyan";
import { getLogger } from "../config/logger";

export type SecretScanningAlertMessagePayload = {
  action: string;
  alert: {
    number: number;
    created_at: string;
    url: string;
    html_url: string;
    state: string;
    resolution: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
  };
  sender: {
    login: string;
    id: number;
  };
  // Add any additional properties that are specific to the "secret_scanning_alert" event payload
};

export const secretScanningAlertQueueMessageHandler = async (messagePayload: SecretScanningAlertMessagePayload): Promise<void> => {
  const logger: Logger = getLogger("secret-scanning-alert");
  try {
    const webhookContext = new WebhookContext({
      id: messagePayload.alert.number.toString(),
      name: "secret_scanning_alert",
      payload: messagePayload,
      log: logger,
      action: messagePayload.action,
      gitHubAppConfig: {
        // Populate with necessary GitHub app configuration
      }
    });

    await GithubWebhookMiddleware(secretScanningAlertWebhookHandler)(webhookContext);
    logger.info("Secret scanning alert was successfully processed");
  } catch (err: unknown) {
    logger.error({ err }, "Failed to process secret scanning alert");
    throw err; // Rethrow the error to be handled by the caller or SQS dead-letter queue
  }
};
