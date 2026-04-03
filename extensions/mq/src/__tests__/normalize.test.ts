import { describe, expect, it } from "vitest";
import {
  normalizeMqMessagingTarget,
  looksLikeMqTargetId,
  normalizeMqAllowEntry,
} from "../normalize.js";

describe("normalizeMqMessagingTarget", () => {
  it("returns undefined for empty input", () => {
    expect(normalizeMqMessagingTarget("")).toBeUndefined();
    expect(normalizeMqMessagingTarget("   ")).toBeUndefined();
  });

  it("passes through valid queue names", () => {
    expect(normalizeMqMessagingTarget("my-queue")).toBe("my-queue");
    expect(normalizeMqMessagingTarget("openclaw-inbound")).toBe("openclaw-inbound");
    expect(normalizeMqMessagingTarget("openclaw/inbound")).toBe("openclaw/inbound");
    expect(normalizeMqMessagingTarget("openclaw:inbound")).toBe("openclaw:inbound");
  });

  it("strips mq: prefix", () => {
    expect(normalizeMqMessagingTarget("mq:my-queue")).toBe("my-queue");
    expect(normalizeMqMessagingTarget("MQ:my-queue")).toBe("my-queue");
  });

  it("strips queue: prefix", () => {
    expect(normalizeMqMessagingTarget("queue:my-queue")).toBe("my-queue");
  });

  it("strips topic: prefix", () => {
    expect(normalizeMqMessagingTarget("topic:my-topic")).toBe("my-topic");
  });

  it("trims whitespace", () => {
    expect(normalizeMqMessagingTarget("  my-queue  ")).toBe("my-queue");
  });
});

describe("looksLikeMqTargetId", () => {
  it("returns true for valid queue/topic names", () => {
    expect(looksLikeMqTargetId("my-queue")).toBe(true);
    expect(looksLikeMqTargetId("openclaw/inbound")).toBe(true);
    expect(looksLikeMqTargetId("openclaw:inbound")).toBe(true);
    expect(looksLikeMqTargetId("queue.name.with.dots")).toBe(true);
  });

  it("returns false for empty input", () => {
    expect(looksLikeMqTargetId("")).toBe(false);
    expect(looksLikeMqTargetId("   ")).toBe(false);
  });

  it("returns false for invalid characters", () => {
    expect(looksLikeMqTargetId("queue name with spaces")).toBe(false);
  });
});

describe("normalizeMqAllowEntry", () => {
  it("lowercases and trims", () => {
    expect(normalizeMqAllowEntry("  User1  ")).toBe("user1");
  });

  it("strips mq: prefix", () => {
    expect(normalizeMqAllowEntry("mq:user1")).toBe("user1");
  });

  it("strips user: prefix", () => {
    expect(normalizeMqAllowEntry("user:alice")).toBe("alice");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeMqAllowEntry("")).toBe("");
    expect(normalizeMqAllowEntry("   ")).toBe("");
  });
});
