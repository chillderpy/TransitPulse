import { createApp } from "./app";
import { env, isLtaConfigured } from "./config/env";
import { startNotificationPoller } from "./services/notificationService";

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`TransitPulse backend listening on port ${env.port}`);
  if (!isLtaConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(
      "LTA_ACCOUNT_KEY is not set - /api/arrivals, /api/train-alerts and " +
        "/api/crowding will return 503 until it is. See .env.example."
    );
  }
  // Only started for the actual running server, not test's createApp() -
  // it polls LTA on a timer, which a test process shouldn't do in the
  // background across every test file.
  startNotificationPoller();
});
