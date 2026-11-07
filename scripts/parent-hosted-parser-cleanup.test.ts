import { describe, expect, it, vi } from "vitest";
import { cleanupHostedParsers } from "./parent-hosted-parser-cleanup";
import { HOSTED_PROJECT, parseHostedProfile } from "./parent-hosted-profile";
const raw = { service: "worker", enabled: false, approvalReference: "expired synthetic pilot", approvedUntil: "2000-01-01T00:00:00Z",
  publicOrigin: "https://pilot.thecaselink.com", projectOrigin: HOSTED_PROJECT,
  databaseUrl: "postgresql://caselink_fixture:fixture@db.zpfypkizsapvsxeykmdq.supabase.co/postgres?sslmode=verify-full",
  brokerSecret: "b".repeat(32), modelKey: "synthetic-model-key", parserImage: "caselink/parser@sha256:" + "a".repeat(64),
  dockerHost: "unix:///run/user/1005/docker.sock", parserDaemonId: "synthetic-rootless-daemon" };
const config = parseHostedProfile(raw, Date.now(), "parser-cleanup");
if (config.service !== "worker") throw new Error();
const row = { ID: "b".repeat(64), Names: "caselink-document-11111111-1111-4111-8111-111111111111", Image: raw.parserImage };
const info = JSON.stringify(raw.parserDaemonId) + '\n["name=seccomp,profile=builtin","name=rootless"]';
describe("hosted parser cleanup across expiry and worker crashes", () => {
  it("permits only cleanup after expiry, not restarting an expired or disabled worker", () => {
    expect(() => parseHostedProfile(raw)).toThrow(); expect(config.enabled).toBe(false);
    expect(() => parseHostedProfile({ ...raw, service: "frontdoor" }, Date.now(), "parser-cleanup")).toThrow();
  });
  it("removes only exact parser UUIDs on the pinned rootless daemon using no model/database/broker secrets", async () => {
    const run = vi.fn().mockResolvedValueOnce(info).mockResolvedValueOnce([row, { ...row, Names: "another-service" }].map(v => JSON.stringify(v)).join('\n')).mockResolvedValueOnce("");
    await cleanupHostedParsers(config, run, { NODE_ENV: "production", PATH: "/usr/bin", OPENAI_API_KEY: "ambient", DOCKER_HOST: "tcp://other:2375", NODE_OPTIONS: "--inspect" });
    expect(run.mock.calls[2][0]).toEqual(["rm", "--force", row.ID]);
    expect(run.mock.calls[0][1]).toEqual({ NODE_ENV: "production", PATH: "/usr/bin", HOME: undefined, DOCKER_HOST: raw.dockerHost });
  });
  it.each(['"other-daemon"\n["name=rootless"]', JSON.stringify(raw.parserDaemonId)+'\n["name=seccomp"]', 'not-json'])("refuses a different/unproved daemon before listing containers", async value => {
    const run = vi.fn().mockResolvedValue(value); await expect(cleanupHostedParsers(config, run)).rejects.toThrow(); expect(run).toHaveBeenCalledOnce();
  });
  it.each([{ ...row, Image: "foreign/image:latest" }, { ...row, ID: "--all" }])("refuses an unexpected image or malformed ID without deleting", async value => {
    const run = vi.fn().mockResolvedValueOnce(info).mockResolvedValueOnce(JSON.stringify(value)); await expect(cleanupHostedParsers(config, run)).rejects.toThrow(); expect(run).toHaveBeenCalledTimes(2);
  });
  it("does no delete for an empty dedicated daemon and sanitizes command errors", async () => {
    const run = vi.fn().mockResolvedValueOnce(info).mockResolvedValueOnce(""); await cleanupHostedParsers(config, run); expect(run).toHaveBeenCalledTimes(2);
    await expect(cleanupHostedParsers(config, vi.fn().mockRejectedValue(new Error("PRIVATE_DIAGNOSTIC")))).rejects.toThrow("No credentials or household information are logged.");
  });
});
