import { describe, expect, it, vi } from 'vitest';
import { runOverChannel } from './sandbox.js';
import type { SandboxChannel } from './sandbox.js';

/** A {@link SandboxChannel} whose `post` immediately (or never) invokes `respond`'s result as a reply. */
function fakeChannel(respond: (message: unknown) => unknown | undefined) {
	let handler: ((data: unknown) => void) | undefined;
	let destroyed = false;
	const channel: SandboxChannel = {
		post(message) {
			const response = respond(message);
			if (response !== undefined) handler?.(response);
		},
		onMessage(cb) {
			handler = cb;
			return () => {
				handler = undefined;
			};
		},
		destroy() {
			destroyed = true;
		}
	};
	return { channel, isDestroyed: () => destroyed };
}

describe('runOverChannel', () => {
	it('resolves with the transform data on a successful response', async () => {
		const { channel, isDestroyed } = fakeChannel(() => ({ ok: true, data: { price: 42 } }));
		await expect(runOverChannel(channel, 'return { price: 42 };', { now: 1 })).resolves.toEqual({
			price: 42
		});
		expect(isDestroyed()).toBe(true);
	});

	it('sends the code and ctx to the channel', async () => {
		let sent: unknown;
		const { channel } = fakeChannel((message) => {
			sent = message;
			return { ok: true, data: {} };
		});
		await runOverChannel(channel, 'return {};', { now: 123 });
		expect(sent).toEqual({ code: 'return {};', ctx: { now: 123 } });
	});

	it('rejects with the sandbox error message when the transform throws', async () => {
		const { channel } = fakeChannel(() => ({ ok: false, error: 'boom' }));
		await expect(runOverChannel(channel, 'throw new Error("boom")', {})).rejects.toThrow('boom');
	});

	it('rejects when the transform returns a non-object value', async () => {
		const { channel } = fakeChannel(() => ({ ok: true, data: 'not an object' }));
		await expect(runOverChannel(channel, 'return "not an object";', {})).rejects.toThrow(
			/plain object/
		);
	});

	it('rejects when the transform returns null', async () => {
		const { channel } = fakeChannel(() => ({ ok: true, data: null }));
		await expect(runOverChannel(channel, 'return null;', {})).rejects.toThrow(/plain object/);
	});

	it('rejects on a malformed sandbox response', async () => {
		const { channel } = fakeChannel(() => ({ nonsense: true }));
		await expect(runOverChannel(channel, 'return {};', {})).rejects.toThrow(/Malformed/);
	});

	it('rejects and destroys the channel once the timeout elapses', async () => {
		vi.useFakeTimers();
		try {
			const { channel, isDestroyed } = fakeChannel(() => undefined);
			const result = runOverChannel(channel, 'await new Promise(() => {});', {}, 1000);
			const assertion = expect(result).rejects.toThrow(/timed out/);
			await vi.advanceTimersByTimeAsync(1000);
			await assertion;
			expect(isDestroyed()).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ignores a late response after the timeout has already settled', async () => {
		vi.useFakeTimers();
		try {
			let handler: ((data: unknown) => void) | undefined;
			const channel: SandboxChannel = {
				post() {},
				onMessage(cb) {
					handler = cb;
					return () => {
						handler = undefined;
					};
				},
				destroy() {}
			};
			const result = runOverChannel(channel, 'slow', {}, 1000);
			const assertion = expect(result).rejects.toThrow(/timed out/);
			await vi.advanceTimersByTimeAsync(1000);
			handler?.({ ok: true, data: { late: true } });
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});
});
