import { faker } from "@faker-js/faker";

// @farcaster/core@0.20 eagerly constructs its test factories at import time.
// Faker 10 fixed GHSA-qxc2-j82w-r537 and renamed three legacy methods those
// factories call. Supplying the renamed methods lets us use the patched Faker
// without exposing or invoking its template evaluator in production.
const legacyFaker = faker as typeof faker & {
  datatype: {
    number?: (options?: { min?: number; max?: number }) => number;
    datetime?: () => Date;
  };
  random?: {
    alphaNumeric?: (length?: number) => string;
  };
};

legacyFaker.datatype.number ??= (options) => faker.number.int(options);
legacyFaker.datatype.datetime ??= () => faker.date.anytime();
legacyFaker.random ??= {};
legacyFaker.random.alphaNumeric ??= (length = 1) =>
  faker.string.alphanumeric(length);

const sdk = await import("@farcaster/hub-nodejs");

export const {
  CastType,
  FarcasterNetwork,
  makeCastAdd,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  Message,
  NobleEd25519Signer,
  ReactionType,
} = sdk;

export type {
  HubAsyncResult,
  Message as HubMessage,
  NobleEd25519Signer as HubSigner,
} from "@farcaster/hub-nodejs";
