import { createApp } from "./app";
import { env, isLtaConfigured } from "./config/env";

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
});
