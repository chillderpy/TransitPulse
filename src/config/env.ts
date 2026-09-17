import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  ltaAccountKey: process.env.LTA_ACCOUNT_KEY ?? "",
  ltaBaseUrl: required(
    "LTA_BASE_URL",
    "https://datamall2.mytransport.sg/ltaodataservice"
  ),
};

export const isLtaConfigured = () => env.ltaAccountKey.trim().length > 0;
