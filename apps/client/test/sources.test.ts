import assert from "node:assert/strict";
import test from "node:test";
import { groupSources, toggleSourceGroup } from "../web/sources.js";

test("source groups include every signer and group attributed app keys", () => {
  const sources = [
    {
      signer: "0xown",
      requestFid: 37,
      label: "Owner",
      isThisClient: true,
    },
    ...Array.from({ length: 9 }, (_, index) => ({
      signer: `0xapp${index}`,
      requestFid: 100,
      label: "Example App",
      isThisClient: false,
    })),
    {
      signer: "0xunknown",
      requestFid: null,
      label: "Signer 0xunk",
      isThisClient: false,
    },
  ];

  const groups = groupSources(sources);
  assert.equal(groups.flatMap((group) => group.signers).length, 11);
  assert.equal(groups.find((group) => group.id === "requester:100")?.signers.length, 9);
  assert.equal(groups.find((group) => group.id === "signer:0xunknown")?.label, "Unknown client");
  assert.equal(groups[0]?.id, "own:0xown");
});

test("an app-level source toggle changes all signer keys in the group", () => {
  const first = toggleSourceGroup(new Set(), ["0xa", "0xb", "0xc"]);
  assert.deepEqual([...first], ["0xa", "0xb", "0xc"]);

  const second = toggleSourceGroup(first, ["0xa", "0xb", "0xc"]);
  assert.equal(second.size, 0);

  const partial = toggleSourceGroup(new Set(["0xa"]), ["0xa", "0xb", "0xc"]);
  assert.equal(partial.size, 0, "a partially excluded app is re-included in one action");
});
