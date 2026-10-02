import { PolarClientError } from "@polar-sh/sdk";
import { createPolar, type Environment } from "@polar-sh/sdk/2026-04";

type PolarServer = Environment;

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function getPolarAccessToken() {
  return getRequiredEnv("POLAR_ACCESS_TOKEN");
}

export function getPolarProductId() {
  return getRequiredEnv("POLAR_PRODUCT_ID");
}

export function getPolarCreditsMeterId() {
  return getRequiredEnv("POLAR_CREDITS_METER_ID");
}

export function getPolarServer(): PolarServer {
  const server = process.env.POLAR_SERVER;
  if (!server) {
    return "sandbox";
  }

  if (server !== "sandbox" && server !== "production") {
    throw new Error("POLAR_SERVER must be either 'sandbox' or 'production'");
  }

  return server;
}

const polar = createPolar({
  accessToken: getPolarAccessToken(),
  environment: getPolarServer(),
});

type CreateCheckoutUrlParams = {
  customerExternalId: string;
  requestUrl: string;
};

export async function createCheckoutUrl({
  customerExternalId,
  requestUrl,
}: CreateCheckoutUrlParams) {
  const result = await polar.checkouts.create({
    products: [getPolarProductId()],
    success_url: new URL("/billing/success", requestUrl).toString(),
    external_customer_id: customerExternalId,
    metadata: { source: "nightcode-cli" },
  });

  return result.url;
}

export async function createCustomerPortalUrl({
  customerExternalId,
  requestUrl,
}: CreateCheckoutUrlParams) {
  const result = await polar.customerSessions.create({
    external_customer_id: customerExternalId,
    return_url: new URL("/billing/success", requestUrl).toString(),
  });

  return result.customer_portal_url;
}

export async function getAvailableCreditsBalance(customerExternalId: string) {
  try {
    const customerState = await polar.customers.getStateExternal(customerExternalId);

    const matchingMeters = customerState.active_meters.filter(
      (meter) => meter.meter_id === getPolarCreditsMeterId(),
    );

    if (matchingMeters.length > 1) {
      throw new Error("Expected exactly one matching Polar credits meter");
    }

    const creditsMeter = matchingMeters[0];
    return creditsMeter?.balance ?? 0;
  } catch (error) {
    if (error instanceof PolarClientError && error.statusCode === 404) {
      return 0;
    }

    throw error;
  }
}

type IngestAiUsageParams = {
    externalCustomerId: string;
    eventId: string;
    credits: number;
}

export async function ingestAiUsage({
    externalCustomerId,
    eventId, 
    credits
}: IngestAiUsageParams) {
    if(credits <= 0){
        return;
    }

    await polar.events.ingest({
        events:[{
            name: "nightcode_usage",
            external_id: eventId,
            external_customer_id: externalCustomerId,
            metadata: {credits},
        },
    ],
    })
}