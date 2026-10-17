import assert from "node:assert/strict";
import test from "node:test";
import {
  DISTRIBUTOR_INCENTIVE_PERCENT,
  OPERATOR_SHARE_BPS,
  PUC_ROYALTY_ADDRESS,
  PUC_ROYALTY_BPS,
  createRevenueSplitPlan,
  splitCreationConfig,
} from "../src/revenue.js";

const operator = "0x1111111111111111111111111111111111111111";

test("revenue plan gives the operator 95% and P-U-C 5%", () => {
  const plan = createRevenueSplitPlan(operator);

  assert.equal(plan.direct, false);
  assert.equal(plan.operatorShareBps, OPERATOR_SHARE_BPS);
  assert.equal(plan.royaltyBps, PUC_ROYALTY_BPS);
  assert.equal(plan.distributorIncentivePercent, DISTRIBUTOR_INCENTIVE_PERCENT);
  assert.equal(
    plan.recipients.reduce(
      (total, recipient) => total + recipient.percentAllocation,
      0,
    ),
    100,
  );
  assert.deepEqual(
    new Map(
      plan.recipients.map((recipient) => [
        recipient.address.toLowerCase(),
        recipient.percentAllocation,
      ]),
    ),
    new Map([
      [operator.toLowerCase(), 95],
      [PUC_ROYALTY_ADDRESS.toLowerCase(), 5],
    ]),
  );
});

test("revenue split identity is deterministic and independent of input casing", () => {
  const lower = createRevenueSplitPlan(operator.toLowerCase());
  const checksum = createRevenueSplitPlan(operator);

  assert.equal(lower.salt, checksum.salt);
  assert.deepEqual(lower.recipients, checksum.recipients);
});

test("the split is immutable, push-based, and has only a small keeper incentive", () => {
  const config = splitCreationConfig(createRevenueSplitPlan(operator), 42_220);

  assert.equal(config.ownerAddress, "0x0000000000000000000000000000000000000000");
  assert.equal(config.creatorAddress, "0x0000000000000000000000000000000000000000");
  assert.equal(config.distributorFeePercent, 0.1);
  assert.equal(config.version, "splitV2o2");
});

test("the P-U-C wallet does not pay itself a redundant royalty", () => {
  const plan = createRevenueSplitPlan(PUC_ROYALTY_ADDRESS);

  assert.equal(plan.direct, true);
  assert.equal(plan.recipients.length, 1);
  assert.equal(plan.recipients[0]?.percentAllocation, 100);
  assert.equal(plan.royaltyBps, 0);
  assert.throws(
    () => splitCreationConfig(plan, 42_220),
    /does not need a split contract/,
  );
});
