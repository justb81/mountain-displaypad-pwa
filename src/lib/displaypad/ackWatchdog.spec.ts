import { describe, expect, it, vi } from 'vitest';
import { AckWatchdog } from './ackWatchdog.js';

describe('AckWatchdog', () => {
	it('fires onElapse exactly once after the timeout when not cleared', () => {
		vi.useFakeTimers();
		try {
			const onElapse = vi.fn();
			const w = new AckWatchdog(5000, onElapse);
			w.arm();
			vi.advanceTimersByTime(4999);
			expect(onElapse).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(onElapse).toHaveBeenCalledTimes(1);
			// One-shot: it must not keep firing after it elapsed.
			vi.advanceTimersByTime(20_000);
			expect(onElapse).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not fire when cleared before the timeout', () => {
		vi.useFakeTimers();
		try {
			const onElapse = vi.fn();
			const w = new AckWatchdog(5000, onElapse);
			w.arm();
			vi.advanceTimersByTime(3000);
			w.clear();
			vi.advanceTimersByTime(20_000);
			expect(onElapse).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('re-arming restarts the countdown from zero', () => {
		vi.useFakeTimers();
		try {
			const onElapse = vi.fn();
			const w = new AckWatchdog(5000, onElapse);
			w.arm();
			vi.advanceTimersByTime(4000);
			w.arm(); // reset the window; the first countdown is discarded
			vi.advanceTimersByTime(4000); // 8s elapsed overall, but only 4s since re-arm
			expect(onElapse).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1000); // 5s since re-arm
			expect(onElapse).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('clear is a safe no-op when not armed', () => {
		const onElapse = vi.fn();
		const w = new AckWatchdog(5000, onElapse);
		expect(() => w.clear()).not.toThrow();
		expect(onElapse).not.toHaveBeenCalled();
	});
});
